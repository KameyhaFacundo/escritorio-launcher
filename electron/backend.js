const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { backendPath, phpBinary, dataDir } = require('./paths');
const gdrive = require('./gdrive');

// clientPort viene inyectado por clients/<cliente>/config.json (ver
// scripts/release.js) — puerto distinto por cliente para que, si dos
// clientes están instalados y corriendo en la misma PC (de prueba, o algún
// día en la misma red), uno no termine hablándole al servidor del otro por
// compartir el mismo puerto (pasó de verdad: la ventana de un cliente se
// conectó al backend real de otro que ya estaba corriendo en el 8000).
const PORT = require('../package.json').clientPort || 8000;

function ensureDataDirs(dir) {
  const sub = [
    'storage/logs',
    'storage/framework/cache/data',
    'storage/framework/sessions',
    'storage/framework/views',
    'storage/app/public',
    'storage/app/backups',
  ];
  for (const s of sub) {
    fs.mkdirSync(path.join(dir, s), { recursive: true });
  }
}

// Env que le decimos a bootstrap/app.php dónde viven .env/storage/database
// reales (ver back-sistema-stock-escritorio/bootstrap/app.php) — sin esto,
// Laravel usaría las carpetas dentro de resources/backend, que se pisan en
// cada actualización de la app.
function backendEnv(dir) {
  return {
    ...process.env,
    APP_STORAGE_PATH: path.join(dir, 'storage'),
    APP_ENV_PATH: dir,
    DB_DATABASE: path.join(dir, 'database.sqlite'),
  };
}

