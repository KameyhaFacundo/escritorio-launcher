// Activación atada a esta PC — evita que el mismo instalador se use en otra
// máquina sin pedirte un código nuevo. Solo tiene la clave PÚBLICA (sirve
// para VERIFICAR códigos, no para generarlos) — la clave privada que firma
// los códigos de activación vive aparte, en license-tool/ de tu máquina, y
// nunca se empaqueta acá. Ver license-tool/generar-activacion.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { dataDir } = require('./paths');

// Generada una sola vez con license-tool/generar-claves.js — si se rota la
// clave (ver ese script), hay que actualizar esto y todas las activaciones
// ya entregadas dejan de validar.
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAvyUB4zMt2W1wwTlkSTCqB5eWcE0z3qikwJLajzcRE64=
-----END PUBLIC KEY-----`;

const licensePath = () => path.join(dataDir(), 'license.json');

// MachineGuid: identificador estable de ESTA instalación de Windows (vive en
// el registro, no en el hardware — copiar los archivos a otra PC con otro
// Windows da un GUID distinto, que es justo el efecto que buscamos). Si por
// lo que sea no se puede leer, cae a hostname+usuario — peor pero no rompe.
function machineGuidCrudo() {
  try {
    const salida = execFileSync(
      'reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8' }
    );
    const match = salida.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
    if (match) return match[1];
  } catch { /* sigue al fallback */ }
  return `${require('os').hostname()}-${require('os').userInfo().username}`;
}

// Código de dispositivo legible que el cliente te manda por WhatsApp/mail —
// no es el MachineGuid crudo (no hace falta exponerlo tal cual), es un hash
// corto derivado de él, agrupado en bloques para que sea fácil de leer y
// tipear sin confundirse.
function obtenerCodigoDispositivo() {
  const hash = crypto.createHash('sha256').update(machineGuidCrudo()).digest('hex').toUpperCase();
  const corto = hash.slice(0, 16);
  return corto.match(/.{1,4}/g).join('-');
}

function licenciaValida() {
  const deviceCode = obtenerCodigoDispositivo();
  let guardada;
  try {
    guardada = JSON.parse(fs.readFileSync(licensePath(), 'utf8'));
  } catch {
    return false;
  }
  if (!guardada?.deviceCode || !guardada?.activationCode || guardada.deviceCode !== deviceCode) {
    return false;
  }
  try {
    const publicKey = crypto.createPublicKey(PUBLIC_KEY_PEM);
    const firma = Buffer.from(guardada.activationCode, 'base64url');
    return crypto.verify(null, Buffer.from(deviceCode, 'utf8'), publicKey, firma);
  } catch {
    return false;
  }
}

// Intenta activar con un código nuevo — si la firma no corresponde a ESTE
// dispositivo (o está mal tipeado), no guarda nada y devuelve false.
function activar(activationCodeIngresado) {
  const deviceCode = obtenerCodigoDispositivo();
  const activationCode = (activationCodeIngresado || '').trim();
  try {
    const publicKey = crypto.createPublicKey(PUBLIC_KEY_PEM);
    const firma = Buffer.from(activationCode, 'base64url');
    const ok = crypto.verify(null, Buffer.from(deviceCode, 'utf8'), publicKey, firma);
    if (!ok) return false;
  } catch {
    return false;
  }
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(licensePath(), JSON.stringify({ deviceCode, activationCode }));
  return true;
}

module.exports = { obtenerCodigoDispositivo, licenciaValida, activar };
