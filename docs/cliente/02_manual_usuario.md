# 02 - Manual De Usuario

## 1. Objetivo
Guiar al usuario final en el uso de la aplicacion Impulsa360 para registrar activaciones, operar offline y sincronizar informacion.

## 2. Perfil De Usuario
- Activadores / impulsadores de campo autorizados.

## 3. Requisitos Minimos
1. Dispositivo Android compatible.
2. Aplicacion instalada desde Google Play.
3. Credenciales de usuario activas en Supabase.
4. Permisos concedidos en el dispositivo:
   - Camara
   - Ubicacion

## 4. Primer Ingreso
1. Abrir la app.
2. Ingresar correo y contrasena.
3. Presionar `Entrar al panel`.
4. Si se solicita, configurar PIN local (4 a 6 digitos) para uso offline seguro.

Nota:
- Sin login previo online no se puede usar la app completamente en modo offline.

## 5. Pantalla Principal
En la pantalla principal se muestran:
1. Estado de conexion (`En linea` / `Sin red`).
2. Cantidad de formularios pendientes de sincronizacion.
3. Acceso al formulario de activacion.
4. Opcion `Ver Activaciones`.
5. Opcion `Cerrar sesion`.

## 6. Registro De Activacion
1. Completar datos obligatorios del formulario.
2. Cargar fotografia solicitada.
3. Verificar ciudad, zona y activador segun flujo de negocio.
4. Guardar el registro.

Resultado esperado:
- Si hay internet, el registro se sincroniza.
- Si no hay internet, queda guardado localmente con estado pendiente.

## 7. Modo Offline
1. Si no hay internet y existe sesion local, la app permite desbloqueo con PIN.
2. El formulario se puede completar y guardar localmente.
3. Los registros pendientes se sincronizan cuando vuelva la conexion.

Reglas de PIN:
1. PIN de 4 a 6 digitos.
2. Maximo 5 intentos fallidos.
3. Bloqueo temporal de 5 minutos tras exceder intentos.

## 8. Sincronizacion
La sincronizacion puede ocurrir:
1. En forma manual desde el formulario (boton de sincronizar).
2. En forma automatica al recuperar internet o reabrir la app.

Antes de sincronizar:
1. Verificar conectividad.
2. Verificar que la foto este disponible en el dispositivo (si aplica).

## 9. Ver Mis Activaciones
1. Presionar `Ver Activaciones`.
2. Revisar listado de activaciones.
3. Abrir detalle de una activacion para ver informacion completa y foto.

## 10. Cierre De Sesion
1. Presionar `Cerrar sesion`.
2. Confirmar segun prompt del sistema (si aplica).

## 11. Errores Frecuentes Y Solucion Rapida
1. "Sin conexion":
   - Verificar red movil o WiFi.
2. "No se pudo subir la foto":
   - Revisar permiso de almacenamiento/camara y repetir captura.
3. "PIN bloqueado":
   - Esperar 5 minutos y reintentar.
4. "No hay sesion local":
   - Iniciar sesion al menos una vez con internet.

## 12. Contacto De Soporte
- Nombre / equipo: `[COMPLETAR]`
- Correo: `[COMPLETAR]`
- Horario: `[COMPLETAR]`
