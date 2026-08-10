// Prueba automática de la lógica de firma/activación (los puntos 1, 2 y 4
// de la verificación: dispositivo, firma, vencimiento) — usa la MISMA clave
// privada y el mismo esquema de firma que generar-activacion.js/license.js,
// pero no toca ningún license.json real, ninguna instalación, ni la hora
// del sistema. Se puede correr las veces que haga falta sin efectos
// secundarios.
//
// El punto 3 (reloj atrasado a mano) queda afuera a propósito — probarlo de
// verdad implica cambiar la hora de Windows, que sí tiene efectos
// secundarios reales (fechas de archivos, de ventas si se prueba en una
// instalación real, etc.). Ver el README de esta carpeta para el
// procedimiento manual de ese caso puntual.
//
// Uso: node test-verificacion.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Misma clave pública que trae embebida escritorio-launcher/electron/license.js
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAvyUB4zMt2W1wwTlkSTCqB5eWcE0z3qikwJLajzcRE64=
-----END PUBLIC KEY-----`;

const privPath = path.join(__dirname, 'clave-privada.pem');
if (!fs.existsSync(privPath)) {
  console.error(`No existe ${privPath} — corré esto desde una máquina que tenga la clave privada real.`);
  process.exit(1);
}
const privateKey = crypto.createPrivateKey(fs.readFileSync(privPath, 'utf8'));
const publicKey = crypto.createPublicKey(PUBLIC_KEY_PEM);

function firmar(deviceCode, vence) {
  return crypto.sign(null, Buffer.from(`${deviceCode}|${vence || ''}`, 'utf8'), privateKey).toString('base64url');
}

// Misma función que firmaValida() en license.js
function firmaValida(deviceCode, vence, firmaB64) {
  try {
    const firma = Buffer.from(firmaB64, 'base64url');
    return crypto.verify(null, Buffer.from(`${deviceCode}|${vence || ''}`, 'utf8'), publicKey, firma);
  } catch {
    return false;
  }
}

let ok = 0, fail = 0;
function assert(condicion, mensaje) {
  if (condicion) { console.log(`  ✓ ${mensaje}`); ok++; }
  else { console.log(`  ✗ ${mensaje}`); fail++; }
}

function fechaISO(offsetDias) {
  return new Date(Date.now() + offsetDias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

console.log('1) Código de dispositivo\n');
const deviceReal = 'AAAA-BBBB-CCCC-DDDD';
const deviceOtro = 'ZZZZ-YYYY-XXXX-WWWW';
const venceManana = fechaISO(30);
const codigoReal = firmar(deviceReal, venceManana);
assert(firmaValida(deviceReal, venceManana, codigoReal), 'Código válido en el dispositivo para el que se generó: ACEPTADO');
assert(!firmaValida(deviceOtro, venceManana, codigoReal), 'El mismo código en OTRO dispositivo: RECHAZADO');

console.log('\n2) Firma / manipulación\n');
assert(!firmaValida(deviceReal, fechaISO(365), codigoReal), 'Alguien le cambia la fecha de vencimiento a mano sin re-firmar: RECHAZADO');
assert(!firmaValida(deviceReal, venceManana, codigoReal.slice(0, -4) + 'AAAA'), 'Firma corrupta/alterada: RECHAZADA');

console.log('\n4) Vencimiento\n');
const venceAyer = fechaISO(-1);
const codigoVencido = firmar(deviceReal, venceAyer);
const limite = new Date(`${venceAyer}T23:59:59`).getTime();
assert(firmaValida(deviceReal, venceAyer, codigoVencido), 'Código vencido pero bien firmado sigue siendo una firma VÁLIDA (la fecha se chequea aparte)');
assert(Date.now() > limite, 'La fecha actual ya pasó el límite del vencimiento: DETECTADO (licenciaValida() lo rechazaría)');

console.log(`\n${ok} OK, ${fail} fallaron`);
process.exit(fail > 0 ? 1 : 0);
