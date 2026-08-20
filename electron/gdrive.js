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

// Credenciales OAuth propias de ESTE cliente (inyectadas por scripts/release.js
// desde clients/<cliente>/config.json, ver extraMetadata.driveClientId). rclone
// avisa que su client_id compartido se retira durante 2026 — con las propias,
// la autorización y el refresh de token quedan atados a la app de Google del
// cliente, no a la suerte de la comunidad de rclone.
const driveClientId = () => require('../package.json').driveClientId || '';
const driveClientSecret = () => require('../package.json').driveClientSecret || '';

function conectado() {
  if (!fs.existsSync(configPath())) return false;
  return fs.readFileSync(configPath(), 'utf8').includes('[gdrive]');
}

/**
 * Corre `rclone authorize drive` — abre el navegador para que el dueño de
 * la cuenta de Google apruebe el acceso, y se queda esperando hasta que esa
 * autorización se complete (o se cancele/falle). Si este cliente tiene su
 * propio client_id (ver driveClientId arriba), se lo pasa a rclone para que
 * use la app de Google del cliente en vez de la compartida de la comunidad.
 * Al terminar, imprime un token por stdout — se guarda como la sección
 * [gdrive] del rclone.conf de este cliente.
 */
// Con el access_token recién obtenido, le pregunta a Google de qué cuenta
// es — best-effort: si falla (sin internet en ese instante puntual, etc.) no
// aborta la conexión por esto, Configuración simplemente no muestra el
// email y ya. Nunca es él quien decide si la conexión valió o no.
//
// OJO: se usa drive/v3/about, NO oauth2/v2/userinfo — el scope que rclone
// pide al autorizar Drive no incluye userinfo, así que ese endpoint siempre
// devolvía 401 y el email nunca se guardaba ("Conectado" sin mostrar cuenta).
function obtenerEmail(accessToken) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: '/drive/v3/about?fields=user(emailAddress,displayName)',
      method: 'GET',
      timeout: 8000,
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)?.user?.emailAddress || null); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function conectar() {
  const clientId = driveClientId();
  const clientSecret = driveClientSecret();
  const args = ['authorize', 'drive'];
  if (clientId && clientSecret) args.push(clientId, clientSecret);
  const salida = await new Promise((resolve, reject) => {
    const proc = spawn(rcloneBinary(), args, { windowsHide: true });
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
  // Si este cliente tiene credenciales propias, el conf las guarda también —
  // así rclone las usa para renovar el token cuando expira (ver emailConectado).
  const bloqueCliente = clientId && clientSecret
    ? `client_id = ${clientId}\nclient_secret = ${clientSecret}\n`
    : '';
  fs.writeFileSync(configPath(), `[gdrive]\ntype = drive\n${bloqueCliente}token = ${match[0]}\n`);

  try {
    const { access_token: accessToken } = JSON.parse(match[0]);
    const email = accessToken ? await obtenerEmail(accessToken) : null;
    if (email) fs.writeFileSync(emailPath(), email);
    else if (fs.existsSync(emailPath())) fs.unlinkSync(emailPath());
  } catch { /* la conexión en sí ya quedó guardada arriba, esto es solo el cartelito */ }
}

// El email guardado puede no existir (se escribió recién al conectar, ver
// conectar()) o estar viejo — por eso este prefiere consultarlo en vivo contra
// Google con el token de rclone antes de creerle al archivo local.
function leerToken() {
  try {
    const conf = fs.readFileSync(configPath(), 'utf8');
    const match = conf.match(/token\s*=\s*(\{.*\})/);
    return match ? JSON.parse(match[1]) : null;
  } catch { return null; }
}

async function emailConectado() {
  // Cache local primero — si ya está, no hace falta pegarle a Google de nuevo.
  try {
    const guardado = fs.readFileSync(emailPath(), 'utf8').trim();
    if (guardado) return guardado;
  } catch { /* sigue a la consulta en vivo */ }

  if (!conectado()) return null;

  // El access_token expira a la hora — `rclone about` renueva el token solo
  // (usa el refresh_token guardado) y lo deja actualizado en el rclone.conf.
  // Si da 403 por cuota transitoria del client compartido de rclone, se
  // reintenta una vez; la consulta de email es best-effort, no bloquea nada.
  try {
    execFileSync(rcloneBinary(), ['about', 'gdrive:', '--config', configPath()], { windowsHide: true, stdio: 'pipe' });
  } catch { /* el token vencido se usa igual abajo; si ya expiró, devolverá null */ }

  const token = leerToken();
  if (!token?.access_token) return null;

  const email = await obtenerEmail(token.access_token);
  if (email) {
    try { fs.writeFileSync(emailPath(), email); } catch { /* solo cache */ }
  }
  return email;
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
