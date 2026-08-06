# Roadmap

## Hecho

- **Fase 0** — Fork convertido en producto de un solo comercio: sin capa SaaS
  (planes, trial, super-admin, impersonación, registro público), SQLite en
  vez de MySQL.
- **Fase 1** — Empaquetado como app de escritorio Windows (Electron +
  `php artisan serve` embebido, front servido desde el mismo origen, datos
  persistentes separados del código en `%APPDATA%`).
- **Backups automáticos** — diarios, mientras la app esté abierta, con
  retención de 14 días.
- **Manual corto** (`MANUAL.md`) y **guía de ARCA a producción**
  (`GUIA_ARCA.md`).
- **Ícono real** del instalador.
- Sacado el registro público del SaaS (`/onboarding`, "Crear cuenta",
  `AuthController::register`) — no tenía sentido en un sistema de un solo
  comercio y era una superficie sin usar que igual quedaba viva.
- **Resiliencia de ARCA offline** — si se corta internet a mitad de emitir
  una factura o nota de crédito, ya no se pierde ni queda en un estado raro:
  queda "pendiente", se reintenta sola en segundo plano (cola de Laravel +
  `EmitirFacturaJob`/`EmitirNotaCreditoJob`, worker corriendo dentro de la
  app vía `startQueueWorker()`), y la cajera lo ve reflejado en pantalla
  (Home, Dashboard, Facturas) sin hacer nada manual.
- **IA (Gemini) desactivada** — asistente, sugerencias de precio/categoría,
  generación de imágenes y escaneo de facturas por IA quedaron comentados
  (no borrados) tanto en las rutas del backend como en el flag `tieneIA` de
  `usePlan.js` — se reactiva todo volviendo ese flag a `true` y
  descomentando las rutas correspondientes en `routes/api.php`.
- **Login** simplificado a un solo formulario (sin panel de marca ni
  "Continuar con Google", que no aplican a un sistema de un solo comercio).
- **Compras por proveedor** — desde el detalle de un producto se puede ver
  a qué proveedores se le compró y a qué precio cada vez (antes solo se
  veía la última compra, sin desglose).
- **Paleta de colores** propia del cliente (mostaza/dorado + modo oscuro en
  marrón, en vez de los colores genéricos de Kamex).
- **Actualizaciones automáticas** — la app chequea sola al arrancar contra
  los releases de `github.com/KameyhaFacundo/escritorio-launcher` (repo
  público, sin token embebido), descarga en segundo plano si hay una
  versión nueva, y la instala sola al cerrar el programa
  (`electron-updater`, ver `checkForAppUpdates()` en `electron/main.js`).
  Para publicar una release nueva: subir la versión en `package.json` y
  correr `npm run release` con un `GH_TOKEN` (Personal Access Token de
  GitHub, scope `repo`) en el entorno.

## Futuro (sin definir todavía)

Estos quedan anotados para más adelante — ninguno tiene una integración
elegida (marca/modelo, protocolo, etc.), así que antes de implementar
cualquiera hace falta definir eso primero:

- **Balanzas** — integrar una balanza electrónica al POS (pesar en el
  momento de la venta, en vez de cargar el peso a mano). Falta definir
  marca/modelo objetivo y cómo se conecta (serial/USB/red).
- **Más sucursales** — el modelo de datos ya soporta múltiples sucursales
  (`Sucursal`, stock por sucursal), pero hoy asume que todas corren contra
  la misma base local. Para sucursales en ubicaciones físicas distintas
  hace falta definir cómo se sincronizan entre sí (¿VPN entre locales?
  ¿una nube intermedia?).
- **Impresoras fiscales** — hoy la impresión de tickets es genérica
  (`imprimirTicket.js`). Una impresora fiscal real tiene su propio
  protocolo de comandos por marca/modelo — falta definir cuál.
