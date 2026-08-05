const os = require('os');

// IPv4 no-interna (ni loopback ni virtual típico) para mostrarle al dueño del
// local qué dirección escribir en el navegador de cada caja.
function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

module.exports = { getLanIp };
