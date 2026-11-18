# 10. Comparativa de proveedor de identidad — 18 noviembre 2026

## Decisión recomendada

**Recomendar Supabase Auth para el MVP, sujeto a una prueba técnica de integración antes de activarlo en producción.** No se aprueba todavía un cambio irreversible de proveedor ni se eliminan los componentes OIDC/JWT existentes.

Motivos:
- Plan gratuito publicado con 50.000 usuarios activos mensuales (MAU), MFA básico, proveedores OAuth y claves JWKS para verificar JWT.
- Quickstart oficial vigente para React Native + Expo.
- Su JWT/JWKS encaja mejor con el verificador basado en `jose` que ya existe en la API que el formato de certificados X.509 de Firebase.
- Mantiene desacoplados los datos del producto: perfiles, espacios, fotos, permisos y metadatos continúan en PostgreSQL de MOMENTIA; Supabase Auth solo sería autoridad de credenciales/identidad externa.

**Condición importante:** Supabase Auth pertenece a un proyecto Supabase que también incluye una instancia PostgreSQL administrada. No debemos mover allí el modelo principal de MOMENTIA por comodidad. Se debe tratar como almacén de identidad separado y sincronizar/provisionar el usuario interno en nuestra propia base mediante el servicio de identidad idempotente.

## Comparación

| Criterio | Clerk | Supabase Auth | Firebase Authentication |
|---|---|---|---|
| Plan gratuito publicado | 50.000 MRU por aplicación | 50.000 MAU | Autenticación estándar incluida en Spark; SMS se factura. Identity Platform tiene límites y facturación propios |
| Precio de entrada publicado | $0; Pro $20/mes facturado anual | $0; Pro desde $25/mes | $0 en Spark; Blaze es pago por uso para otros servicios/Identity Platform |
| React Native / Expo | SDK oficial `@clerk/expo` | Quickstart oficial React Native/Expo | SDKs móviles; integración requiere validar el camino Expo elegido |
| JWT para backend propio | JWT y JWKS disponibles | JWT y JWKS disponibles | ID token Firebase; verificación oficial con Firebase Admin SDK o claves públicas X.509 |
| MFA | No incluido en Hobby; disponible en Pro | MFA básico incluido en Free | MFA/Identity Platform puede cambiar límites y costos |
| Riesgo de costos | El salto de MRU o funciones Pro puede exigir plan pago | El Auth free tiene 50k MAU; el proyecto Free se pausa tras una semana inactivo y tiene límites de DB/egress/storage | Teléfono/SMS tiene costo; al habilitar Identity Platform cambian límites Spark/Blaze |
| Dependencia del proveedor | Media: identidad, UI y gestión de usuarios | Media: identidad y proyecto Supabase; JWT/JWKS estándar reduce acoplamiento | Media: tokens y SDK propios de Firebase; integración de backend específica |

## Costos y límites que debemos vigilar

### Clerk
- Hobby: $0, sin tarjeta, hasta 50.000 MRU por aplicación; máximo 3 conexiones sociales.
- La tabla de precios marca MFA, passkeys y quitar branding como funciones no incluidas en Hobby.
- Pro: $20/mes con facturación anual; incluye 50.000 MRU y cobra excedentes según volumen.
- Adecuado si priorizamos experiencia de autenticación lista para usar y aceptamos un costo futuro por funciones avanzadas.

### Supabase Auth
- Free: $0, 50.000 MAU, OAuth social, MFA básico y 1 GB de almacenamiento de archivos del proyecto; el proyecto gratuito se pausa después de una semana de inactividad.
- Pro: desde $25/mes; incluye 100.000 MAU y evita la pausa por inactividad. El precio total puede crecer por cómputo, egreso y almacenamiento.
- La cuota de 50.000 MAU corresponde a autenticación; no significa que las fotografías de MOMENTIA deban almacenarse en Supabase Storage.

### Firebase Authentication
- Firebase Spark ofrece un nivel sin costo para servicios estándar de autenticación; el envío de SMS se factura.
- Al actualizar a Firebase Authentication with Identity Platform, Spark tiene un límite publicado de 3.000 usuarios activos diarios para la mayoría de proveedores; en Blaze el esquema incluye 50.000 MAU sin costo y luego cobra por MAU según proveedor.
- Los ID tokens se verifican con Firebase Admin SDK. La verificación JWT de terceros exige issuer, audience, subject, expiración y claves públicas X.509 específicas de Firebase; no es un reemplazo directo de la URL JWKS estándar usada por el verificador actual.

## Integración con la arquitectura de MOMENTIA

1. La app React Native autentica al usuario con el proveedor elegido y almacena la sesión únicamente mediante almacenamiento seguro del sistema operativo.
2. La app envía un access token al backend por HTTPS.
3. NestJS valida firma, issuer, audience, expiración y claims requeridos.
4. El servicio de identidad resuelve la combinación única `(issuer, subject)` y provisiona el usuario interno si corresponde.
5. PostgreSQL de MOMENTIA sigue siendo la fuente de verdad para perfiles, roles, permisos, espacios, publicaciones y relaciones.
6. El proveedor externo nunca decide por sí solo si alguien puede leer una foto o entrar a un círculo: cada autorización se comprueba en NestJS.
7. La sincronización de identidad debe ser idempotente y tolerar reintentos; no existe una transacción distribuida entre el proveedor y nuestra base.
8. La app puede abrir datos locales y encolar operaciones offline con una sesión previamente válida. Un registro nuevo, login, renovación de credenciales y operaciones remotas requieren conexión; nunca se debe prometer autenticación nueva completamente offline.

## Prueba técnica obligatoria antes de cerrar DEC-001

- Crear proyecto Supabase de desarrollo separado de producción.
- Confirmar issuer, audience, algoritmo y endpoint JWKS reales del proyecto.
- Verificar si el JWT de acceso entrega email y señal verificable de email confirmado. Si falta `email_verified`, añadir un Auth Hook/claim controlado o consultar el usuario al proveedor; no inferir que un email está verificado.
- Adaptar la normalización de claims sin acoplar el dominio de MOMENTIA al formato Supabase.
- Probar altas, login, logout, expiración, renovación, cambio de email, usuario suspendido, revocación, JWKS rotado y caída temporal del proveedor.
- Probar persistencia segura de sesión en Android/iOS y comportamiento offline.
- Confirmar límites de envío de email, entregabilidad, proveedores OAuth y términos aplicables a la app.
- No guardar secretos de proveedor en el repositorio ni en variables públicas del cliente.

## Resultado

**Recomendación actual: Supabase Auth para el MVP; Clerk como alternativa si la experiencia gestionada justifica pagar; Firebase como alternativa si priorizamos el ecosistema Google y aceptamos una verificación específica de sus tokens.**

DEC-001 permanece **pendiente de aprobación y prueba técnica**. No desplegar credenciales reales ni cambiar producción hasta cerrar esas pruebas.

## Fuentes oficiales consultadas

- Clerk Pricing: https://clerk.com/pricing
- Clerk manual JWT verification: https://clerk.com/docs/guides/sessions/manual-jwt-verification
- Expo — Using Clerk: https://docs.expo.dev/guides/using-clerk/
- Supabase Pricing: https://supabase.com/pricing
- Supabase React Native quickstart: https://supabase.com/docs/guides/auth/quickstarts/react-native
- Supabase JWT/JWKS: https://supabase.com/docs/guides/auth/jwts
- Firebase Pricing: https://firebase.google.com/pricing
- Firebase Authentication limits: https://firebase.google.com/docs/auth/
- Firebase verify ID tokens: https://firebase.google.com/docs/auth/admin/verify-id-tokens
