# 11. Fundación de la aplicación móvil

## Plataforma y navegación

- React Native + Expo SDK 54 + TypeScript.
- Expo Router para rutas y navegación.
- Development Build recomendado para probar cámara, SQLite y SecureStore en dispositivos reales.
- Identificadores de paquete iniciales: `com.momentia.mobile` en Android e iOS.

## Seguridad y API

- Token de acceso almacenado en Expo SecureStore.
- Cliente HTTP centralizado con Bearer token, respuestas JSON, manejo de 204 y errores tipados.
- URL de API por entorno mediante `EXPO_PUBLIC_API_URL`.
- Nunca incluir secretos privados en variables `EXPO_PUBLIC_*`; son visibles en el bundle.

## Persistencia offline inicial

SQLite crea:
- `sync_operations`: cola persistente con identificador idempotente, tipo, payload versionado, estado, intentos, próxima reejecución y dependencias.
- `cached_entities`: caché local por tipo/identificador y versión del servidor.

Los estados permitidos distinguen operaciones locales, en cola, en carga, procesadas, sincronizadas, reintentables, permanentes y canceladas. Aún no se ha implementado el worker que ejecuta y reconcilia esta cola.

## Primera pantalla

La pantalla de inicio verifica la inicialización de SQLite y la disponibilidad de `GET /health`. No representa todavía el diseño final ni el flujo de autenticación.

## Próximos entregables móviles

1. Flujo OIDC completo, deep links y cierre de sesión.
2. Navegación de Social, Eventos, Parejas, Círculos y Social Audio.
3. Cámara/galería, preparación segura y carga reanudable.
4. Worker offline con backoff, idempotencia, dependencias y resolución de conflictos.
5. Cliente Socket.IO autenticado, heartbeat y reconexión de Social Audio.
6. Notificaciones, accesibilidad, analítica respetuosa con privacidad y pruebas E2E.
7. Builds Android/iOS, firma, distribución interna y pruebas en dispositivos.

## Verificación

El workflow `.github/workflows/mobile-check.yml` instala dependencias, comprueba compatibilidad del SDK Expo y ejecuta TypeScript. Pasar CI no sustituye pruebas en emuladores/dispositivos ni compilaciones nativas.
