# Auditoría documental de la aplicación móvil Impulsa360

Fecha de corte: `2026-10-19`

Alcance: working tree local del repositorio `impulsa360`, incluyendo cambios sin commitear. La auditoría se realizó por lectura estática de código y migraciones; no se ejecutaron la app, builds, pruebas ni migraciones. Este documento no contiene claves, contraseñas, tokens ni datos personales.

## 1. Identificación del proyecto, versiones y tecnologías

### 1.1 Identificación

| Dato | Valor |
|---|---|
| Nombre comercial | `Impulsa360` |
| Nombre técnico / slug | `impulsa360` |
| Paquete Android | `com.integrat360.impulsa360` |
| Versión de aplicación | `1.0.28` |
| `versionCode` Android | `78` |
| Plataforma principal | Android |
| Backend | Supabase |

Fuentes: `package.json`, `app.json`, `android/gradle.properties`, `android/app/build.gradle`.

Nota de alcance: este documento describe código, configuración y contratos técnicos. No transfiere cuentas, accesos, credenciales, keystores ni infraestructura operativa; cualquier entrega de accesos debe tramitarse por un canal separado y autorizado.

### 1.2 Stack observado

- Expo `~54.0.37`.
- React Native `0.81.5`.
- React `19.1.0`.
- Nueva arquitectura de Expo/React Native habilitada (`newArchEnabled: true`).
- Supabase JS `^2.49.3`.
- Persistencia local con `@react-native-async-storage/async-storage` y `expo-secure-store`.
- Cámara, ubicación, archivos, imágenes y selector de imágenes mediante módulos de Expo.
- Cifrado local con `@noble/ciphers` y `@noble/hashes`.
- Navegación por estado interno en `App.js`; `@react-navigation/native` y `@react-navigation/native-stack` figuran en `package.json`, pero no se observó su uso en el árbol actual.
- Android nativo con Kotlin `2.1.20`, `compileSdkVersion=36`, `targetSdkVersion=36` y `minSdkVersion=24`.

### 1.3 Dependencias funcionales relevantes

