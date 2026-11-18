# MOMENTIA Mobile

Aplicación nativa Android/iOS basada en Expo, React Native y TypeScript.

## Primer arranque

1. Instalar Node.js 22 o superior y las herramientas Android/iOS correspondientes.
2. Desde esta carpeta ejecutar `npm install`.
3. Definir `EXPO_PUBLIC_API_URL` apuntando a la API (por ejemplo `http://10.0.2.2:3000/api/v1` para Android Emulator).
4. Ejecutar `npm run start`; para cámara, SQLite y SecureStore se recomienda un Development Build.

## Base inicial implementada

- Navegación Expo Router.
- Cliente HTTP con Bearer token opcional y errores tipados.
- Almacenamiento seguro de token mediante Expo SecureStore.
- SQLite local con tablas iniciales para operaciones pendientes y entidades cacheadas.
- Pantalla de arranque con comprobación de API y base local.

## Aún pendiente

Autenticación UI/OIDC completa, navegación por experiencias, cámara y flujo de carga, cola de sincronización/reintentos, conflictos, notificaciones, audio nativo, pruebas y builds firmadas. La tabla local no implica que la sincronización offline esté implementada todavía.
