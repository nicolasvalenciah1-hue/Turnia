# Estabilidad de cuentas y cambio de espacio — 13 octubre 2026

## Alcance implementado

Se priorizan fallos técnicos reproducibles sobre cambios visuales:

- `equipo.html` utiliza la misma preferencia y almacenamiento de sesión que la aplicación principal. La sesión temporal no se pierde al entrar al panel y no queda persistida en un equipo compartido.
- Si la confirmación de una cuenta de equipo llega al inicio, se retoma `/equipo.html` cuando aún no tiene acceso a un espacio. Esto solo cambia navegación; la autorización sigue en la RPC. Se conservan los flujos de recuperación, invitación y registro comercial.
- Al seleccionar otro espacio se eliminan de inmediato las jornadas, trabajadores y conversaciones anteriores y se bloquea la edición mientras carga. Las respuestas de clasificación de equipo que llegan tarde no modifican el espacio seleccionado ni reabren una sesión cerrada.
- Se actualizan las versiones de los recursos para que los teléfonos reciban las correcciones.

## Verificación

- El test de cambio de espacio falló en el código anterior al detectar trabajadores del espacio anterior durante la espera de red; pasa con la corrección.
- Se agregan casos de respuestas invertidas, cierre de sesión durante carga, reanudación de alta de equipo y elección de almacenamiento temporal/persistente.
- Suite completa `npm test`, con Auth, correos y red simulados; no crea usuarios ni envía mensajes reales.
- Inspección SQL de producción, solo lectura: todas las tablas públicas con RLS; `anon` sin permiso de crear equipos; `authenticated` sin lectura directa de la cola de correo ni de la tabla privada de equipos.
- Avisos existentes: Cron activo cada minuto, dos entradas `sent` y ninguna pendiente al revisar. `sent` describe aceptación por el proveedor, no acredita entrega a la bandeja del destinatario.

## Límites y pendientes

El registro completo con correo real y la revisión visual en un teléfono siguen pendientes. No se cambian el esquema, registros reales, reglas de reparto ni cobros.

El asesor de seguridad sigue señalando funciones SECURITY DEFINER invocables por usuarios autenticados (intencionales y con autorización interna), tablas privadas sin políticas (acceso directo revocado), `pg_net` en public y protección de contraseñas filtradas desactivada. Esta corrección no pretende resolver toda la auditoría ni declara la plataforma lista para un lanzamiento masivo.
