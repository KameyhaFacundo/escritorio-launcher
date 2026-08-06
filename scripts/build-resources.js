// Arma resources/ a partir de los otros dos repos, listo para que
// electron-builder lo empaquete. No modifica los repos originales: todo lo
// que hace es copiar hacia resources/backend y compilar el front con las
// env vars de esta build puntual (sin tocar los .env de esos repos).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LAUNCHER_ROOT = path.join(__dirname, '..');
const LAUNCHER_VERSION = require(path.join(LAUNCHER_ROOT, 'package.json')).version;
const SIBLINGS = path.join(LAUNCHER_ROOT, '..');
const BACK_REPO = path.join(SIBLINGS, 'back-sistema-stock');
const FRONT_REPO = path.join(SIBLINGS, 'front-sistema-stock');
const RESOURCES = path.join(LAUNCHER_ROOT, 'resources');
const BACKEND_OUT = path.join(RESOURCES, 'backend');
const PHP_OUT = path.join(RESOURCES, 'php');

// No entran en el paquete: cosas de dev (tests, git, vendor de dev, datos
// reales de la base de dev) o cosas que Electron va a crear en %APPDATA% en
// runtime (storage/, database.sqlite) — ver bootstrap/app.php de ese repo.
const BACKEND_EXCLUDE = [
  '.git', '.github', 'node_modules', 'vendor', 'tests',
  'database/database.sqlite', '.env', '.env.example',
  'phpunit.xml', '.gitignore', '.gitattributes',
  'storage/framework', 'storage/logs', 'storage/app/public', 'storage/app/backups',
];

function shouldExclude(relPath) {
  const normalized = relPath.split(path.sep).join('/');
  return BACKEND_EXCLUDE.some((ex) => normalized === ex || normalized.startsWith(`${ex}/`));
}

function copyBackend() {
  console.log(`Copiando ${BACK_REPO} -> ${BACKEND_OUT}`);
  fs.rmSync(BACKEND_OUT, { recursive: true, force: true });
  fs.cpSync(BACK_REPO, BACKEND_OUT, {
    recursive: true,
    filter: (src) => !shouldExclude(path.relative(BACK_REPO, src)),
  });
}

function installComposerDeps() {
  console.log('composer install --no-dev en la copia empaquetada...');
  execFileSync('composer', ['install', '--no-dev', '--optimize-autoloader', '--no-interaction'], {
    cwd: BACKEND_OUT, stdio: 'inherit', shell: true,
  });
}

function buildFront() {
  console.log('Compilando el front para esta instalación...');
  execFileSync('pnpm', ['build'], {
    cwd: FRONT_REPO,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      // Relativo: el mismo build sirve tanto para la ventana Electron
      // (http://localhost:8000/) como para el navegador de cada caja
      // (http://<ip-lan>:8000/) sin ningún cambio — ver ADR en el plan de Fase 1.
      VITE_API_URL: '/api/v1/',
      VITE_DEMO_MODE: 'false',
      // El número que se ve en el pie del sidebar (v0.1.2, etc.) — antes
      // quedaba pegado en un "1.0.0" fijo en el código del front, sin
      // relación con la versión real del instalador.
      VITE_APP_VERSION: LAUNCHER_VERSION,
    },
  });

  const distDir = path.join(FRONT_REPO, 'dist');
  const publicDir = path.join(BACKEND_OUT, 'public');
  // Cada build de Vite hashea los nombres de /assets/* — sin borrar la carpeta
  // vieja antes de copiar, los chunks de builds anteriores se quedan huérfanos
  // ahí para siempre (no rompen nada, pero acumulan basura build tras build).
  fs.rmSync(path.join(publicDir, 'assets'), { recursive: true, force: true });
  console.log(`Copiando ${distDir} -> ${publicDir}`);
  fs.cpSync(distDir, publicDir, { recursive: true });
}

function checkPhp() {
  const phpExe = path.join(PHP_OUT, 'php.exe');
  if (fs.existsSync(phpExe)) {
    console.log(`PHP portátil OK: ${phpExe}`);
    return;
  }
  console.warn(`
⚠ Falta el PHP portátil en ${PHP_OUT}\\php.exe — paso manual (una vez por
  versión de PHP), no lo hace este script:
  1. Bajar el build oficial "Non Thread Safe" de Windows para PHP 8.2 (zip)
     desde https://windows.php.net/download/
  2. Descomprimir el contenido del zip directo en ${PHP_OUT}
  3. Copiar php.ini-production a php.ini y habilitar (sacar el ";" de):
     extension=soap, extension=pdo_sqlite, extension=sqlite3,
     extension=openssl, extension=curl, extension=mbstring,
     extension=fileinfo, extension=dom, extension=simplexml
`);
}

copyBackend();
installComposerDeps();
buildFront();
checkPhp();
console.log('\nresources/ listo (salvo el aviso de PHP arriba, si aplica).');
