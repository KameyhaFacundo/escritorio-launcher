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
  "channel": "nombre-del-canal",
  "icon": "build/icon.ico"
}
```

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

## Publicar una actualización para un cliente puntual

```
npm run release -- <nombre-cliente>
```

Sin argumento, usa `stock-ferreteria` (el cliente actual) por defecto.

El script busca `clients/<nombre-cliente>/config.json`, arma `resources/`
igual que siempre, y publica en GitHub con el nombre/ícono/canal de ESE
cliente — sin tocar nada de los demás.
