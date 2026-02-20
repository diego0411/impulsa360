# impulsa360

Aplicacion React Native + Expo para registro/sincronizacion de activaciones con soporte offline.

## Requisitos

- Node 18+
- npm 9+
- JDK 17
- Android SDK instalado

## Configuracion de entorno

1. Copia `.env.example` a `.env` y completa valores reales:

```bash
cp .env.example .env
```

Variables requeridas:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Nota: para builds Android release, la app tambien puede leer estas credenciales desde
`app.json` en `expo.extra.supabaseUrl` y `expo.extra.supabaseAnonKey`.

2. Configura firma Android release:

```bash
cp android/keystore.properties.example android/keystore.properties
```

Completa en `android/keystore.properties`:

- `storeFile`
- `storePassword`
- `keyAlias`
- `keyPassword`

`storeFile` es una ruta relativa a `android/app` (ejemplo recomendado: `../../release-upload.jks`).

Tambien puedes usar variables de entorno `ANDROID_RELEASE_*`.

## Comandos utiles

- `npm run lint`
- `npx expo-doctor`
- `npm run preflight:android`
- `npm run build:android:aab`

`build:android:aab` genera un Android App Bundle para Google Play.

## Versionado Play Store

Se controla en `android/gradle.properties`:

- `android.versionCode` (entero, debe subir en cada release)
- `android.versionName` (semver visible para usuario)

## Checklist previo a produccion

1. `npm run lint`
2. `npx expo-doctor`
3. `npm run preflight:android`
4. `npm run build:android:aab`
5. QA manual en dispositivo real:
   - login
   - formulario completo
   - camara
   - ubicacion
   - flujo offline -> online -> sincronizacion
6. Verificar Play Console:
   - Data Safety
   - Privacy Policy
   - permisos declarados
   - categoria/contenido
