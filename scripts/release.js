// Publica un build para UN cliente puntual, con su propio nombre/ícono/canal
// de actualizaciones — así la actualización de un cliente nunca le llega a
// otro (todos comparten el mismo repo de GitHub, pero cada uno escucha solo
// su propio canal). Ver clients/README.md.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LAUNCHER_ROOT = path.join(__dirname, '..');
const FRONT_REPO = path.join(LAUNCHER_ROOT, '..', 'front-sistema-stock');
const DEFAULT_CLIENT = 'stock-ferreteria';
const DEFAULT_PORT = 8000;

const cliente = process.argv[2] || DEFAULT_CLIENT;
const configPath = path.join(LAUNCHER_ROOT, 'clients', cliente, 'config.json');

if (!fs.existsSync(configPath)) {
  console.error(`No existe clients/${cliente}/config.json — copiá clients/_template/ y completalo primero (ver clients/README.md).`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
for (const campo of ['productName', 'appId', 'appName', 'channel', 'icon']) {
  if (!config[campo]) {
    console.error(`clients/${cliente}/config.json le falta "${campo}".`);
    process.exit(1);
  }
}
const port = config.port || DEFAULT_PORT;

console.log(`\nPublicando "${config.productName}" — canal "${config.channel}", appId "${config.appId}", puerto ${port}\n`);

// Copia el .env + logo de ESTE cliente al lugar donde front-sistema-stock
// los lee antes de compilar — antes era un paso manual (documentado en
// front-sistema-stock/clients/README.md) y me olvidé de hacerlo la primera
// vez que armé un cliente nuevo, así que salió con la marca de otro cliente.
// Ahora lo hace el script solo, no depende de acordarse.
const frontClientDir = path.join(FRONT_REPO, 'clients', cliente);
const frontEnvSrc = path.join(frontClientDir, '.env');
if (!fs.existsSync(frontEnvSrc)) {
  console.error(`No existe front-sistema-stock/clients/${cliente}/.env — hace falta también del lado del front (ver front-sistema-stock/clients/README.md).`);
  process.exit(1);
}
fs.copyFileSync(frontEnvSrc, path.join(FRONT_REPO, '.env'));
const frontLogoDir = path.join(frontClientDir, 'logo');
if (fs.existsSync(frontLogoDir)) {
  for (const archivo of fs.readdirSync(frontLogoDir)) {
    fs.copyFileSync(path.join(frontLogoDir, archivo), path.join(FRONT_REPO, 'public', 'img', archivo));
  }
}

execFileSync('node', ['scripts/build-resources.js'], { cwd: LAUNCHER_ROOT, stdio: 'inherit' });

// shell:true hace falta en Windows para que resuelva "npx" — pero de paso
// obliga a citar a mano cada argumento que pueda traer espacios (el caso
// real: "Stock Ferreteria"). Sin las comillas, cmd.exe lo partía en dos
// argumentos sueltos ("-c.productName=Stock" y "Ferreteria") y
// electron-builder tiraba "Unknown argument: Ferreteria".
const cliArg = (key, value) => `"-c.${key}=${value}"`;

execFileSync('npx', [
  'electron-builder', '--publish', 'always',
  cliArg('productName', config.productName),
  cliArg('win.icon', config.icon),
  cliArg('publish.channel', config.channel),
  // appId distinto por cliente: es lo que Windows usa para saber si "ya
  // está instalado" — con el mismo appId para todos, instalar un cliente
  // nuevo actualizaba EN EL LUGAR la carpeta del cliente anterior en vez
  // de instalarse aparte (verificado: quedaba todo en la carpeta del
  // primer cliente que se instaló alguna vez en esa PC, sin importar qué
  // productName tuviera el build de después).
  cliArg('appId', config.appId),
  // clientAppName controla app.getPath('userData') (ver electron/main.js)
  // — sin esto, dos clientes instalados en la misma PC leerían/pisarían
  // la misma base de datos.
  cliArg('extraMetadata.clientAppName', config.appName),
  // clientPort (ver electron/backend.js): puerto propio por cliente — sin
  // esto, si dos clientes están instalados y uno ya tiene su servidor
  // corriendo en el 8000, el otro terminaba conectándose por error AL
  // SERVIDOR AJENO en vez de abrir el suyo propio (pasó de verdad: la
  // ventana de un cliente mostró datos reales de otro cliente instalado
  // en la misma PC, sin que se hubiera guardado nada mal — solo se
  // conectó al backend equivocado).
  cliArg('extraMetadata.clientPort', port),
], { cwd: LAUNCHER_ROOT, stdio: 'inherit', shell: true });
