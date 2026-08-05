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

## En curso / próximo

- **Resiliencia de ARCA offline** — hoy si se corta internet a mitad de
  emitir una factura, se pierde o queda en un estado raro. Falta una cola
  de reintento con estado "pendiente de CAE" visible en la UI.
- **Actualizaciones automáticas** — hoy cada versión nueva es reinstalar a
  mano con un instalador nuevo. Falta algo tipo `electron-updater` contra
  los releases de GitHub.

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
