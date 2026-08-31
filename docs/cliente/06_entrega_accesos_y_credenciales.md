# 06 - Entrega De Accesos Y Credenciales

## 1. Objetivo
Documentar el inventario de accesos, propietarios y estado de entrega de credenciales del proyecto Impulsa360.

## 2. Politica De Seguridad De Esta Entrega
1. Este documento no incluye secretos en texto plano.
2. Contrasenas, tokens y llaves privadas deben entregarse por canal seguro.
3. Se recomienda rotacion de claves despues del traspaso formal.

## 3. Inventario De Accesos

| Sistema | Recurso | Rol requerido | Propietario actual | Estado entrega | Medio de entrega |
|---|---|---|---|---|---|
| Google Play Console | App `com.integrat360.impulsa360` | Owner / Admin | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Supabase | Proyecto productivo | Owner / Admin | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Repositorio Git | Codigo fuente | Admin / Maintainer | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |
| Correo operativo | Comunicaciones de release | Responsable operativo | `[COMPLETAR]` | `[COMPLETAR]` | `[COMPLETAR]` |

## 4. Activos Criticos
1. Upload keystore Android (`.jks`) de firma de actualizaciones.
2. Credenciales de firma (`storePassword`, `keyAlias`, `keyPassword`).
3. Credenciales de Supabase (URL + anon key + llaves de administracion si aplican).

## 5. Estado Actual Del Proyecto (Tecnico)
1. Keystore de build release detectado en entorno local de trabajo.
2. Build release funcional validado por script `preflight`.
3. Version de produccion activa en Play: `17 (1.0.10)`.

## 6. Checklist De Entrega Formal
1. Confirmar cuenta Owner en Google Play Console.
2. Confirmar cuenta Owner en Supabase.
3. Confirmar acceso al repositorio y permisos de escritura.
4. Entregar archivo keystore y documentar ruta segura de custodia.
5. Entregar credenciales por canal seguro y comprobar login por parte del cliente.
6. Registrar responsable de continuidad operativa.

## 7. Recomendaciones De Custodia
1. Guardar keystore en vault corporativo cifrado.
2. No almacenar secretos en chats o correos sin cifrado.
3. Activar doble factor en Play Console y Supabase.
4. Definir procedimiento de recuperacion ante perdida de acceso.

## 8. Registro De Traspaso
- Fecha de traspaso: `[COMPLETAR]`
- Responsable que entrega: `[COMPLETAR]`
- Responsable que recibe: `[COMPLETAR]`
- Confirmacion de acceso a Play: `[SI/NO]`
- Confirmacion de acceso a Supabase: `[SI/NO]`
- Confirmacion de acceso a repositorio: `[SI/NO]`
- Observaciones: `[COMPLETAR]`
