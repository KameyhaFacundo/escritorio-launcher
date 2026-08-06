// Genera el par de claves Ed25519 para el sistema de activación — se corre
// UNA sola vez (o cada vez que quieras rotar las claves, lo que invalida
// todas las activaciones ya entregadas). La clave privada NO se sube a git
// ni se empaqueta con la app — solo vive acá, en tu máquina. La clave
// pública sí es segura de compartir: hay que pegarla en
// electron/license.js (PUBLIC_KEY_PEM) antes de armar el instalador.
//
// Uso: node generar-claves.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

const privPath = path.join(__dirname, 'clave-privada.pem');
if (fs.existsSync(privPath)) {
  console.error(`Ya existe ${privPath} — si generás una clave nueva, todas las
activaciones que ya le diste a clientes con la clave vieja dejan de
funcionar. Si estás seguro, borrala a mano primero y volvé a correr esto.`);
  process.exit(1);
}

fs.writeFileSync(privPath, privPem);
console.log(`Clave privada guardada en: ${privPath}`);
console.log('NO la subas a git. NO la mandes a nadie. Si la perdés, no podés generar más activaciones.\n');
console.log('Pegá esto en electron/license.js, reemplazando PUBLIC_KEY_PEM:\n');
console.log(pubPem);
