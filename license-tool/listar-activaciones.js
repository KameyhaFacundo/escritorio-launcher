// Muestra todos los códigos de activación que generaste hasta ahora (ver
// activaciones.json, que arma generar-activacion.js solo), ordenados por
// vencimiento — así de un vistazo ves quién está por vencer o ya venció,
// sin tener que acordarte de nada a mano.
//
// Uso: node listar-activaciones.js
const fs = require('fs');
const path = require('path');

const registroPath = path.join(__dirname, 'activaciones.json');
if (!fs.existsSync(registroPath)) {
  console.log('Todavía no generaste ningún código con generar-activacion.js.');
  process.exit(0);
}

const registro = JSON.parse(fs.readFileSync(registroPath, 'utf8'));
if (!registro.length) {
  console.log('El registro está vacío.');
  process.exit(0);
}

const hoyISO = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

// Sin vencimiento (licencia definitiva) va al final — no hay nada que
// vigilar ahí. Entre las que sí vencen, la más próxima a vencer primero.
const ordenado = [...registro].sort((a, b) => {
  if (!a.vence && !b.vence) return 0;
  if (!a.vence) return 1;
  if (!b.vence) return -1;
  return a.vence.localeCompare(b.vence);
});

console.log('');
for (const r of ordenado) {
  const estado = !r.vence ? 'SIN VENCIMIENTO'
    : r.vence < hoyISO ? 'VENCIDA'
    : r.vence === hoyISO ? 'VENCE HOY'
    : `vence ${r.vence}`;
  const marca = r.vence && r.vence < hoyISO ? '✗' : r.vence && r.vence <= hoyISO ? '⚠' : '✓';
  console.log(`${marca} ${r.cliente.padEnd(20)} ${r.deviceCode.padEnd(22)} ${estado.padEnd(18)} generado ${r.fechaGenerado}`);
}
console.log('');
