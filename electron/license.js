// Activación atada a esta PC — evita que el mismo instalador se use en otra
// máquina sin pedirte un código nuevo. Solo tiene la clave PÚBLICA (sirve
// para VERIFICAR códigos, no para generarlos) — la clave privada que firma
// los códigos de activación vive aparte, en license-tool/ de tu máquina, y
// nunca se empaqueta acá. Ver license-tool/generar-activacion.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
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

// El código de activación trae DOS partes separadas por un punto:
// "<vence>.<firma>" — vence es una fecha AAAA-MM-DD (o vacío para licencias
// sin vencimiento) y firma cubre "deviceCode|vence" junto, no cada parte por
// separado — así no se puede agarrar un código con vencimiento y pisarle la
// fecha a mano (la firma dejaría de coincidir). Ver license-tool/generar-activacion.js.
function leerLicencia() {
  try { return JSON.parse(fs.readFileSync(licensePath(), 'utf8')); } catch { return null; }
}

function guardarLicencia(datos) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(licensePath(), JSON.stringify(datos));
}

function firmaValida(deviceCode, vence, firmaB64) {
  try {
    const publicKey = crypto.createPublicKey(PUBLIC_KEY_PEM);
    const firma = Buffer.from(firmaB64, 'base64url');
    return crypto.verify(null, Buffer.from(`${deviceCode}|${vence || ''}`, 'utf8'), publicKey, firma);
  } catch {
    return false;
  }
}

// Margen para no marcar como "reloj manipulado" un ajuste legítimo chico
// (cambio de huso horario, sincronización NTP) — un salto hacia atrás mayor
// a esto sí se trata como alguien atrasando el reloj a mano para seguir
// usando una prueba que ya venció.
const TOLERANCIA_RETROCESO_MS = 5 * 60 * 1000;

function licenciaValida() {
  const deviceCode = obtenerCodigoDispositivo();
  const guardada = leerLicencia();
  if (!guardada?.deviceCode || guardada.deviceCode !== deviceCode || !guardada.firma) return false;
  if (!firmaValida(deviceCode, guardada.vence, guardada.firma)) return false;

  // "Marca de tiempo máxima vista" — la mayor hora que esta instalación
  // registró alguna vez (se actualiza cada vez que se abre, y también desde
  // internet si hay conexión, ver verificarRelojOnline). Si la hora actual
  // del sistema aparece ANTES que esa marca, no es un desfasaje normal: es
  // que alguien atrasó el reloj de Windows a mano. Esto funciona incluso sin
  // internet — no depende de un servidor propio para detectarlo.
  const ahora = Date.now();
  const marca = guardada.marcaTiempoMax || 0;
  if (marca && ahora < marca - TOLERANCIA_RETROCESO_MS) return false;
  if (ahora > marca) guardarLicencia({ ...guardada, marcaTiempoMax: ahora });

  if (guardada.vence) {
    const limite = new Date(`${guardada.vence}T23:59:59`).getTime();
    if (Math.max(ahora, marca) > limite) return false;
  }
  return true;
}

// Intenta activar con un código nuevo — si la firma no corresponde a ESTE
// dispositivo (o está mal tipeado), no guarda nada y devuelve false.
// nombreNegocio/emailContacto: se piden en la pantalla de activación (ver
// activacion.html) para que el panel central llegue con nombre desde el
// primer heartbeat, sin depender de que alguien lo tipee a mano después.
// No forman parte de la firma (no cambian si validás o no el código) — son
// solo un dato de contacto, no algo que haya que proteger contra alteración.
function activar(codigoIngresado, nombreNegocio, emailContacto, telefonoContacto) {
  const deviceCode = obtenerCodigoDispositivo();
  const codigo = (codigoIngresado || '').trim();
  const separador = codigo.lastIndexOf('.');
  if (separador === -1) return false;
  const vence = codigo.slice(0, separador);
  const firmaB64 = codigo.slice(separador + 1);
  if (!firmaValida(deviceCode, vence, firmaB64)) return false;

  guardarLicencia({
    deviceCode, vence, firma: firmaB64, marcaTiempoMax: Date.now(),
    nombreNegocio: (nombreNegocio || '').trim(),
    emailContacto: (emailContacto || '').trim(),
    telefonoContacto: (telefonoContacto || '').trim(),
  });
  return true;
}

// Para el heartbeat (ver heartbeat.js) — mismo criterio que vencimientoLicencia().
function datosNegocio() {
  const guardada = leerLicencia();
  return {
    nombreNegocio: guardada?.nombreNegocio || null,
    emailContacto: guardada?.emailContacto || null,
    telefonoContacto: guardada?.telefonoContacto || null,
  };
}

// Best-effort, no bloqueante: si hay internet, adelanta la "marca de tiempo
// máxima vista" a la hora real de un servidor remoto (la cabecera Date la
// manda cualquier respuesta HTTPS, no hace falta un endpoint propio armado
// para esto). Cubre el caso de un reloj atrasado a mano DESDE ANTES de la
// primera activación, cuando todavía no había ninguna marca local guardada
// contra la cual comparar. Si falla o no hay conexión, no hace nada — nunca
// bloquea el arranque ni el uso offline del sistema.
function verificarRelojOnline() {
  return new Promise((resolve) => {
    const req = https.request({ method: 'HEAD', host: 'www.google.com', timeout: 4000 }, (res) => {
      const fechaRemota = res.headers?.date ? Date.parse(res.headers.date) : NaN;
      const guardada = leerLicencia();
      if (!isNaN(fechaRemota) && guardada && fechaRemota > (guardada.marcaTiempoMax || 0)) {
        guardarLicencia({ ...guardada, marcaTiempoMax: fechaRemota });
      }
      resolve();
    });
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.on('error', () => resolve());
    req.end();
  });
}

// Para el heartbeat (ver heartbeat.js) — no repite la lógica de armar/leer
// el archivo, solo expone el dato que ya está guardado.
function vencimientoLicencia() {
  return leerLicencia()?.vence || null;
}

module.exports = { obtenerCodigoDispositivo, licenciaValida, activar, verificarRelojOnline, vencimientoLicencia, datosNegocio };
