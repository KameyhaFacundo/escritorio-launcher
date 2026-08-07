// Firma el código de dispositivo que te manda un cliente y te devuelve el
// código de activación que le tenés que pasar de vuelta — solo funciona
// para ESE dispositivo puntual (está firmado contra ese código exacto, y
// contra la fecha de vencimiento si le pasás una — ver electron/license.js).
//
// Uso: node generar-activacion.js <codigo-de-dispositivo> [dias-de-prueba]
// Ejemplo (licencia sin vencimiento):  node generar-activacion.js K7F2-9XQP-3MRT-8LWD
// Ejemplo (prueba de 14 días):         node generar-activacion.js K7F2-9XQP-3MRT-8LWD 14
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const deviceCode = (process.argv[2] || '').trim().toUpperCase();
const dias = process.argv[3] ? Number(process.argv[3]) : null;
if (!deviceCode || (process.argv[3] && (!Number.isFinite(dias) || dias <= 0))) {
  console.error('Uso: node generar-activacion.js <codigo-de-dispositivo> [dias-de-prueba]');
  process.exit(1);
}

const privPath = path.join(__dirname, 'clave-privada.pem');
if (!fs.existsSync(privPath)) {
  console.error(`No existe ${privPath} — corré primero generar-claves.js`);
  process.exit(1);
}

// AAAA-MM-DD en hora LOCAL de esta PC (no UTC) — evita que a alguien en
// GMT-3 la prueba le corte varias horas antes de la medianoche que espera.
function fechaLocalISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const vence = dias ? fechaLocalISO(new Date(Date.now() + dias * 24 * 60 * 60 * 1000)) : '';

const privateKey = crypto.createPrivateKey(fs.readFileSync(privPath, 'utf8'));
const firma = crypto.sign(null, Buffer.from(`${deviceCode}|${vence}`, 'utf8'), privateKey);
const codigoActivacion = `${vence}.${firma.toString('base64url')}`;

console.log(`\nCódigo de dispositivo: ${deviceCode}`);
console.log(vence ? `Vence: ${vence} (${dias} día${dias === 1 ? '' : 's'} de prueba)` : 'Sin vencimiento');
console.log(`Código de activación (pasáselo al cliente):\n`);
console.log(codigoActivacion);
console.log('');
