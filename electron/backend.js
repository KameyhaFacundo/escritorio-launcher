const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { backendPath, phpBinary, dataDir } = require('./paths');

const PORT = 8000;

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

  runArtisan(dir, ['migrate']);

  if (isFreshInstall) {
    runArtisan(dir, ['db:seed']);
  }

  // public/storage (symlink a storage/app/public, donde viven las imágenes
  // de productos/logo subidas) tiene que recrearse cada vez: apunta a la
  // carpeta de datos persistente, no a resources/backend, así que un update
  // que reemplaza resources/ lo rompe si no se corre esto de nuevo. No es
  // fatal si falla — symlink() en Windows necesita admin o Developer Mode
  // habilitado; sin eso solo se pierden las imágenes, no el resto del POS.
  try {
    runArtisan(dir, ['storage:link']);
  } catch (err) {
    console.error('No se pudo crear storage:link (¿Developer Mode desactivado?):', err.message);
  }
}

let serverProcess = null;

/**
 * Arranca `php artisan serve` como proceso hijo, supervisado: si se cae solo
 * (no por un stop nuestro), lo reinicia. `onReady` se llama una sola vez,
 * cuando el puerto empieza a responder.
 */
function startServer({ onCrash } = {}) {
  const dir = dataDir();

  serverProcess = spawn(
    phpBinary(),
    ['artisan', 'serve', '--host=0.0.0.0', `--port=${PORT}`],
    { cwd: backendPath(), env: backendEnv(dir) }
  );

  serverProcess.stdout.on('data', (d) => console.log(`[backend] ${d}`));
  serverProcess.stderr.on('data', (d) => console.error(`[backend] ${d}`));

  serverProcess.on('exit', (code, signal) => {
    const stoppedByUs = serverProcess === null;
    serverProcess = null;
    if (!stoppedByUs) {
      console.error(`El backend se cayó (code=${code}, signal=${signal}), reintentando...`);
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

const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000; // no hace un backup nuevo si ya hay uno de menos de 24h
const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000; // pero chequea seguido, por si la app queda abierta días

/**
 * Corre `php artisan backup:run` (copia + comprime la base SQLite a
 * storage/app/backups) si el más reciente que hay ahí tiene más de 24h, o si
 * todavía no hay ninguno. No hace falta que la app esté cerrada ni nada — el
 * comando lee la base, no la bloquea. Si falla, solo lo loguea: un backup
 * fallido no tiene que tumbar el resto del sistema.
 */
function runBackupIfDue() {
  const dir = dataDir();
  const backupsDir = path.join(dir, 'storage', 'app', 'backups');

  let needsBackup = true;
  try {
    const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.gz'));
    if (files.length > 0) {
      const newest = Math.max(...files.map((f) => fs.statSync(path.join(backupsDir, f)).mtimeMs));
      needsBackup = Date.now() - newest > BACKUP_MAX_AGE_MS;
    }
  } catch {
    // storage/app/backups todavía no existe — corre el primero.
  }

  if (!needsBackup) return;

  const proc = spawn(phpBinary(), ['artisan', 'backup:run', '--ansi'], {
    cwd: backendPath(),
    env: backendEnv(dir),
  });
  proc.stdout.on('data', (d) => console.log(`[backup] ${d}`));
  proc.stderr.on('data', (d) => console.error(`[backup] ${d}`));
  proc.on('exit', (code) => {
    if (code !== 0) console.error(`El backup automático falló (code=${code})`);
    else console.log('Backup automático generado.');
  });
}

let backupInterval = null;

function startBackupScheduler() {
  runBackupIfDue();
  backupInterval = setInterval(runBackupIfDue, BACKUP_CHECK_INTERVAL_MS);
}

function stopBackupScheduler() {
  if (backupInterval) clearInterval(backupInterval);
  backupInterval = null;
}

module.exports = {
  ensureInitialized, startServer, stopServer, PORT,
  startBackupScheduler, stopBackupScheduler,
};
