// Firma el código de dispositivo que te manda un cliente y te devuelve el
// código de activación que le tenés que pasar de vuelta — solo funciona
// para ESE dispositivo puntual (está firmado contra ese código exacto, y
// contra la fecha de vencimiento si le pasás una — ver electron/license.js).
// Además deja un registro local en activaciones.json (ver listar-activaciones.js)
// para no perderte quién tiene qué código y cuándo vence.
//
// Uso: node generar-activacion.js <codigo-de-dispositivo> [dias-de-prueba] [nombre-cliente]
// Ejemplo (licencia sin vencimiento):  node generar-activacion.js K7F2-9XQP-3MRT-8LWD
// Ejemplo (prueba de 14 días):         node generar-activacion.js K7F2-9XQP-3MRT-8LWD 14 "Palomar"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const deviceCode = (process.argv[2] || '').trim().toUpperCase();
const dias = process.argv[3] ? Number(process.argv[3]) : null;
const nombreCliente = (process.argv[4] || '').trim() || 'Sin nombre';
if (!deviceCode || (process.argv[3] && (!Number.isFinite(dias) || dias <= 0))) {
  console.error('Uso: node generar-activacion.js <codigo-de-dispositivo> [dias-de-prueba] [nombre-cliente]');
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

console.log(`\nCliente: ${nombreCliente}`);
console.log(`Código de dispositivo: ${deviceCode}`);
console.log(vence ? `Vence: ${vence} (${dias} día${dias === 1 ? '' : 's'} de prueba)` : 'Sin vencimiento');
console.log(`Código de activación (pasáselo al cliente):\n`);
console.log(codigoActivacion);
console.log('');

// Registro local — no se sube a git (ver .gitignore), es solo para vos.
// Se agrega un renglón nuevo por cada código generado, incluso si es el
// mismo dispositivo (por ejemplo: primero una prueba, después la licencia
// definitiva) — así queda el historial completo, no solo el último estado.
const registroPath = path.join(__dirname, 'activaciones.json');
let registro = [];
try {
  registro = JSON.parse(fs.readFileSync(registroPath, 'utf8'));
} catch { /* todavía no existe o está corrupto — arranca de cero */ }

registro.push({
  fechaGenerado: fechaLocalISO(new Date()),
  cliente: nombreCliente,
  deviceCode,
  vence: vence || null,
  dias: dias || null,
});

fs.writeFileSync(registroPath, JSON.stringify(registro, null, 2));
console.log(`(Guardado en activaciones.json — corré "node listar-activaciones.js" para ver todo.)\n`);
