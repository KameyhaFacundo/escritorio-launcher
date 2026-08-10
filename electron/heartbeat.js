// Le avisa a tu panel central (ver ../../panel-central) que esta instalación
// sigue viva — solo datos técnicos (código de dispositivo, versión, cliente,
// vencimiento de licencia), nunca ventas ni nada del negocio del cliente
// (ver la charla sobre qué es "legal" mandar sin avisar). Best-effort, no
// bloqueante: si no hay internet o el panel está caído, no pasa nada, la
// app sigue funcionando 100% offline igual que siempre.
const https = require('https');
const fs = require('fs');
const path = require('path');
const { obtenerCodigoDispositivo, vencimientoLicencia, datosNegocio } = require('./license');
const { dataDir } = require('./paths');
const gdrive = require('./gdrive');

// Manda sola cualquier caída del backend (ver registrarCaida en backend.js)
// en el próximo heartbeat que salga — así te enterás vos desde el panel sin
// que el cliente tenga que avisarte "no me anda tal cosa". Se manda solo lo
// nuevo desde el último envío CONFIRMADO (offset en disco): si no hay
// internet en ese momento, no se pierde, se reintenta con el próximo
// heartbeat que sí tenga conexión — el archivo de log no se toca acá, solo
// se lee.
const OFFSET_FILENAME = '.crash-log-enviado';
const MAX_CHARS_ENVIADOS = 8000; // de sobra para las últimas líneas de error; evita un payload gigante si se acumularon varias caídas seguidas offline.

function crashLogPendiente() {
  try {
    const logPath = path.join(dataDir(), 'storage', 'logs', 'backend-crashes.log');
    if (!fs.existsSync(logPath)) return null;

    const offsetPath = path.join(dataDir(), OFFSET_FILENAME);
    const yaEnviado = fs.existsSync(offsetPath) ? Number(fs.readFileSync(offsetPath, 'utf8')) || 0 : 0;
    const { size } = fs.statSync(logPath);
    if (size <= yaEnviado) return null;

    const fd = fs.openSync(logPath, 'r');
    const buffer = Buffer.alloc(size - yaEnviado);
    fs.readSync(fd, buffer, 0, buffer.length, yaEnviado);
    fs.closeSync(fd);

    return { texto: buffer.toString('utf8').slice(-MAX_CHARS_ENVIADOS), offsetFinal: size };
  } catch {
    return null;
  }
}

function marcarCrashLogEnviado(offsetFinal) {
  try {
    fs.writeFileSync(path.join(dataDir(), OFFSET_FILENAME), String(offsetFinal));
  } catch { /* si no se pudo guardar, el próximo heartbeat vuelve a mandar lo mismo — no pasa nada */ }
}

function enviarHeartbeat() {
  const pkg = require('../package.json');
  const url = pkg.heartbeatUrl;
  const key = pkg.heartbeatKey;
  if (!url || !key) return; // build sin panel configurado — no intenta nada

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  const { nombreNegocio, emailContacto, telefonoContacto } = datosNegocio();
  const crashPendiente = crashLogPendiente();
  const payload = JSON.stringify({
    device_code: obtenerCodigoDispositivo(),
    cliente: pkg.clientAppName || pkg.name,
    version: pkg.version,
    licencia_vence: vencimientoLicencia(),
    nombre_empresa: nombreNegocio,
    email_contacto: emailContacto,
    telefono_contacto: telefonoContacto,
    // Para que el panel avise qué instalaciones NO tienen respaldo en la
    // nube sin depender de que el cliente te escriba — ver el aviso
    // equivalente en la campanita del front (AppContext.jsx).
    drive_conectado: gdrive.conectado(),
    crash_reciente: crashPendiente?.texto ?? null,
  });

  const req = https.request({
    hostname: parsed.hostname,
    path: parsed.pathname,
    method: 'POST',
    timeout: 5000,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'X-Heartbeat-Key': key,
    },
  }, (res) => {
    res.on('data', () => {});
    res.on('end', () => {
      // Solo avanza el offset si el panel de verdad lo recibió — así un
      // heartbeat que se manda pero nunca llega (panel caído, corte a mitad
      // de camino) reintenta el mismo crash_reciente la próxima vez en vez
      // de darlo por perdido.
      if (crashPendiente && res.statusCode && res.statusCode < 400) {
        marcarCrashLogEnviado(crashPendiente.offsetFinal);
      }
    });
  });

  req.on('timeout', () => req.destroy());
  req.on('error', () => {}); // sin internet / panel caído — silencioso a propósito
  req.write(payload);
  req.end();
}

// Antes solo se mandaba uno al abrir la app — con la app abierta todo el
// día, "última conexión" en el panel quedaba pegada en el momento del
// arranque, como si se hubiera desconectado, aunque siguiera en uso. Un
// reenvío periódico (mismo patrón que el backup automático, ver
// startBackupScheduler en backend.js) mantiene esa fecha reflejando uso real.
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
let heartbeatInterval = null;

function startHeartbeatScheduler() {
  heartbeatInterval = setInterval(enviarHeartbeat, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeatScheduler() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

module.exports = { enviarHeartbeat, startHeartbeatScheduler, stopHeartbeatScheduler };
