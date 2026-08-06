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
for (const campo of ['productName', 'channel', 'icon']) {
  if (!config[campo]) {
    console.error(`clients/${cliente}/config.json le falta "${campo}".`);
    process.exit(1);
  }
}

console.log(`\nPublicando "${config.productName}" — canal "${config.channel}"\n`);

execFileSync('node', ['scripts/build-resources.js'], { cwd: LAUNCHER_ROOT, stdio: 'inherit' });

execFileSync('npx', [
  'electron-builder', '--publish', 'always',
  `-c.productName=${config.productName}`,
  `-c.win.icon=${config.icon}`,
  `-c.publish.channel=${config.channel}`,
], { cwd: LAUNCHER_ROOT, stdio: 'inherit', shell: true });
