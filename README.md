# escritorio-launcher

Empaqueta [back-sistema-stock-escritorio](../back-sistema-stock) y
[front-sistema-stock-escritorio](../front-sistema-stock) como una app de
escritorio Windows: arranca el backend Laravel con un PHP embebido y sirve el
build de React desde el mismo origen. Las cajas se conectan por navegador a
la IP de LAN de la PC donde corre esta app (se muestra al abrirla).

Requiere que `back-sistema-stock` y `front-sistema-stock` estén clonados como
carpetas hermanas de esta (mismo directorio padre) — `scripts/build-resources.js`
los busca ahí.

## Setup

```sh
npm install
npm run build-resources   # copia+compila los otros dos repos en resources/
npm start                 # corre la app sin empaquetar, para probar
```

La primera vez, `build-resources` va a avisar si falta el PHP portátil (paso
manual, una sola vez — ver instrucciones que imprime el script).

## Generar el instalador

```sh
npm run dist
```

Deja el `.exe` (NSIS, instalación por usuario, sin pedir admin) en `dist-installer/`.

## Cómo persisten los datos

El código de la app (PHP, Laravel, el build de React) vive donde se instaló
la app y se reemplaza en cada actualización. Los datos reales del comercio —
`.env` (con su `APP_KEY`/`JWT_SECRET` propios), la base SQLite, logs, imágenes
subidas — viven aparte, en `%APPDATA%\Stock Ferretería\` (ver `electron/backend.js`
y `back-sistema-stock/bootstrap/app.php`), así que sobreviven a una reinstalación.
