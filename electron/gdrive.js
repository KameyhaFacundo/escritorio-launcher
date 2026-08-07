const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { rcloneBinary, dataDir } = require('./paths');

// rclone.conf vive en la carpeta de datos de ESTE cliente (la misma que la
// base real, ver dataDir() en paths.js) — cada instalación tiene el suyo,
// atado a la cuenta de Google que ese cliente puntual haya conectado. Nunca
// se comparte entre clientes ni se sube a ningún lado.
const configPath = () => path.join(dataDir(), 'rclone.conf');
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
function conectar() {
  return new Promise((resolve, reject) => {
    const proc = spawn(rcloneBinary(), ['authorize', 'drive'], { windowsHide: true });
    let salida = '';
    proc.stdout.on('data', (d) => { salida += d.toString(); });
    proc.stderr.on('data', (d) => { salida += d.toString(); });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      const match = salida.match(/\{[^\n]*"access_token"[^\n]*\}/);
      if (!match) {
        reject(new Error(code === 0 ? 'No se encontró el token en la respuesta de rclone' : `rclone authorize falló (código ${code})`));
        return;
      }
      fs.mkdirSync(dataDir(), { recursive: true });
      fs.writeFileSync(configPath(), `[gdrive]\ntype = drive\ntoken = ${match[0]}\n`);
      resolve();
    });
  });
}

function desconectar() {
  if (fs.existsSync(configPath())) fs.unlinkSync(configPath());
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

module.exports = { conectado, conectar, desconectar, subirBackup };
