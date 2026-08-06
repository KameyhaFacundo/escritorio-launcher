// Firma el código de dispositivo que te manda un cliente y te devuelve el
// código de activación que le tenés que pasar de vuelta — solo funciona
// para ESE dispositivo puntual (está firmado contra ese código exacto).
//
// Uso: node generar-activacion.js <codigo-de-dispositivo>
// Ejemplo: node generar-activacion.js K7F2-9XQP-3MRT-8LWD
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const deviceCode = (process.argv[2] || '').trim().toUpperCase();
if (!deviceCode) {
  console.error('Uso: node generar-activacion.js <codigo-de-dispositivo>');
  process.exit(1);
}

const privPath = path.join(__dirname, 'clave-privada.pem');
if (!fs.existsSync(privPath)) {
  console.error(`No existe ${privPath} — corré primero generar-claves.js`);
  process.exit(1);
}

const privateKey = crypto.createPrivateKey(fs.readFileSync(privPath, 'utf8'));
const firma = crypto.sign(null, Buffer.from(deviceCode, 'utf8'), privateKey);
const codigoActivacion = firma.toString('base64url');

console.log(`\nCódigo de dispositivo: ${deviceCode}`);
console.log(`Código de activación (pasáselo al cliente):\n`);
console.log(codigoActivacion);
console.log('');
