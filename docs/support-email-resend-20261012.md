# Turnia | Notificaciones de tickets por correo

## Alcance (12-10-2026)
- Al registrar una solicitud nueva, Turnia guarda el ticket **primero** y solicita a una función de Supabase que avise al propietario por correo.
- Correo de destino: `turnia.notificaciones@gmail.com` (configurable en el servidor).
- El aviso contiene identificador, restaurante, categoría y asunto; la descripción y respuestas permanecen dentro de Turnia.
- Seguridad: sesión autenticada de Supabase, solo el usuario que creó el ticket puede solicitar su aviso; los destinatarios y el remitente son definidos en el servidor, nunca por el cliente.
- Duplicados: tabla de cola no accesible a usuarios, actualización condicional y clave de idempotencia de Resend por ticket. Los tickets siguen funcionando aunque falle el proveedor.
- No se notifican retroactivamente solicitudes antiguas. Por ejemplo, la prueba previa #0E7E61A9 no enviará correo al activar este módulo.
- No se envían correos todavía hasta configurar el proveedor y desplegar la nueva funcionalidad.

## Estado verificado el 12-10-2026
- Instalado en el proyecto Supabase existente: `public.turnia_support_email_outbox`, RLS activa, cero permisos para `anon`/`authenticated`, trigger `turnia_support_email_enqueue` activo.
- La cola empezó con 0 eventos para no reenviar correos de tickets históricos. El ticket de soporte existente se conservó.
- Edge Function `turnia-support-notify` desplegada en versión 1, estado ACTIVE, `verify_jwt=true`.
- El PR #34 quedó desactualizado por cambios posteriores de interfaz; su reemplazo se desarrolla sobre la rama principal actual para preservar las mejoras móviles y del historial semanal. **Ya se guardaron los secretos de Resend en Supabase, pero todavía falta comprobar un envío real y la recepción en Gmail.**
- GitHub Actions pasó los controles de sintaxis, interfaz y notificación; son pruebas simuladas/estáticas, no entregas de email.
- Limitación pendiente: si se cierra el navegador tras guardar el ticket, la fila sigue en la cola, pero no hay un procesador automático de pendientes. La solución completa debe añadir un worker programado con credencial guardada en Vault, sin exponerla al cliente.

## Pasos de activación
1. **Completado:** migración aplicada mediante la conexión de Supabase. No volver a ejecutarla salvo revisión de cambios.
2. **Completado:** tabla, RLS y trigger verificados con SQL de solo lectura.
3. En Resend, acceder a una cuenta propia. Crear una **API key para envío de correos**, y verificar un dominio remitente o utilizar `onboarding@resend.dev` exclusivamente para las pruebas permitidas por Resend (por lo general, envío restringido a la dirección asociada a la cuenta Resend). No publicar ninguna clave en GitHub, el chat ni en el frontend.
4. En Supabase > Edge Functions > **Secrets**, configurar:
   - `RESEND_API_KEY`: valor privado generado en Resend
   - `TURNIA_SUPPORT_FROM`: `Turnia <soporte@dominio-verificado.cl>` o, solo en pruebas autorizadas, `Turnia <onboarding@resend.dev>`
   - `TURNIA_SUPPORT_NOTIFY_TO`: `turnia.notificaciones@gmail.com`
5. **Función desplegada y verificada.** Credenciales y remitente configurados. Tras superar CI, publicar el frontend para ejecutar una prueba real con un ticket nuevo y verificar la recepción; si falla, revertir el cambio de frontend conservando los tickets.
6. Desde una cuenta válida de restaurante, crear **un ticket nuevo** y revisar que la interfaz indique `Aviso aceptado por el servicio de correo`. Comprobar la recepción real en la bandeja Gmail, así como envíos y errores en Resend.
7. Revisar el registro de cola en Supabase (lectura administrativa):
```sql
select left(ticket_id::text,8) as ticket, status, attempts, sent_at, last_error
from public.turnia_support_email_outbox order by created_at desc limit 10;
```
8. Crear un segundo ticket para comprobar que cada solicitud obtiene su propia notificación. Cerrar y volver a entrar para confirmar que el ticket y su historial continúan.

## Limitaciones y pasos posteriores
- La notificación se solicita automáticamente desde la web después de guardar el ticket; si el navegador se cierra o pierde conexión en ese instante, el ticket permanece guardado y el aviso queda pendiente en la cola. Una siguiente fase podría agregar un trabajador programado que procese los avisos pendientes sin depender del navegador.
- `accepted_by_provider` significa aceptación por Resend, **no confirmación de entrega final**. Los eventos de entrega/rebote requieren webhooks independientes.
- Resend conserva sus claves de idempotencia por 24 horas; Turnia mantiene la marca de enviado en la base para evitar repetidos persistentes.
- La función no habilita pagos y no modifica propinas, membresías, trabajadores ni sus accesos.
