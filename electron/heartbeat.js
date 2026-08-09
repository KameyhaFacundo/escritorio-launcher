// Le avisa a tu panel central (ver ../../panel-central) que esta instalación
// sigue viva — solo datos técnicos (código de dispositivo, versión, cliente,
// vencimiento de licencia), nunca ventas ni nada del negocio del cliente
// (ver la charla sobre qué es "legal" mandar sin avisar). Best-effort, no
// bloqueante: si no hay internet o el panel está caído, no pasa nada, la
// app sigue funcionando 100% offline igual que siempre.
const https = require('https');
const { obtenerCodigoDispositivo, vencimientoLicencia } = require('./license');

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

  const payload = JSON.stringify({
    device_code: obtenerCodigoDispositivo(),
    cliente: pkg.clientAppName || pkg.name,
    version: pkg.version,
    licencia_vence: vencimientoLicencia(),
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
  }, (res) => { res.on('data', () => {}); }); // no importa la respuesta, solo mejor esfuerzo

  req.on('timeout', () => req.destroy());
  req.on('error', () => {}); // sin internet / panel caído — silencioso a propósito
  req.write(payload);
  req.end();
}

module.exports = { enviarHeartbeat };
