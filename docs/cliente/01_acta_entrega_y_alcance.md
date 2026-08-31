# 01 - Acta De Entrega Y Alcance

## 1. Datos Generales
- Proyecto: `Impulsa360`
- Cliente: `[COMPLETAR]`
- Proveedor / Equipo de desarrollo: `[COMPLETAR]`
- Fecha de entrega tecnica: `2026-02-21`
- Canal de despliegue: `Google Play - Produccion`
- Paquete Android: `com.integrat360.impulsa360`
- Version entregada: `1.0.10`
- Version code entregado: `17`

## 2. Resumen De Entrega
Se entrega una aplicacion movil para registro de activaciones de campo con soporte offline, sincronizacion a Supabase y distribucion por Google Play.

La version publicada y disponible en produccion corresponde a:
- `17 (1.0.10)` publicada al 100% en Google Play (fecha de publicacion reportada: `2026-02-21`).

## 3. Entregables Incluidos
1. Codigo fuente del proyecto React Native + Expo.
2. Build de distribucion Android App Bundle:
   - `releases/impulsa360-com.integrat360.impulsa360-v1.0.10-code17.aab`
3. Recursos graficos de tienda (icono y feature graphic) en carpeta `releases/playstore/`.
4. Documentacion de uso, tecnica, accesos y QA (carpeta `docs/cliente/`).

## 4. Alcance Incluido
1. Autenticacion de usuario contra Supabase.
2. Registro de activaciones en formulario con datos de negocio.
3. Captura de foto y geolocalizacion.
4. Almacenamiento local para trabajo offline.
5. Sincronizacion manual y automatica de registros pendientes.
6. Vista de historial de formularios del impulsador.
7. Mecanismo de desbloqueo offline con PIN local (configurable luego de login online).
8. Publicacion en Google Play con versionado controlado (`versionName` y `versionCode`).

## 5. Fuera De Alcance En Esta Entrega
1. Cambios de modelo comercial o reglas de negocio no documentadas.
2. Nuevos modulos no presentes en el backlog aprobado.
3. Integraciones externas adicionales no acordadas.
4. Soporte operativo continuo sin acuerdo SLA.

## 6. Criterios De Aceptacion De Entrega
1. La app instala correctamente desde Google Play en dispositivos compatibles.
2. Login online funcional.
3. Registro de activacion funcional con validaciones.
4. Registro offline y sincronizacion posterior funcionales.
5. Historial de activaciones visible para usuario autenticado.
6. Evidencia de version publicada en Play: `17 (1.0.10)`.

## 7. Observaciones De Entrega
- Recomendaciones de Google Play visibles en consola (no bloqueantes) quedan como mejoras continuas.
- Se recomienda formalizar plan de soporte y mantenimiento post-entrega.

## 8. Aceptacion Formal

Con la firma del presente documento, el cliente declara haber recibido los entregables listados y valida el alcance entregado.

- Nombre responsable cliente: `[COMPLETAR]`
- Cargo: `[COMPLETAR]`
- Fecha: `[COMPLETAR]`
- Firma: `[COMPLETAR]`

- Nombre responsable proveedor: `[COMPLETAR]`
- Cargo: `[COMPLETAR]`
- Fecha: `[COMPLETAR]`
- Firma: `[COMPLETAR]`
