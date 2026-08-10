const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, execFileSync } = require('child_process');
const { rcloneBinary, dataDir } = require('./paths');

// rclone.conf vive en la carpeta de datos de ESTE cliente (la misma que la
// base real, ver dataDir() en paths.js) — cada instalación tiene el suyo,
// atado a la cuenta de Google que ese cliente puntual haya conectado. Nunca
// se comparte entre clientes ni se sube a ningún lado.
const configPath = () => path.join(dataDir(), 'rclone.conf');
// Con qué email quedó conectado — se guarda aparte, UNA sola vez, recién
// conectado (ahí el access_token todavía está fresco). No se vuelve a pedir
// después: el token expira a la hora y refrescarlo a mano para solo mostrar
// un cartelito en Configuración no vale la complejidad — mejor un dato fijo
// desde la conexión que una consulta que puede fallar cada vez que se abre
// la pantalla.
const emailPath = () => path.join(dataDir(), 'gdrive-email.txt');
const CARPETA_DRIVE = 'StockBackups';

function conectado() {
  if (!fs.existsSync(configPath())) return false;
  return fs.readFileSync(configPath(), 'utf8').includes('[gdrive]');
}

/**
 * Corre `rclone authorize drive` — abre el navegador para que el dueño de
 * la cuenta de Google apruebe el acceso, y se queda esperando hasta que esa
 * autorización se complete (o se cancele/falle). rclone usa su propia app
 * de Google ya verificada para esto, no hace falta registrar una propia.
 * Al terminar, imprime un token por stdout — se guarda como la sección
 * [gdrive] del rclone.conf de este cliente.
 */
// Con el access_token recién obtenido, le pregunta a Google de qué cuenta
// es — best-effort: si falla (sin internet en ese instante puntual, etc.) no
// aborta la conexión por esto, Configuración simplemente no muestra el
// email y ya. Nunca es él quien decide si la conexión valió o no.
function obtenerEmail(accessToken) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'www.googleapis.com', path: '/oauth2/v2/userinfo', method: 'GET',
      timeout: 5000, headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)?.email || null); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function conectar() {
  const salida = await new Promise((resolve, reject) => {
    const proc = spawn(rcloneBinary(), ['authorize', 'drive'], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { out += d.toString(); });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (!out.match(/\{[^\n]*"access_token"[^\n]*\}/)) {
        reject(new Error(code === 0 ? 'No se encontró el token en la respuesta de rclone' : `rclone authorize falló (código ${code})`));
        return;
      }
      resolve(out);
    });
  });

  const match = salida.match(/\{[^\n]*"access_token"[^\n]*\}/);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configPath(), `[gdrive]\ntype = drive\ntoken = ${match[0]}\n`);

  try {
    const { access_token: accessToken } = JSON.parse(match[0]);
    const email = accessToken ? await obtenerEmail(accessToken) : null;
    if (email) fs.writeFileSync(emailPath(), email);
    else if (fs.existsSync(emailPath())) fs.unlinkSync(emailPath());
  } catch { /* la conexión en sí ya quedó guardada arriba, esto es solo el cartelito */ }
}

function emailConectado() {
  try { return fs.readFileSync(emailPath(), 'utf8').trim() || null; } catch { return null; }
}

function desconectar() {
  if (fs.existsSync(configPath())) fs.unlinkSync(configPath());
  if (fs.existsSync(emailPath())) fs.unlinkSync(emailPath());
}

/**
 * Sube un backup ya generado a la carpeta de Drive de este cliente — no
 * hace nada (ni tira error hacia arriba) si todavía no se conectó ninguna
 * cuenta, para que la falta de Drive nunca rompa el backup local en sí.
 */
function subirBackup(archivoLocal) {
  if (!conectado()) return;
  try {
    execFileSync(rcloneBinary(), [
      'copy', archivoLocal, `gdrive:${CARPETA_DRIVE}/`,
      '--config', configPath(),
    ], { windowsHide: true });
  } catch (err) {
    console.error('No se pudo subir el backup a Google Drive:', err.message);
  }
}

module.exports = { conectado, conectar, desconectar, subirBackup, emailConectado };
