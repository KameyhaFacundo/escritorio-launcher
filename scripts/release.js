// Publica un build para UN cliente puntual, con su propio nombre/ícono/canal
// de actualizaciones — así la actualización de un cliente nunca le llega a
// otro (todos comparten el mismo repo de GitHub, pero cada uno escucha solo
// su propio canal). Ver clients/README.md.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const LAUNCHER_ROOT = path.join(__dirname, '..');
const FRONT_REPO = path.join(LAUNCHER_ROOT, '..', 'front-sistema-stock');
const DEFAULT_CLIENT = 'stock-ferreteria';
const DEFAULT_PORT = 8000;
const { owner: GH_OWNER, repo: GH_REPO } = require(path.join(LAUNCHER_ROOT, 'package.json')).build.publish;

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
  // extraMetadata.name pisa el "name" de package.json que usa electron-builder
  // (no Electron en runtime) para calcular la carpeta de instalación NSIS
  // — con oneClick:true + perMachine:false, IGNORA productName a propósito
  // y arma la carpeta a partir de este campo (ver getWindowsInstallationDirName
  // en electron-builder). Sin esto, todos los clientes instalaban en la
  // misma carpeta "escritorio-launcher" pisándose el código entre sí en una
  // PC con más de un cliente instalado (la data en AppData\Roaming quedaba
  // aparte gracias a clientAppName, pero el .exe/resources no).
  cliArg('extraMetadata.name', config.appName),
  // clientPort (ver electron/backend.js): puerto propio por cliente — sin
  // esto, si dos clientes están instalados y uno ya tiene su servidor
  // corriendo en el 8000, el otro terminaba conectándose por error AL
  // SERVIDOR AJENO en vez de abrir el suyo propio (pasó de verdad: la
  // ventana de un cliente mostró datos reales de otro cliente instalado
  // en la misma PC, sin que se hubiera guardado nada mal — solo se
  // conectó al backend equivocado).
  cliArg('extraMetadata.clientPort', port),
  // clientId/clientSecret de Google Drive propio de ESTE cliente (ver
  // electron/gdrive.js): rclone avisa que su client_id compartido se retira
  // durante 2026 — con credenciales propias por cliente, la subida de
  // backups a Drive no depende de la suerte de la comunidad de rclone.
  cliArg('extraMetadata.driveClientId', config.driveClientId || ''),
  cliArg('extraMetadata.driveClientSecret', config.driveClientSecret || ''),
], { cwd: LAUNCHER_ROOT, stdio: 'inherit', shell: true });

publicarRelease().catch((err) => {
  console.error(`\n⚠ El build se subió bien, pero no se pudo publicar el release solo: ${err.message}`);
  console.error(`  Entrá a https://github.com/${GH_OWNER}/${GH_REPO}/releases y sacale el "Draft" a mano, si no el auto-update de los clientes no lo va a ver.\n`);
});

// electron-builder con --publish always SUBE los archivos pero deja el
// release como DRAFT — invisible para electron-updater (que consulta el
// feed público, sin login). Un build "exitoso" se puede quedar así sin que
// nadie lo note, y los clientes instalados nunca ven la actualización
// aunque el log diga que todo salió bien (pasó de verdad: 3 versiones
// seguidas quedaron de borrador sin que se notara hasta revisarlo a mano).
// Esto saca el "Draft" apenas termina de subir, así el paso no depende de
// acordarse de entrar a GitHub después.
async function publicarRelease() {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('No está seteado GH_TOKEN en esta terminal');

  const tag = `v${require(path.join(LAUNCHER_ROOT, 'package.json')).version}`;
  const releases = await githubApi('GET', `/repos/${GH_OWNER}/${GH_REPO}/releases?per_page=20`, token);
  const release = releases.find((r) => r.tag_name === tag);
  if (!release) throw new Error(`No encontré ningún release con tag ${tag}`);
  if (!release.draft) { console.log(`\nRelease ${tag} ya estaba publicado.`); return; }

  const actualizado = await githubApi('PATCH', `/repos/${GH_OWNER}/${GH_REPO}/releases/${release.id}`, token, { draft: false });
  console.log(`\nRelease ${tag} publicado: ${actualizado.html_url}`);
}

function githubApi(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: 'api.github.com', path: urlPath, method,
      headers: {
        'User-Agent': 'release.js',
        'Authorization': `token ${token}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(out); } catch { parsed = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`GitHub API ${method} ${urlPath} -> ${res.statusCode}: ${parsed?.message || out}`));
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
