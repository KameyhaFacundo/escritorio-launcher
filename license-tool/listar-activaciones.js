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

const hoy = new Date();
const hoyISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

// Aviso con margen — sin esto, una renovación de 6 meses recién se nota
// como "por vencer" el mismo día que ya venció, tarde para avisarle al
// cliente o generarle el código nuevo a tiempo.
const DIAS_AVISO_PREVIO = 15;
const diasHasta = (vence) => Math.round((new Date(`${vence}T00:00:00`) - new Date(`${hoyISO}T00:00:00`)) / 86400000);

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
  if (!r.vence) {
    console.log(`✓ ${r.cliente.padEnd(20)} ${r.deviceCode.padEnd(22)} ${'SIN VENCIMIENTO'.padEnd(24)} generado ${r.fechaGenerado}`);
    continue;
  }
  const faltan = diasHasta(r.vence);
  const marca = faltan < 0 ? '✗' : faltan <= DIAS_AVISO_PREVIO ? '⚠' : '✓';
  const estado = faltan < 0 ? 'VENCIDA'
    : faltan === 0 ? 'VENCE HOY'
    : faltan <= DIAS_AVISO_PREVIO ? `vence en ${faltan} días — renovar`
    : `vence ${r.vence}`;
  console.log(`${marca} ${r.cliente.padEnd(20)} ${r.deviceCode.padEnd(22)} ${estado.padEnd(24)} generado ${r.fechaGenerado}`);
}
console.log('');
