# Restaurar un backup (probado el 2026-08-08 — funciona)

Para el día que haga falta de verdad: se perdió/corrompió la base de un
cliente y hay que volver a un backup. No hay ningún comando armado para
esto (`backup:run` solo genera el backup, no lo restaura) — el
procedimiento manual es simple:

1. **Cerrá la app del todo** en la PC del cliente (revisá que no quede
   ningún proceso `php.exe` de esa instalación corriendo — si Windows no
   te deja reemplazar el archivo en el paso 4, es por esto).

2. Los backups están en:
   `%APPDATA%\<NombreDelCliente>\storage\app\backups\`
   (`<NombreDelCliente>` es el `appName` de `clients/<cliente>/config.json`
   — "Palomar", "StockFerreteria", etc.)

3. Elegí el `.gz` con la fecha que necesitás y descomprimilo (7-Zip, o
   cualquier programa que abra `.gz`) — adentro hay un solo archivo,
   `database.sqlite`.

4. Renombralo (si hace falta) a `database.sqlite` y reemplazá el que está
   en `%APPDATA%\<NombreDelCliente>\database.sqlite` por este.

5. Abrí la app de nuevo. Si el backup es de una versión un poco vieja,
   corre solo las migraciones que falten al arrancar (es el mismo
   `ensureInitialized()` de siempre) — no hace falta correr nada a mano.

## Verificación hecha

Se probó con un backup real de Palomar (2026-08-08), restaurado en una
copia aislada (nunca se tocó la base real de esa instalación):
- El `.gz` descomprime sin errores.
- `PRAGMA integrity_check` da `ok`.
- Los datos están completos (productos, ventas, proveedores, etc. con la
  cantidad de filas esperada).
- Laravel arranca contra el archivo restaurado sin problemas y corre la
  migración pendiente sola, sin perder datos.