function runArtisan(dir, args) {
  const result = spawnSync(phpBinary(), ['artisan', ...args, '--force', '--ansi'], {
    cwd: backendPath(),
    env: backendEnv(dir),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`php artisan ${args.join(' ')} falló:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function readEnvValue(envPath, key) {
  if (!fs.existsSync(envPath)) return '';
  const line = fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : '';
}

function writeEnvValue(envPath, key, value) {
  const lineas = fs.readFileSync(envPath, 'utf8').split('\n');
  const idx = lineas.findIndex((l) => l.startsWith(`${key}=`));
  if (idx === -1) return;
  lineas[idx] = `${key}=${value}`;
  fs.writeFileSync(envPath, lineas.join('\n'));
}

/**
 * Primer arranque (o arranque normal, es idempotente): asegura que exista
 * .env/base persistentes en dataDir, genera claves si faltan, migra, y
 * siembra los datos base SOLO si la base recién se creó (instalación nueva
 * de verdad, no un reinicio de una que ya tenía datos cargados).
 */
function ensureInitialized() {
  const dir = dataDir();
  ensureDataDirs(dir);

  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) {
    fs.copyFileSync(path.join(backendPath(), '.env.production.example'), envPath);
  }

  // CACHE_DRIVER/SESSION_DRIVER pasaron de "file" a "database" (ver
  // .env.production.example — el driver de archivos podía colgar todo el
  // servidor con dos procesos PHP, serve + queue:work, peleándose por el
  // mismo flock()). Instalaciones que ya existían tienen su .env propio
  // guardado en dataDir(), que NO se pisa solo con un update — hay que
  // migrarlo acá a mano, una sola vez, o quedarían con el bug para siempre.
  if (readEnvValue(envPath, 'CACHE_DRIVER') === 'file') {
    writeEnvValue(envPath, 'CACHE_DRIVER', 'database');
  }
  if (readEnvValue(envPath, 'SESSION_DRIVER') === 'file') {
    writeEnvValue(envPath, 'SESSION_DRIVER', 'database');
  }

  const dbPath = path.join(dir, 'database.sqlite');
  const isFreshInstall = !fs.existsSync(dbPath);
  if (isFreshInstall) {
    fs.writeFileSync(dbPath, '');
  }

  if (!readEnvValue(envPath, 'APP_KEY')) {
    runArtisan(dir, ['key:generate']);
  }
  if (!readEnvValue(envPath, 'JWT_SECRET')) {
    runArtisan(dir, ['jwt:secret']);
  }

  // migrate/storage:link bootean un proceso PHP + Laravel entero cada vez que
  // se llaman (de sobra el cuello de botella real de "tarda en iniciar
  // sesión": son varios segundos ANTES de que la ventana de login aparezca) —
  // antes corrían en CADA apertura de la app, no solo después de instalar una
  // actualización de verdad. Solo hace falta volver a correrlos cuando
  // resources/ cambió, y eso pasa exactamente cuando la versión instalada es
  // distinta a la de la última vez que se inicializó esta carpeta de datos.
  const versionMarkerPath = path.join(dir, '.installed_version');
  const versionInstalada = fs.existsSync(versionMarkerPath) ? fs.readFileSync(versionMarkerPath, 'utf8').trim() : null;
  const versionActual = require('../package.json').version;

  if (isFreshInstall || versionInstalada !== versionActual) {
    runArtisan(dir, ['migrate']);

    if (isFreshInstall) {
      runArtisan(dir, ['db:seed']);
    }

    // public/storage (symlink a storage/app/public, donde viven las imágenes
    // de productos/logo subidas) tiene que recrearse cada vez que resources/
    // se reemplaza (un update lo rompe si no se corre esto de nuevo) — pero no
    // en un reinicio normal de la misma versión, donde ya sigue apuntando bien.
    // No es fatal si falla — symlink() en Windows necesita admin o Developer
    // Mode habilitado; sin eso solo se pierden las imágenes, no el resto del POS.
    try {
      runArtisan(dir, ['storage:link']);
    } catch (err) {
      console.error('No se pudo crear storage:link (¿Developer Mode desactivado?):', err.message);
    }

    // Recién acá, con migrate ya confirmado exitoso (si tiró, ni siquiera
    // llegamos a esta línea) — así un boot que falla a mitad de camino
    // reintenta todo de nuevo la próxima vez en vez de quedar "marcado" a
    // medio inicializar.
    fs.writeFileSync(versionMarkerPath, versionActual);
  }
}

let serverProcess = null;

/**
 * Arranca `php artisan serve` como proceso hijo, supervisado: si se cae solo
 * (no por un stop nuestro), lo reinicia. `onReady` se llama una sola vez,
 * cuando el puerto empieza a responder.
 */
// Últimas líneas de stderr del backend, en memoria — para poder volcarlas al
// log de caídas si el proceso muere. No se guardan en disco en tiempo real
// (sería un log gigante para algo que casi nunca hace falta leer), solo el
// recorte de acá se escribe, y solo cuando de verdad se cayó.
const MAX_LINEAS_ERROR = 40;
let ultimasLineasError = [];

// Deja un registro real de cada caída del backend — antes esto solo se
// imprimía en la consola de DevTools, que nadie mira en la PC de un cliente:
// cuando pasaba de verdad ("El servidor se detuvo"), no había forma de saber
// después por qué. Ahora queda un archivo con fecha + código de salida +
// las últimas líneas de stderr, para poder diagnosticarlo la próxima vez.
function registrarCaida(dir, code, signal) {
  try {
    const linea = `[${new Date().toISOString()}] code=${code} signal=${signal}\n${ultimasLineasError.join('')}\n---\n`;
    fs.appendFileSync(path.join(dir, 'storage', 'logs', 'backend-crashes.log'), linea);
  } catch { /* si ni esto se puede escribir, no hay mucho más para hacer */ }
}

function startServer({ onCrash } = {}) {
  const dir = dataDir();

  serverProcess = spawn(
    phpBinary(),
    ['artisan', 'serve', '--host=0.0.0.0', `--port=${PORT}`],
    { cwd: backendPath(), env: backendEnv(dir) }
  );

  serverProcess.stdout.on('data', (d) => console.log(`[backend] ${d}`));
  serverProcess.stderr.on('data', (d) => {
    console.error(`[backend] ${d}`);
    ultimasLineasError.push(d.toString());
    if (ultimasLineasError.length > MAX_LINEAS_ERROR) ultimasLineasError.shift();
  });

  serverProcess.on('exit', (code, signal) => {
    const stoppedByUs = serverProcess === null;
    serverProcess = null;
    if (!stoppedByUs) {
      console.error(`El backend se cayó (code=${code}, signal=${signal}), reintentando...`);
      registrarCaida(dir, code, signal);
      onCrash?.();
      setTimeout(() => startServer({ onCrash }), 1500);
    }
  });

  return serverProcess;
}

function stopServer() {
  if (serverProcess) {
    const p = serverProcess;
    serverProcess = null;
    p.kill();
  }
}

let queueProcess = null;

/**
 * Arranca `php artisan queue:work` como proceso hijo, supervisado igual que
 * startServer() — sin esto los jobs encolados (facturas/notas de crédito que
 * quedaron "pendiente" por un corte de ARCA, ver EmitirFacturaJob en el
 * backend) nunca se procesan solos. `--tries=1` porque los reintentos ya los
 * maneja el propio Job (backoff/retryUntil); acá alcanza con reintentar el
 * *proceso* si se cae, no cada job individual dos veces.
 */
function startQueueWorker() {
  const dir = dataDir();

  queueProcess = spawn(
    phpBinary(),
    ['artisan', 'queue:work', '--sleep=1', '--tries=1'],
    { cwd: backendPath(), env: backendEnv(dir) }
  );

  queueProcess.stdout.on('data', (d) => console.log(`[queue] ${d}`));
  queueProcess.stderr.on('data', (d) => console.error(`[queue] ${d}`));

  queueProcess.on('exit', (code, signal) => {
    const stoppedByUs = queueProcess === null;
    queueProcess = null;
    if (!stoppedByUs) {
      console.error(`El worker de colas se cayó (code=${code}, signal=${signal}), reintentando...`);
      setTimeout(startQueueWorker, 1500);
    }
  });

  return queueProcess;
}

function stopQueueWorker() {
  if (queueProcess) {
    const p = queueProcess;
    queueProcess = null;
    p.kill();
  }
}

// Chequea cada una hora por si la app queda abierta días seguidos — pero lo
// que realmente decide si hace falta un backup nuevo es la fecha del más
// reciente (ver needsBackupToday), no cuánto hace que corrió este intervalo.
const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function esMismoDiaLocal(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Un backup por día del calendario local, no "cada 24h corridas" — con eso
// solo, cerrar el local a las 20:00 y volver a abrir al otro día a las 09:00
// (23h de diferencia) se saltaba el backup de ese día entero hasta que la
// ventana de 24h finalmente se cumplía, a veces un día después.
function needsBackupToday(backupsDir) {
  try {
    const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.gz'));
    if (!files.length) return true;
    const newest = Math.max(...files.map((f) => fs.statSync(path.join(backupsDir, f)).mtimeMs));
    return !esMismoDiaLocal(new Date(newest), new Date());
  } catch {
    return true; // storage/app/backups todavía no existe — corre el primero.
  }
}

/**
 * Corre `php artisan backup:run` (copia + comprime la base SQLite a
 * storage/app/backups) de una, sin importar si ya se hizo uno hoy. No hace
 * falta que la app esté cerrada ni nada — el comando lee la base, no la
 * bloquea. Si falla, solo lo loguea: un backup fallido no tiene que tumbar
 * el resto del sistema. onDone(se hizo: bool) se llama siempre.
 *
 * La usan tanto runBackupIfDue() de abajo (el automático diario) como el
 * botón "Hacer backup ahora" de Configuración (ver 'ejecutar-backup-ahora'
 * en main.js) — mismo comando, la única diferencia es si hay que chequear
 * la fecha antes o se dispara directo porque lo pidió el dueño del negocio.
 */
function ejecutarBackup(onDone) {
  const dir = dataDir();
  const proc = spawn(phpBinary(), ['artisan', 'backup:run', '--ansi'], {
    cwd: backendPath(),
    env: backendEnv(dir),
  });
  let salida = '';
  proc.stdout.on('data', (d) => { salida += d.toString(); console.log(`[backup] ${d}`); });
  proc.stderr.on('data', (d) => console.error(`[backup] ${d}`));
  proc.on('exit', (code) => {
    if (code !== 0) { console.error(`El backup falló (code=${code})`); onDone?.(false); return; }
    console.log('Backup generado.');

    // Solo sube a Drive si ESTE cliente conectó su propia cuenta (ver
    // gdrive.js) — si no, subirBackup() no hace nada. El nombre exacto del
    // archivo sale de lo que el propio comando imprimió, no de volver a
    // listar la carpeta (evita subir por error un backup viejo si algo
    // más tocó esa carpeta justo en el medio).
    const match = salida.match(/Backup generado:\s*(.+\.gz)/);
    if (match) gdrive.subirBackup(match[1].trim());
    onDone?.(true);
  });
}

/**
 * Corre ejecutarBackup() solo si todavía no se hizo ninguno hoy — es la que
 * usa el scheduler automático (ver startBackupScheduler más abajo). onDone
 * también se llama cuando NO hacía falta (false) — lo usa el cierre de la
 * app (ver "backup al salir" en main.js) para saber cuándo ya puede
 * terminar de cerrar.
 */
function runBackupIfDue(onDone) {
  const dir = dataDir();
  const backupsDir = path.join(dir, 'storage', 'app', 'backups');

  if (!needsBackupToday(backupsDir)) { onDone?.(false); return; }
  ejecutarBackup(onDone);
}

let backupInterval = null;

function startBackupScheduler() {
  runBackupIfDue();
  backupInterval = setInterval(() => runBackupIfDue(), BACKUP_CHECK_INTERVAL_MS);
}

function stopBackupScheduler() {
  if (backupInterval) clearInterval(backupInterval);
  backupInterval = null;
}

module.exports = {
  ensureInitialized, startServer, stopServer, PORT,
  startQueueWorker, stopQueueWorker,
  startBackupScheduler, stopBackupScheduler,
  runBackupIfDue, ejecutarBackup,
};
