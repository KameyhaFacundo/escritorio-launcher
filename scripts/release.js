// Publica un build para UN cliente puntual, con su propio nombre/ícono/canal
// de actualizaciones — así la actualización de un cliente nunca le llega a
// otro (todos comparten el mismo repo de GitHub, pero cada uno escucha solo
// su propio canal). Ver clients/README.md.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LAUNCHER_ROOT = path.join(__dirname, '..');
const DEFAULT_CLIENT = 'stock-ferreteria';

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

console.log(`\nPublicando "${config.productName}" — canal "${config.channel}", appId "${config.appId}"\n`);

execFileSync('node', ['scripts/build-resources.js'], { cwd: LAUNCHER_ROOT, stdio: 'inherit' });

execFileSync('npx', [
  'electron-builder', '--publish', 'always',
  `-c.productName=${config.productName}`,
  `-c.win.icon=${config.icon}`,
  `-c.publish.channel=${config.channel}`,
  // appId distinto por cliente: es lo que Windows usa para saber si "ya
  // está instalado" — con el mismo appId para todos, instalar un cliente
  // nuevo actualizaba EN EL LUGAR la carpeta del cliente anterior en vez
  // de instalarse aparte (verificado: quedaba todo en la carpeta del
  // primer cliente que se instaló alguna vez en esa PC, sin importar qué
  // productName tuviera el build de después).
  `-c.appId=${config.appId}`,
  // clientAppName controla app.getPath('userData') (ver electron/main.js)
  // — sin esto, dos clientes instalados en la misma PC leerían/pisarían
  // la misma base de datos.
  `-c.extraMetadata.clientAppName=${config.appName}`,
], { cwd: LAUNCHER_ROOT, stdio: 'inherit', shell: true });
