# 04 - Documentacion Tecnica

## 1. Resumen Tecnico
- Aplicacion: `Impulsa360`
- Tipo: `React Native (Expo)`
- Backend: `Supabase`
- Plataforma objetivo principal: `Android`
- Paquete Android: `com.integrat360.impulsa360`
- Version actual: `1.0.10`
- Version code actual: `17`

## 2. Stack Tecnologico
1. `expo ~52.0.49`
2. `react-native 0.76.9`
3. `@supabase/supabase-js ^2.49.3`
4. `@react-native-async-storage/async-storage`
5. `expo-sqlite` (plugin habilitado)
6. `expo-location`
7. `expo-image-picker`
8. `expo-file-system`

## 3. Estructura Base Del Proyecto
1. `App.js`: flujo principal de sesion, conectividad y sincronizacion.
2. `components/AuthScreen.js`: login online + PIN offline.
3. `components/FormularioActivacion.js`: captura de datos, foto y guardado local.
4. `components/FormulariosPorImpulsador.js`: historial y detalle de activaciones.
5. `lib/supabase.js`: cliente Supabase y fallback stub.
6. `lib/storage.js`: persistencia local de formularios.
7. `lib/upload.js`: compresion y subida de imagenes a bucket.
8. `lib/offlinePin.js`: PIN local offline con bloqueo por intentos.
9. `scripts/preflight-android-release.sh`: validaciones previas a build release.

## 4. Flujo Funcional Principal
## 4.1 Autenticacion
1. Usuario inicia sesion con correo/contrasena.
2. App consulta perfil de activador en tabla `activadores`.
3. Se guarda cache local de usuario en `AsyncStorage`.

## 4.2 Registro De Activacion
1. Usuario llena formulario de activacion.
2. App captura foto y ubicacion.
3. Si no hay red, guarda registro local con estado `offline_pending`.

## 4.3 Sincronizacion
1. La app lee formularios locales pendientes.
2. Sube foto a Supabase Storage (`fotos-activaciones`).
3. Hace `upsert` en tabla `activaciones`.
4. Si completa, elimina registro local pendiente.

## 4.4 Modo Offline Y PIN Local
1. Tras login online, puede configurarse PIN local (4-6 digitos).
2. El PIN se almacena localmente en hash + salt.
3. En offline, si hay sesion cacheada y PIN configurado, se requiere PIN.
4. 5 intentos fallidos bloquean por 5 minutos.

## 5. Modelo De Datos (Resumen)
Tabla principal utilizada: `public.activaciones`.

Campos relevantes usados por app:
1. `id`
2. `usuario_id`
3. `impulsador`
4. `plaza`
5. `tipo_activacion`
6. `tamano_tienda`
7. `tipo_comercio`
8. `foto_url`
9. `fecha_activacion`
10. `latitud`
11. `longitud`
12. `ciudad_activacion`
13. `zona_activacion`
14. `estado_sync`

## 6. Configuracion Y Variables
Variables usadas:
1. `EXPO_PUBLIC_SUPABASE_URL`
2. `EXPO_PUBLIC_SUPABASE_ANON_KEY`
3. Firma Android release por `ANDROID_RELEASE_*` o `android/keystore.properties`.

Configuracion de versionado:
1. `android.versionCode` en `android/gradle.properties`
2. `android.versionName` en `android/gradle.properties`

## 7. Build Y Release
Comandos:
1. `npm run lint`
2. `npm run preflight:android`
3. `npm run build:android:aab`

Salida AAB:
- `android/app/build/outputs/bundle/release/app-release.aab`

Artefacto de entrega actual:
- `releases/impulsa360-com.integrat360.impulsa360-v1.0.10-code17.aab`

## 8. Consideraciones Tecnicas
1. La app depende de permisos de camara y ubicacion.
2. Recomendado monitoreo continuo de errores de sincronizacion.
3. Recomendado definir RLS/politicas finas en Supabase antes de escalar base de usuarios.
4. Recomendado agregar suite de pruebas automatizadas en siguientes iteraciones.

## 9. Mantenimiento Sugerido
1. Aumentar `versionCode` en cada release de Play.
2. Mantener changelog por version.
3. Revisar alertas de Play Console y aplicar mejoras no bloqueantes.
4. Rotar credenciales y custodiar keystore en repositorio seguro (fuera de codigo compartido).