`expo-camera`, `expo-location`, `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`, `expo-secure-store`, `expo-splash-screen`, `@react-native-community/netinfo`, `@react-native-community/datetimepicker`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-safe-area-context`, `react-native-screens`, `react-native-url-polyfill` y `uuid`.

### 1.4 Método y limitaciones de la auditoría

- Se contrastó la documentación existente con el código y las migraciones del working tree.
- Las afirmaciones sobre comportamiento se basan en el código revisado, no en pruebas de ejecución.
- La documentación de `docs/cliente/` está desactualizada respecto de la versión real: describe `1.0.10`, `versionCode 17`, Expo 52 y React Native 0.76.9.
- No se revisó la base de datos desplegada; solo las migraciones y consultas presentes en el repositorio.
- Clasificación usada en este documento: **hecho comprobado** es lo que puede verificarse en el código o las migraciones locales; **riesgo** es una consecuencia posible que requiere validación operativa; **inferencia** es una conclusión razonable no comprobada en ejecución.
- No se encontró código del portal web ni un contrato compartido versionado en este repositorio. No se puede confirmar desde aquí qué tablas, RPC o políticas comparte el portal ni qué versión está desplegada.
- Las migraciones locales no son prueba del estado desplegado. La migración de telemetría `202610050001_telemetria_eventos.sql` declara explícitamente que no fue aplicada remotamente en la tarea que la creó, y los scripts de `supabase/manual/` indican aplicación manual controlada.

## 2. Arquitectura y estructura del código

### 2.1 Organización general

| Ruta | Responsabilidad |
|---|---|
| `App.js` | Estado global, sesión, roles, navegación por estado, sincronización, notificaciones, PIN y orquestación de fotos. |
| `components/` | Pantallas y componentes de UI: autenticación, formulario, historial, control, notificaciones, cámara, intro y selectores. |
| `lib/` | Reglas de negocio, persistencia, cifrado, PIN, Supabase, subida de fotos, telemetría, periodos, plazas y utilidades. |
| `supabase/migrations/` | Esquema, RPC, RLS, Storage y telemetría. |
| `supabase/manual/` | Scripts apply/rollback/verify de cambios operativos específicos. |
| `tests/` | Pruebas unitarias de reglas puras y flujos auxiliares. |
| `android/` | Proyecto nativo Android, firma, manifiesto y módulo de diagnóstico de salida. |
| `scripts/` | Preflight de release Android. |
| `docs/cliente/` | Documentación histórica de entrega, actualmente desalineada con la versión del código. |

### 2.2 Flujo de arranque y navegación

- `index.js` importa `react-native-get-random-values` y registra `App`.
- `App.js` contiene `AppShell`, que mantiene `vistaActiva` y cambia de pantalla mediante estado. Las dependencias de React Navigation están declaradas en `package.json`, pero no se encontró `NavigationContainer` ni uso de navegación en `App.js`.
- Las vistas principales son `formulario`, `control`, `activaciones` y `notificaciones`.
- `LaunchIntroScreen` se utiliza como pantalla de introducción animada.
- La cámara, el modal de PIN y los selectores se montan como componentes especializados.

### 2.3 Separación de responsabilidades

- La UI de formulario consume reglas centralizadas de `lib/formularioActivacionRules.js`, `lib/reglasFotografias.js` y `lib/elegibilidadProductos.js`.
- La sincronización y la decisión de subir o conservar pendientes viven principalmente en `App.js`.
- La persistencia y el cifrado están encapsulados en `lib/storage.js`, `lib/secureLocalStorage.js` y `lib/offlinePin.js`.
- Las reglas de acceso a datos sensibles se apoyan en RLS y RPC de Supabase.
- La telemetría se desacopla mediante una cola local y la RPC `registrar_eventos_telemetria`.

### 2.4 Observación arquitectónica

`App.js` concentra una cantidad alta de responsabilidades: sesión, roles, red, sincronización, fotos, notificaciones y navegación. Esto facilita el flujo actual, pero aumenta el acoplamiento y el costo de mantenimiento. La lógica de negocio más sensible ya está extraída a `lib/`, lo que reduce parte del riesgo.

## 3. Instalación, configuración y compilación Android

### 3.1 Instalación y scripts

Scripts declarados en `package.json`:

- `npm start`
- `npm run android`
- `npm run ios`
- `npm run web`
- `npm run lint`
- `npm run preflight:android`
- `npm run build:android:aab`

El build de release se compone de `npm run preflight:android` y `NODE_ENV=production ./gradlew :app:bundleRelease`. El artefacto esperado es `android/app/build/outputs/bundle/release/app-release.aab`.

### 3.2 Variables Supabase: runtime, preflight y compilación

**Runtime/bundle.** `lib/config.js` lee únicamente `process.env.EXPO_PUBLIC_SUPABASE_URL` y `process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY`. Expo inyecta esas variables en el bundle al compilar; no hay lectura de `app.json` en runtime. Si faltan, `HAS_SUPABASE_CONFIG` queda en falso y `lib/supabase.js` utiliza stubs.

**Build local.** `build:android:aab` ejecuta `set -a`, carga `.env` si existe y luego encadena `preflight:android` con Gradle. Por eso las variables presentes en el entorno o en `.env` pueden quedar embebidas en el bundle.

**Preflight.** `scripts/preflight-android-release.sh` busca primero variables de entorno o `.env` y, si faltan, `expo.extra.supabaseUrl` y `expo.extra.supabaseAnonKey` en `app.json`. Ese fallback solo satisface el preflight: no inyecta valores en el bundle ni modifica lo que lee `lib/config.js`.

**Configuración actual.** `app.json` no contiene hoy claves `supabaseUrl`/`supabaseAnonKey` en `expo.extra`; `eas.json` production solo declara `NODE_ENV`. La configuración de variables en EAS es externa al repositorio y no se verificó. No se transcriben valores de `.env`, EAS ni keystores en este documento.

**Consecuencia.** Un build puede pasar el preflight usando solo `app.json` y aun así arrancar sin configuración Supabase, porque el runtime no lee ese archivo. La afirmación de `README.md` de que la app puede leer esas claves desde `app.json` no está respaldada por `lib/config.js`.

### 3.3 Configuración Android

- `app.json`: orientación vertical, tema claro, nuevas arquitecturas, permisos de cámara y ubicación.
- `android/gradle.properties`: versión `1.0.28`, `versionCode=78`, SDK y arquitecturas.
- `android/app/build.gradle`: configuración de firma release y compresión/optimización.
- `android/app/src/main/AndroidManifest.xml`: `allowBackup="false"`, reglas de backup/transferencia y actualizaciones OTA de Expo deshabilitadas.
- `plugins/withAndroidNoBackup.js`: excluye `RKStorage`, `RKStorage-journal`, `sharedpref/*` y `activaciones-pendientes/` de backup y transferencia.

### 3.4 Firma y release

La firma release se obtiene desde propiedades Gradle, variables `ANDROID_RELEASE_*` o `android/keystore.properties`. El build falla si no hay credenciales de release, salvo que se habilite explícitamente `android.allowDebugSigningInRelease=true`.

El `.gitignore` excluye `.env`, `android/keystore.properties`, `*.jks` y `releases/`. El keystore de debug (`android/app/debug.keystore`) sí está versionado, lo cual es habitual para desarrollo pero no debe confundirse con la firma de producción.

Este documento no entrega ni documenta valores de firma, contraseñas, claves, cuentas o accesos. La existencia de variables o archivos de configuración es un requisito técnico del build, no un activo transferible por este anexo.

### 3.5 Permisos y restricciones

Permisos declarados: cámara, ubicación aproximada y ubicación precisa. Se bloquean micrófono, lectura de imágenes/video y escritura de almacenamiento externo. La app no usa `expo-updates` para entrega OTA; la actualización se gestiona mediante instalación de builds.

### 3.6 Preflight

`scripts/preflight-android-release.sh` valida configuración de entorno, credenciales de firma y versiones antes del build. Para Supabase acepta el fallback de `app.json`, por lo que su aprobación no garantiza que el bundle tenga configuración runtime. Es una barrera útil, pero no sustituye una prueba de instalación, migración o sincronización en dispositivo.

## 4. Autenticación, sesiones, roles y seguridad

### 4.1 Autenticación online

`AuthScreen.js` autentica con correo y contraseña, con timeout de autenticación de 12 segundos y consultas de perfil de 10 segundos. Solo acepta perfiles con `usuario_id` y `estado='activo'`. El código `PGRST116` se interpreta como perfil inexistente.

### 4.2 Sesión persistente y revalidación

`App.js` valida la sesión con `supabase.auth.getSession()` y un timeout de 8 segundos. La sesión local se guarda en `secureLocalStorage` bajo `usuario_autenticado_local`. Ante un error de autenticación definitivo se ejecuta `signOut` y se limpia el acceso local; sin conexión se conserva el usuario cacheado para el flujo offline.

### 4.3 PIN offline

`lib/offlinePin.js` implementa:

- PIN de 4 a 6 dígitos.
- Hash con scrypt (`N=2^14`, `r=8`, `p=1`, `dkLen=32`).
- Máximo de 5 intentos fallidos.
- Bloqueo temporal de 5 minutos.
- Aviso de operación lenta a los 10 segundos.
- Operaciones serializadas para evitar carreras.
- Protección ante almacenamiento corrupto.
- Claves `offline_pin_v1` en AsyncStorage e `impulsa360_offline_pin_v2` en SecureStore.

El login offline solo se permite con usuario cacheado, sin conexión y PIN configurado. Si no hay PIN, se abre el flujo de configuración.

### 4.4 Cifrado local

`lib/secureLocalStorage.js` cifra con XChaCha20-Poly1305, usa una clave en SecureStore (`impulsa360_secure_storage_key_v1`), prefijo `slc1:` y nonce de 24 bytes. En web no se aplica cifrado. Esto protege la sesión y los datos persistidos en Android, pero no equivale a cifrado de la base local completa.

### 4.5 Roles y autorización

Roles normalizados: administrador, líder y activador operativo. `App.js` calcula:

- `esAdministrador`.
- `esLider`.
- `esActivadorOperativo`.
- `liderPuedeActivar`, solo si el líder tiene `puede_activar === true`.

`App.js` calcula `puedeControl = esAdministrador || esLider || esActivadorOperativo`; por tanto, la vista `control` se incluye para los tres perfiles, con el alcance que aplique cada consulta. `puedeFormulario` y `puedeActivaciones` usan `esAdministrador || esActivadorOperativo || !esLider || liderPuedeActivar`: se habilitan por defecto salvo para un líder sin `puede_activar === true`. Las pantallas y RPC siguen aplicando sus propios filtros de alcance. `lib/rolesAdicionales.js` resuelve roles adicionales desde `activador_roles`, con caché (`roles_adicionales_confirmados`) y estados de origen `servidor`, `cache` o `no_disponible`.

La autorización efectiva no debe depender solo del cliente: las RPC y RLS de Supabase son la última barrera.

### 4.6 Protección visual de datos

- `lib/brandMask.js` enmascara la marca `YOLO` para usuarios que no son administradores.
- `lib/customerMask.js` enmascara cédula, teléfono y correo del cliente, conservando solo una parte visible.
- Estas medidas reducen exposición visual, pero no sustituyen controles de acceso ni minimización de datos.

### 4.7 Riesgos de seguridad observados

- La lógica de roles se calcula también en el cliente; debe mantenerse alineada con RLS y RPC.
- El fallback de roles a caché puede mostrar una capacidad desactualizada si el servidor no responde.
- La seguridad de las fotos depende de que las policies de Storage y las relaciones de equipo estén correctamente aplicadas en la base desplegada.

## 5. Pantallas, navegación y funcionalidades

### 5.1 Pantallas principales

| Pantalla / componente | Función |
|---|---|
| `LaunchIntroScreen` | Introducción animada. |
| `AuthScreen` | Login online, login offline, configuración/verificación de PIN y estados de error. |
| `FormularioActivacion` | Registro de activación, geolocalización, fotos, borrador y guardado. |
| `FormulariosPorImpulsador` | Historial, detalle, evidencia y paginación. |
| `ControlActivadores` | Métricas y jerarquía de activadores con alcance según administrador, líder o activador operativo. |
| `NotificacionesScreen` | Bandeja, conteo de no leídas y marcado de leídas. |
| `CameraEvidencia` | Captura de evidencia y Cash-In. |
| `SelectorRN` | Selector modal accesible. |

### 5.2 Navegación

`AppShell` mantiene `vistaActiva` y un arreglo de vistas permitidas. Si la vista actual deja de ser válida, vuelve a la primera permitida. Aunque `package.json` declara `@react-navigation/native` y `@react-navigation/native-stack`, no se observó su uso: los cambios de pantalla son condicionales por estado.

### 5.3 Formulario

El formulario incluye selección de grupo y subtipo, datos del cliente, datos del comercio/tienda, ciudad y zona, GPS, errores, productos y fotografías. Tiene borrador con debounce de 700 ms y restauración de datos locales. La captura GPS usa timeout de 15 segundos y precisión máxima de 200 metros.

### 5.4 Historial

`FormulariosPorImpulsador.js` combina registros locales y remotos, deduplica por `id` o `_id_local`, pagina de 20 en 20 y consulta el servidor solo cuando hay conexión, internet alcanzable y la consulta no está bloqueada. Usa timeouts de 10 segundos para consulta, 30 segundos para galería y 12 segundos para archivos.

### 5.5 Control

`ControlActivadores.js` muestra métricas de activadores (`Hoy`, `Semana`, `Mes`, `Total`, `Reactivación`, `Reimpresión`) y permite consultar el detalle. La vista personal consulta `activaciones` por `usuario_id` y filtra por `fecha_activacion`.

### 5.6 Notificaciones

`NotificacionesScreen.js` carga `notificaciones_destinatarios` y `notificaciones`, normaliza título, mensaje, fecha y estado de lectura, ordena de forma descendente y marca notificaciones como leídas. El badge de `AppShell` muestra el conteo y limita la visualización a `99+`.

### 5.7 Cámara

`CameraEvidencia.js` usa timeouts de 10 segundos para permisos y cámara lista, 25 segundos para captura y 10 segundos para limpieza. `lib/cameraCaptureFlow.js` exige únicamente una URI válida para mostrar el preview y separa captura, desmontaje y decisión del usuario.

## 6. Categorías, tipos de activación y reglas de negocio

### 6.1 Grupos y subtipos

| Grupo | Subtipos observados |
|---|---|
| `tienda_barrio` | `comercio`, `no_habilitado`, `reactivacion`, `config_cuenta`, `reimpresion_qr` |
| `comercio` | `comercio`, `reactivacion_comercio`, `limbo`, `no_habilitado`, `reimpresion_qr` |
| `transeunte` | `transeunte`, `reactivacion_transeunte` (`cliente_antiguo` solo por compatibilidad; no aparece en el selector actual) |
| `cliente_antiguo` | `cliente_antiguo` |

`TIPOS_TRANSEUNTE` solo ofrece `transeunte` y `reactivacion_transeunte`. La combinación `transeunte/cliente_antiguo` se conserva para registros o borradores anteriores. `normalizarCamposBorrador` convierte un borrador con `tipo_activacion='cliente_antiguo'` al grupo `cliente_antiguo` para no perder datos. `cliente_antiguo/cliente_antiguo` es la categoría principal vigente.

### 6.2 Reglas de fotografías

La matriz única está en `lib/reglasFotografias.js`:

| Grupo / subtipo | Evidencia | Cash-In |
|---|---|---|
| `comercio/comercio` | Obligatoria | Sí |
| `comercio/reactivacion_comercio` | Obligatoria | Sí |
| `comercio/limbo` | Obligatoria | Sí |
| `comercio/no_habilitado` | Obligatoria | No |
| `comercio/reimpresion_qr` | Obligatoria | Sí |
| `tienda_barrio/comercio` | Obligatoria | Sí |
| `tienda_barrio/no_habilitado` | Obligatoria | No |
| `tienda_barrio/reactivacion` | Obligatoria | Sí |
| `tienda_barrio/config_cuenta` | Obligatoria | Sí |
| `tienda_barrio/reimpresion_qr` | Obligatoria | No |
| `transeunte/transeunte` | No requerida | Sí |
| `transeunte/reactivacion_transeunte` | No requerida | Sí |
| `transeunte/cliente_antiguo` | Opcional | No |
| `cliente_antiguo/cliente_antiguo` | Opcional | No |
| Combinación desconocida | Obligatoria | Sí |

`resolverReglaFotografias` distingue `requiereEvidencia`, `evidenciaOpcional` y `requiereCashIn`. La obligatoriedad y la visibilidad son conceptos distintos:

- `resolverVisibilidadFotografias` solo devuelve `mostrarEvidencia`/`mostrarCashIn` para fotos obligatorias; no convierte una evidencia opcional en un botón visible.
- El formulario calcula `requiereFotoPrincipal = mostrarEvidencia` y `requiereFotos = requiereFotoPrincipal || requiereCashIn`. La tarjeta y los botones de foto se renderizan solo si hay al menos una foto obligatoria.
- Por eso, en la UI actual no se ofrece cámara/galería para evidencia opcional en `transeunte/cliente_antiguo` ni en `cliente_antiguo/cliente_antiguo`. Si esa evidencia ya existe en un borrador o registro legado, se conserva y se sube, pero no se puede capturar desde esos tipos.
- En `transeunte/transeunte` y `transeunte/reactivacion_transeunte` no hay evidencia requerida; solo se muestra Cash-In.
- Una combinación desconocida exige evidencia y Cash-In.

### 6.3 Regla de reactivación de 90 días

`lib/elegibilidadReactivacion.js` (`requiereValidacionReactivacion`) activa la validación si el tipo **contiene** `reactivacion` o si es exactamente `reimpresion_qr`. Normaliza cédula y teléfono y consulta la RPC `validar_elegibilidad_reactivacion` durante el guardado online y, nuevamente, durante la sincronización antes de las fotos.

La RPC local `validar_elegibilidad_reactivacion` aplica su comparación solo cuando `p_tipo_activacion like 'reactivacion%'` o es exactamente `reimpresion_qr`. Para los tipos del catálogo actual ambos criterios coinciden; un tipo no estándar que contenga `reactivacion` pero no empiece con ese prefijo haría que el cliente llame a la RPC, pero la RPC devolvería elegible sin comparar. La función exige usuario activo, limita la fecha de referencia a `current_date ± 1`, aplica una ventana de 90 días y devuelve `eligible`, `reason` y `previous_activation_date`.

### 6.4 Productos Créditos y Remesas

`lib/elegibilidadProductos.js` define reglas por `tipo_activacion`:

- Créditos: `tipo_activacion` contiene `reactivacion`, es exactamente `reimpresion_qr` o es exactamente `cliente_antiguo`. La regla no depende del grupo, por lo que también aplica a la combinación legacy `transeunte/cliente_antiguo`.
- Remesas: solo `comercio/comercio` y `transeunte/transeunte`.
- Cualquier combinación no reconocida deja ambos productos deshabilitados.
- La UI solo muestra los checkboxes elegibles y el guardado fuerza `false` cuando el producto no corresponde al tipo actual.

### 6.5 Otras reglas

- Los cuatro datos del cliente son obligatorios en todos los grupos y subtipos.
- Ciudad y zona solo son obligatorias cuando el subtipo no es `transeunte` ni `cliente_antiguo`.
- La cédula debe tener entre 6 y 8 dígitos.
- El teléfono debe tener exactamente 8 dígitos y no puede ser igual a la cédula.
- `descripcion_error` solo es obligatoria cuando `tipo_error` es `Otro`.
- Los periodos mensuales se resuelven en `lib/periodoMensual.js`.
- Las plazas canónicas son `santa_cruz`, `la_paz` y `el_alto`, con aliases.
- Las plazas temporales se cachean por usuario y se validan por vigencia y estado.

## 7. Formularios, validaciones y productos Créditos/Remesas

### 7.1 Campos y catálogos

`components/FormularioActivacion.js` contiene los catálogos `GRUPOS_ACTIVACION`, `TIPOS_TIENDAS`, `TIPOS_COMERCIO_ACTIVACION`, `TIPOS_TRANSEUNTE`, `TIPOS_CLIENTE_ANTIGUO`, `TAMANOS_TIENDA`, `RUBROS_COMERCIO`, `TIPOS_ERROR` y `CIUDADES`.

### 7.2 Validaciones de cliente

- `nombres_cliente`, `apellidos_cliente`, `ci_cliente` y `telefono_cliente` son obligatorios en todos los casos.
- Los campos vacíos, `null`, `undefined` y cadenas con solo espacios se consideran faltantes.
- La cédula acepta solo dígitos y longitud de 6 a 8.
- El teléfono exige 8 dígitos y debe ser distinto de la cédula.
- Ciudad y zona se validan según el subtipo.

### 7.3 Georreferencia

La ubicación se obtiene con `expo-location`, timeout de 15 segundos y precisión máxima de 200 metros. Si la ciudad tiene una sola zona, se autoselecciona. La migración `202608310003_ubicacion_gps_derivada.sql` agrega `distrito_gps` y `region_gps` a `activaciones`.

### 7.4 Borrador y edición

El formulario guarda borrador con debounce de 700 ms. `lib/edicionActiva` y las referencias en `App.js` protegen el estado de edición para evitar que una navegación o sincronización sobrescriba cambios en curso.

### 7.5 Productos

La elegibilidad de Créditos y Remesas se resuelve antes de guardar y se refleja en el formulario. Solo se muestran los checkboxes habilitados y, al persistir, `creditos`/`remesas` se guardan como `true` únicamente si el tipo actual los habilita; en caso contrario se fuerza `false`. Las combinaciones no reconocidas no habilitan productos. La regla está cubierta por `tests/elegibilidadProductos.test.js`.

### 7.6 Pruebas existentes

`tests/formularioActivacionRules.test.js` cubre cédula, campos obligatorios por grupo/subtipo, faltantes, descripción de error, visibilidad de fotos, las 12 combinaciones del bloque principal de la matriz y los casos legacy/cliente antiguo. `tests/elegibilidadProductos.test.js` cubre Créditos, Remesas, casos ambiguos y normalización.

## 8. Evidencias fotográficas y almacenamiento

### 8.1 Captura y preparación

- `CameraEvidencia` captura evidencia y Cash-In.
- `lib/cameraCaptureFlow.js` gestiona el flujo de captura y preview.
- `lib/cameraPhotoSafety.js` limita la captura a 12 millones de píxeles y prefiere resoluciones moderadas.
- `lib/upload.js` valida tamaño máximo de 6 MB, 12 millones de píxeles y formatos JPEG, PNG, WebP y HEIC.
- La matriz distingue evidencia obligatoria, opcional y no requerida. La sincronización solo bloquea cuando falta una foto obligatoria; si `foto_url` existe aunque sea opcional, se sube.

### 8.2 Persistencia local

Las fotos pendientes se copian a un directorio persistente (`activaciones-pendientes`). Se validan cabeceras JPEG y se evita que una limpieza elimine archivos todavía referenciados. La limpieza de temporales usa antigüedad máxima de 24 horas y un máximo de 20 archivos.

### 8.3 Subida y rutas

Las rutas nuevas son `activaciones/<usuarioId>/<recordId>/<fileName>`. Se conservan rutas históricas como `activaciones/<userId>/<id>/<fileName>`, `activaciones/<id>.jpg` y `activaciones/<id>_respaldo.jpg` para compatibilidad.

La subida al mismo path está serializada para evitar carreras. El bucket es `fotos-activaciones`.

### 8.4 Bucket privado y RLS

La migración `202609140002_storage_fotos_activaciones_private.sql` marca el bucket como privado y recrea policies de SELECT, INSERT y UPDATE para el propietario autenticado, limitadas a `activaciones/<auth.uid()>/%`.

La migración `202609170001_storage_fotos_activaciones_select_equipo.sql` agrega una policy SELECT para:

- El propietario.
- Un administrador activo.
- Un líder activo cuyo equipo contiene actualmente al dueño de la foto.

La policy usa `equipo_lider_historial.fin IS NULL`, `equipos.activo`, líder activo, `activador_equipo_historial.fin IS NULL` y fallback `activadores.equipo_id`. No modifica INSERT, UPDATE ni DELETE.

### 8.5 Diagnóstico

`lib/photoDiagnostics.js` y `lib/telemetry.js` registran eventos de inicio, éxito y error de procesamiento de fotos, además de buckets de tamaño. No se envían nombres, cédulas ni teléfonos en esos eventos.

## 9. Funcionamiento offline, persistencia y sincronización

### 9.1 Persistencia local

- Formularios: `lib/storage.js`, claves `formularios_offline_v1` y legacy `formularios_locales`.
- Web: `localStorage`; Android: `secureLocalStorage` cifrado.
- Fallback en memoria si el almacenamiento no está disponible.
- Cola de mutaciones y protección contra sobrescribir datos corruptos o temporalmente ilegibles con `[]`.
- PIN: `lib/offlinePin.js`.
- Sesión local: `usuario_autenticado_local` en `secureLocalStorage`.

### 9.2 Flujo offline

1. El usuario autenticado previamente puede ingresar con PIN si no hay conexión.
2. Si el tipo requiere validación de reactivación y hay conexión, el formulario consulta la RPC de 90 días antes de guardar.
3. Si no hay conexión, el formulario guarda `_sync.requiresEligibilityCheck` para que la validación se ejecute al sincronizar.
4. El formulario se guarda localmente.
5. Las fotos se copian a almacenamiento persistente.
6. El registro queda pendiente de sincronización y se conserva hasta completar la subida y el upsert.

### 9.3 Flujo de sincronización

`App.js` (`sincronizarFormularios`) realiza, en orden:

1. Guards de sincronización: sesión requerida, conexión/internet, edición activa, revalidación de sesión y límite de frecuencia.
2. Lectura de pendientes de `lib/storage.js`; se conservan sin procesar los legacy sin propietario y los de otro usuario.
3. Normalización por registro: UUID estable, fecha original, `estado_sync` y campos permitidos.
4. Si `requiereValidacionReactivacion(tipo_activacion)` es verdadero, llama a `validar_elegibilidad_reactivacion` con cédula, teléfono, tipo, ID y fecha de referencia **antes de las fotos**. Si no es elegible o la RPC falla, marca el error y salta ese registro sin subir fotos ni hacer upsert.
5. Resuelve la matriz `lib/reglasFotografias.js` y bloquea solo si falta una foto obligatoria (evidencia o Cash-In). La evidencia opcional no se exige.
6. Sube las fotos locales al bucket, con hasta tres intentos por foto y persistencia de la ruta remota.
7. Filtra las columnas permitidas y hace upsert en `activaciones` con `onConflict: 'id'`.
8. Tras el éxito, verifica que la sesión y la firma de fotos no hayan cambiado, elimina los archivos locales y borra el pendiente.
9. Registra errores por ID local, reintenta fallos transitorios y devuelve el resumen.

`lib/offlineSafety.js` exige lecturas con `status === 'ok'`, filtra por `usuario_id`, permite revalidar sesión para sync y serializa operaciones para evitar carreras.

### 9.4 Conectividad

`App.js` usa `NetInfo.fetch()` y `NetInfo.addEventListener` para `isConnected` e `isInternetReachable`, con fallback de 3 segundos. La sincronización automática se dispara al recuperar conexión y cuando la sesión es válida.

### 9.5 Prevención de duplicados

- El historial combina local y remoto sin duplicar por `id` o `_id_local`.
- La sincronización usa upsert con `onConflict: 'id'`.
- Las fotos se suben a rutas determinísticas por usuario y registro.
- La subida simultánea al mismo path está bloqueada.

### 9.6 Limitaciones

- **Inferencia:** no se encontró un worker o tarea nativa dedicada a sincronización en segundo plano; el disparo depende de `App.js` y del estado de red. No se validó el comportamiento en dispositivo.
- **Hecho:** la cola local se basa en AsyncStorage/SecureStore, no en una base relacional.
- **Inferencia:** la sincronización iniciada por los eventos observados requiere que la app esté abierta para continuar.
- **Hecho:** la restauración de backups está deshabilitada; una reinstalación no recupera pendientes locales.

## 10. Integración Supabase: tablas, RPC, Storage y contratos

### 10.1 Alcance: contratos locales, estado desplegado y portal web

Esta sección describe **definiciones locales** y contratos consumidos por la app. No es un inventario certificado de la base desplegada.

- **Hecho:** la migración `202610050001_telemetria_eventos.sql` declara explícitamente `NO aplicada remotamente en esta tarea`.
- **Hecho:** los scripts de `supabase/manual/` indican aplicación manual controlada y algunos rollbacks se basan en definiciones exportadas de producción. Su presencia en el repo no confirma que se hayan ejecutado.
- **Hecho:** no existe código del portal web en este repositorio. No se puede verificar aquí qué tablas, RPC, grants o políticas comparte el portal, ni qué versión de esos contratos está desplegada.
- **Inferencia:** si el portal web consume el mismo proyecto Supabase, los contratos de `activaciones`, `activadores`, roles, notificaciones o Storage podrían ser compartidos; esta auditoría no lo confirma.
- **Límite:** no se consultó la base desplegada ni se ejecutaron scripts de verificación. Cualquier afirmación sobre el estado remoto requiere acceso autorizado y lectura controlada.

No se documentan URLs, claves, cuentas, tokens, cadenas de conexión ni accesos. Los nombres de tablas, RPC y policies son contratos técnicos, no credenciales.

### 10.2 Tablas usadas o referenciadas por la app

| Tabla | Uso |
|---|---|
| `public.activaciones` | Registro principal de activaciones. |
| `public.activadores` | Perfil, estado, rol, equipo y permiso `puede_activar`. |
| `public.activador_roles` | Roles adicionales. |
| `public.activador_plaza_temporal` | Plazas/zonas temporales y vigencia. |
| `public.notificaciones` | Contenido de notificaciones. |
| `public.notificaciones_destinatarios` | Destinatarios, lectura y realtime. |
| `public.telemetria_eventos` | Eventos de diagnóstico; definición local no confirmada en remoto. |
| `public.equipos` | Equipos y estado. |
| `public.equipo_lider_historial` | Vigencia de líder por equipo. |
| `public.activador_equipo_historial` | Vigencia de activador por equipo. |

La lista refleja las tablas consultadas por la app y las migraciones revisadas; no pretende ser el esquema completo ni el estado desplegado.

### 10.3 RPC locales y contratos observados

| RPC | Contrato local observado |
|---|---|
| `control_activadores_jerarquia(p_desde, p_hasta)` | Devuelve líder, equipo, activador y métricas `hoy`, `semana`, `mes`, `total`. |
| `control_activaciones_detalle(p_activador_id, p_equipo_id, p_desde, p_hasta)` | Devuelve detalle de activaciones y evidencia. |
| `validar_elegibilidad_reactivacion(p_ci, p_telefono, p_tipo_activacion, p_fecha_referencia, p_registro_id)` | Devuelve `eligible`, `reason`, `previous_activation_date`. |
| `registrar_eventos_telemetria(p_eventos jsonb)` | Inserta un lote de 1 a 20 eventos de telemetría. |

Las RPC de control son `security definer` con `set search_path = ''` y ejecución otorgada a `authenticated`. La RPC de elegibilidad y la de telemetría revocan `public` y `anon`, y otorgan ejecución a `authenticated`. Estas son definiciones locales; su disponibilidad remota no está confirmada.

### 10.4 Storage local y políticas

- Bucket: `fotos-activaciones`.
- Privado según la migración local.
- Policies de SELECT/INSERT/UPDATE para el propietario autenticado.
- SELECT adicional para administrador activo y líder activo del equipo actual del dueño.
- No se observaron policies de DELETE en las migraciones revisadas.

La aplicación de estas policies en el proyecto remoto no se verificó. Si no están aplicadas, el comportamiento real de lectura/escritura de fotos puede diferir.

### 10.5 Contratos de datos relevantes

- `activaciones` usa `id`, `usuario_id`, `fecha_activacion`, `tipo_activacion`, datos del cliente, datos de comercio/tienda, coordenadas, URLs de fotos y campos de equipo/líder.
- La migración local de GPS agrega `distrito_gps` y `region_gps`.
- `activador_plaza_temporal` incluye `tipo_zona` con valores `universidad`, `feria`, `evento`, `campana` y `punto_temporal`, además de `ciudad_plaza` y `activo`.
- `telemetria_eventos` usa `usuario_id`, `event_name`, `occurred_at`, `run_id`, `app_version`, `build_number`, `platform`, `os_version`, `app_state`, `screen`, `phase`, buckets de pendientes/foto, etapa de sync, categoría de error y salida nativa.

Estos contratos son los que el código local espera. No se validó que las columnas y tipos coincidan con el esquema desplegado ni con el que consume el portal web.

### 10.6 Migraciones de control locales

`202607310001_control_activadores_rpc.sql` crea índices para consultas por usuario/fecha, equipo/fecha, líder/fecha y vigencias de historial. También define las dos RPC de control.

`202610150001_control_activadores_hora_bolivia_apply.sql` redefine `control_activadores_jerarquia` para calcular `Hoy`, `Semana` y `Mes` con `(now() at time zone 'America/La_Paz')::date`, evitando depender de `current_date` del servidor. Incluye scripts de verificación.

`202610140001_control_metricas_roles_efectivos.sql` documenta la definición multirrol base. Su aplicación, rollback y verificación se apoyan en scripts manuales de `supabase/manual/`.

### 10.7 Observación de integración

La app consulta directamente varias tablas, además de usar RPC. Por tanto, la seguridad y consistencia dependen de RLS, grants y contratos de columnas. Cualquier cambio de esquema puede romper consultas sin que exista una capa de tipos o contrato formal en el cliente.

Para confirmar el estado desplegado y el contrato compartido con el portal web se requiere una verificación separada, autorizada y de solo lectura sobre el proyecto remoto. Este documento no la sustituye.

## 11. Telemetría, diagnóstico remoto y mantenimiento

### 11.1 Cola local

`lib/telemetry.js` mantiene una outbox local en `telemetry_outbox_v1` con:

- Máximo 100 eventos.
- Máximo 64 KB.
- TTL de 7 días.
- Lotes de máximo 20 eventos.
- Claves de ejecución `telemetry_run_current_v1` y `telemetry_run_prev_v1`.
- Marcador de ejecución anterior para detectar cierres no limpios.

La outbox es local. La existencia de un receptor remoto no está confirmada por el repositorio.

### 11.2 Eventos permitidos

`app_start`, `app_background`, `app_foreground`, `form_edit`, `draft_write_ok`, `draft_write_error`, `photo_process_start`, `photo_process_ok`, `photo_process_error`, `sync_start`, `sync_upload_start`, `sync_upload_ok`, `sync_upload_error`, `sync_end`, `auth_change`, `logout`, `error_boundary` y `previous_run_unclean`.

### 11.3 Envío e idempotencia

La telemetría se envía mediante `supabase.rpc('registrar_eventos_telemetria', { p_eventos: payload })`. La definición local de la RPC está en `202610050001_telemetria_eventos.sql`; la migración `202610060001_telemetria_event_id.sql` agrega `event_id`, `exit_timestamp` y `previous_last_state`, crea un índice único por `(usuario_id, event_id)` y permite `event_id` nulo para eventos legacy. La RPC local acepta lotes de 1 a 20 eventos.

La migración base declara que no fue aplicada remotamente. Si la RPC no existe o falla, `flushTelemetry` no elimina el lote enviado y la outbox conserva los eventos hasta su TTL. Esto es comportamiento local; no confirma que exista un receptor desplegado.

### 11.4 Diagnóstico de salida Android

`lib/exitInfo.js` usa el módulo nativo `ImpulsaExitInfo` en Android API 30 o superior. El módulo `ExitInfoModule.kt` obtiene los motivos históricos de salida mediante `ActivityManager.getHistoricalProcessExitReasons`.

Motivos mapeados:

- `4`: `CRASH`.
- `5`: `CRASH_NATIVE`.
- `6`: `ANR`.
- `3`: `LOW_MEMORY`.
- `10`: `USER_REQUESTED`.

En versiones anteriores o si el módulo no está disponible, el resultado es `UNSUPPORTED`. La descripción se recorta a 240 caracteres.

### 11.5 Privacidad de telemetría

Los eventos revisados no incluyen nombres, cédulas, teléfonos ni contenido de fotos. Incluyen identificadores de usuario, versión, plataforma, pantalla/fase, buckets y categorías de error. Aun así, `usuario_id` y marcas de ejecución son datos de trazabilidad que deben tener una política de retención y acceso.

### 11.6 Mantenimiento

- La telemetría no reemplaza un sistema de crash reporting con stack traces.
- La outbox es local y puede perderse si se reinstala la app o se limpian datos.
- El diagnóstico de salida requiere Android 11 o superior.
- La revisión de eventos debe hacerse con acceso restringido en Supabase.

## 12. Hechos, riesgos, inferencias y referencias al código fuente

### 12.1 Hechos comprobados

- La app declara versión `1.0.28` y `versionCode 78`; la documentación de cliente sigue en `1.0.10`/`17`.
- `lib/config.js` solo lee `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY`; no lee `app.json`.
- El preflight acepta `expo.extra.supabaseUrl`/`supabaseAnonKey`, pero ese fallback no llega al bundle.
- `sincronizarFormularios` valida elegibilidad de reactivación antes de validar/subir fotos y antes del upsert.
- La matriz fotográfica distingue obligatoria, opcional y no requerida; la UI solo muestra acciones para fotos obligatorias.
- Créditos se habilita por tipo (`reactivacion`, `reimpresion_qr`, `cliente_antiguo`); Remesas solo en `comercio/comercio` y `transeunte/transeunte`.
- La combinación `transeunte/cliente_antiguo` es legacy; el selector actual no la ofrece.
- Las dependencias de React Navigation están declaradas, pero la navegación actual es por estado.
- No hay código de portal web ni evidencia de despliegue remoto en este repositorio.
- La migración base de telemetría declara no haber sido aplicada remotamente.

### 12.2 Riesgos y discrepancias

| Hallazgo | Evidencia | Impacto |
|---|---|---|
| Documentación de cliente desactualizada | `docs/cliente/04_documentacion_tecnica.md` y `08_qa_y_estado_calidad.md`. | Puede inducir a error en soporte, instalación y auditoría. |
| Preflight y runtime no validan lo mismo | `scripts/preflight-android-release.sh` acepta `app.json`; `lib/config.js` no. | Un build puede pasar preflight y arrancar sin Supabase si no hay variables en el entorno/.env. |
| Evidencia opcional sin acción de captura | `lib/reglasFotografias.js`, `lib/formularioActivacionRules.js` y `components/FormularioActivacion.js`. | En `transeunte/cliente_antiguo` y `cliente_antiguo/cliente_antiguo` no se ofrece cámara/galería para la evidencia opcional; solo se conserva si ya existe. |
| Criterio de reactivación distinto entre cliente y RPC | `lib/elegibilidadReactivacion.js` usa `includes('reactivacion')`; la RPC usa `like 'reactivacion%'`. | Con tipos no estándar, el cliente podría llamar a la RPC y esta devolver elegible sin comparar. |
| Estado desplegado no confirmado | Migraciones locales y `supabase/manual/`; telemetría declara no aplicada remotamente. | No se puede afirmar que RLS, RPC, columnas o Storage existan en producción tal como están en el repo. |
| Contrato del portal web no verificable | No hay código de portal en el repositorio. | Un cambio de esquema podría romper al portal o a la app; no se conoce el contrato compartido real. |
| Roles calculados en cliente y con fallback a caché | `App.js`, `lib/rolesAdicionales.js`. | Una caché obsoleta podría mostrar acciones no permitidas; RLS/RPC deben bloquearlas. |
| `App.js` concentra demasiadas responsabilidades | `App.js` (`AppShell`, sync, sesión, fotos, notificaciones). | Mayor costo de mantenimiento y riesgo de regresiones. |
| Persistencia local no relacional | `lib/storage.js`, `lib/secureLocalStorage.js`. | No hay consultas transaccionales ni recuperación avanzada ante corrupción. |
| Sin pruebas E2E/integración de sync y RLS | Solo se observaron pruebas unitarias en `tests/`. | Los flujos críticos dependen de QA manual. |
| Fotos dependen de policies de equipo desplegadas | Migraciones `202609140002` y `202609170001`. | Si no están aplicadas, líderes/admin no verán evidencia del equipo. |
| Actualizaciones OTA deshabilitadas | `android/app/src/main/AndroidManifest.xml` (`expo.modules.updates.ENABLED=false`). | Cada corrección requiere un nuevo build e instalación. |
| Backups deshabilitados | `android/app/src/main/AndroidManifest.xml`, `plugins/withAndroidNoBackup.js`. | Reinstalar o limpiar datos elimina pendientes locales y PIN. |

### 12.3 Inferencias y límites de la auditoría

- **Inferencia:** no se encontró un worker nativo de sincronización en segundo plano; el disparo depende de `App.js` y del estado de red. No se validó en dispositivo.
- **Inferencia:** si el portal web usa el mismo proyecto Supabase, comparte al menos el esquema base; no se pudo confirmar qué tablas, RPC, grants o policies consume.
- **Límite:** no se validó el estado real de la base desplegada, sus policies, sus datos ni la configuración de EAS.
- **Límite:** no se ejecutaron builds ni pruebas en dispositivo.
- **Límite:** no se revisó el contenido de `docs/cliente/06_entrega_accesos_y_credenciales.md` para evitar exponer credenciales.
- **Límite:** no se afirma que las tablas listadas sean el esquema completo; son las utilizadas o referenciadas por el código y las migraciones revisadas.

### 12.4 Recomendaciones documentales

1. Actualizar `docs/cliente/04_documentacion_tecnica.md` y `08_qa_y_estado_calidad.md` a `1.0.28`, `versionCode 78`, Expo 54 y RN 0.81.5.
2. Aclarar en `README.md` que el fallback desde `app.json` no existe en `lib/config.js` o implementarlo.
3. Definir si la evidencia opcional debe poder capturarse; si sí, ajustar la UI y las pruebas.
4. Verificar de forma autorizada y de solo lectura el estado desplegado de RLS, RPC, columnas y Storage.
5. Inventariar con el equipo del portal web los contratos Supabase compartidos y su versión desplegada.
6. Documentar el procedimiento de build, firma y recuperación de pendientes sin incluir credenciales ni instrucciones de transferencia de cuentas.
7. Añadir pruebas de integración para sincronización, elegibilidad, subida de fotos y acceso de equipo.
8. Definir retención y acceso para `telemetria_eventos`.

### 12.5 Referencias principales

- `App.js`: `AppShell`, `sincronizarFormularios`, sesión, roles, red, notificaciones y PIN.
- `components/AuthScreen.js`: autenticación online/offline y PIN.
- `components/FormularioActivacion.js`: formulario, catálogos, GPS, borrador y fotos.
- `components/FormulariosPorImpulsador.js`: historial, detalle y paginación.
- `components/ControlActivadores.js`: métricas, jerarquía y periodos.
- `components/NotificacionesScreen.js` y `lib/notificaciones.js`: bandeja y marcado de lectura.
- `components/CameraEvidencia.js`, `lib/cameraCaptureFlow.js` y `lib/cameraPhotoSafety.js`: captura y preview.
- `lib/formularioActivacionRules.js`: campos obligatorios y validaciones.
- `lib/reglasFotografias.js`: matriz de evidencia y Cash-In.
- `lib/elegibilidadProductos.js`: Créditos y Remesas.
- `lib/elegibilidadReactivacion.js`: ventana de 90 días.
- `lib/storage.js`, `lib/secureLocalStorage.js`, `lib/offlinePin.js` y `lib/offlineSafety.js`: persistencia, cifrado, PIN y sync seguro.
- `lib/upload.js`: fotos, límites, rutas y subida.
- `lib/telemetry.js`, `lib/exitInfo.js` y `android/app/src/main/java/com/integrat360/impulsa360/ExitInfoModule.kt`: telemetría y diagnóstico.
- `lib/supabase.js`, `lib/config.js`: cliente y configuración.
- `supabase/migrations/202607310001_control_activadores_rpc.sql`: RPC e índices de control.
- `supabase/migrations/202608310001_validar_elegibilidad_reactivacion.sql`: elegibilidad de reactivación.
- `supabase/migrations/202609140001_storage_fotos_activaciones_rls.sql`, `202609140002_storage_fotos_activaciones_private.sql` y `202609170001_storage_fotos_activaciones_select_equipo.sql`: Storage y RLS.
- `supabase/migrations/202610050001_telemetria_eventos.sql`: definición base local de telemetría; declara no aplicada remotamente.
- `supabase/migrations/202610060001_telemetria_event_id.sql`: idempotencia de telemetría.
- `supabase/manual/202610140001_control_metricas_roles_efectivos_apply.sql` y `202610150001_control_activadores_hora_bolivia_apply.sql`: aplicación manual de métricas y hora Bolivia.
- `android/build.gradle`, `android/app/build.gradle`, `android/gradle.properties`, `android/app/src/main/AndroidManifest.xml`, `plugins/withAndroidNoBackup.js` y `scripts/preflight-android-release.sh`: build, firma y restricciones Android.
- `package.json`, `app.json`, `eas.json`, `README.md` y `.gitignore`: identificación, configuración y hallazgos documentales.
