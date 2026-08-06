# Publicar por cliente (canales de actualización)

Un solo código, un solo repo — lo que cambia por cliente es el nombre del
instalador, el ícono, y el **canal** de actualizaciones (para que la
actualización de un cliente nunca le llegue a otro). Ver el plan completo
guardado con Claude si hace falta repasar el porqué.

## Estructura

```
clients/
  _template/         ← copiar para armar un cliente nuevo
    config.json
  <nombre-cliente>/   ← uno por cliente real, NO se sube a git
    config.json
```

`clients/*` está en `.gitignore` salvo `_template/` y este README.

## `config.json`

```json
{
  "productName": "Nombre que ve Windows en el instalador",
  "appId": "com.kamex.nombre-del-cliente",
  "appName": "NombreDelCliente",
  "channel": "nombre-del-canal",
  "icon": "build/icon.ico"
}
```

- `appId` y `appName` — **tienen que ser únicos por cliente, siempre.**
  Windows usa `appId` para saber "¿esta app ya está instalada?" — con el
  mismo `appId` para dos clientes distintos, instalar el segundo actualiza
  EN EL LUGAR la carpeta de instalación del primero en vez de instalarse
  aparte (pasa sin importar qué `productName` tenga cada uno). `appName`
  controla dónde vive la base de datos real de ese cliente
  (`AppData\Roaming\<appName>`) — con el mismo valor para dos clientes,
  ambos leerían/pisarían la misma base. Sin nombre ni tildes ni espacios,
  como `StockFerreteria`.
- `channel`: minúsculas, sin espacios ni tildes ni acentos (ej.
  `ferreteria-castro`, no `Ferretería Castro`) — se usa tal cual en el nombre
  de archivo que GitHub genera. `stock-ferreteria` (el cliente actual) usa
  a propósito `"latest"` — es el canal que ya tenían instalado las 0.1.1/0.1.2
  publicadas ANTES de que existiera este sistema de canales; cambiarle el
  nombre ahora haría que esas instalaciones ya hechas dejaran de ver
  actualizaciones nuevas (quedarían escuchando un canal viejo que ya no se
  publica más). Un cliente realmente nuevo sí puede (y debe) tener su propio
  nombre de canal desde el primer build.
- `icon`: ruta relativa a este repo. Si el cliente no tiene ícono propio, se
  puede dejar `build/icon.ico` (el genérico).

**Para probar dos clientes en la misma PC** (ej. de desarrollo): con
`appId`/`appName` distintos, quedan instalados aparte, cada uno con su
propia carpeta y su propia base — no hace falta desinstalar uno para
probar el otro.

## Publicar una actualización para un cliente puntual

```
npm run release -- <nombre-cliente>
```

Sin argumento, usa `stock-ferreteria` (el cliente actual) por defecto.

El script busca `clients/<nombre-cliente>/config.json`, arma `resources/`
igual que siempre, y publica en GitHub con el nombre/ícono/canal de ESE
cliente — sin tocar nada de los demás.
