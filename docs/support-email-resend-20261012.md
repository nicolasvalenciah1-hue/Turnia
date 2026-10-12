# Turnia | Notificaciones de tickets por correo

## Alcance (12-10-2026)
- Al registrar una solicitud nueva, Turnia guarda el ticket **primero** y solicita a una función de Supabase que avise al propietario por correo.
- Correo de destino: `turnia.notificaciones@gmail.com` (configurable en el servidor).
- El aviso contiene identificador, restaurante, categoría y asunto; la descripción y respuestas permanecen dentro de Turnia.
- Seguridad: sesión autenticada de Supabase, solo el usuario que creó el ticket puede solicitar su aviso; los destinatarios y el remitente son definidos en el servidor, nunca por el cliente.
- Duplicados: tabla de cola no accesible a usuarios, actualización condicional y clave de idempotencia de Resend por ticket. Los tickets siguen funcionando aunque falle el proveedor.
- No se notifican retroactivamente solicitudes antiguas. Por ejemplo, la prueba previa #0E7E61A9 no enviará correo al activar este módulo.
- No se envían correos todavía hasta configurar el proveedor y desplegar la nueva funcionalidad.

## Pasos de activación
1. En Supabase > SQL Editor del proyecto Turnia, ejecutar **una sola vez** el archivo `supabase/migrations/20261012_support_email_queue.sql` y comprobar que aparezca `Success. No rows returned`.
2. Comprobar que existe `public.turnia_support_email_outbox`, que su RLS está activa y que hay un trigger `turnia_support_email_enqueue` en `public.turnia_support_tickets`.
3. En Resend, acceder a una cuenta propia. Crear una **API key para envío de correos**, y verificar un dominio remitente o utilizar `onboarding@resend.dev` exclusivamente para las pruebas permitidas por Resend (por lo general, envío restringido a la dirección asociada a la cuenta Resend). No publicar ninguna clave en GitHub, el chat ni en el frontend.
4. En Supabase > Edge Functions > **Secrets**, configurar:
   - `RESEND_API_KEY`: valor privado generado en Resend
   - `TURNIA_SUPPORT_FROM`: `Turnia <soporte@dominio-verificado.cl>` o, solo en pruebas autorizadas, `Turnia <onboarding@resend.dev>`
   - `TURNIA_SUPPORT_NOTIFY_TO`: `turnia.notificaciones@gmail.com`
5. Desplegar la función `turnia-support-notify` con `verify_jwt=true` y publicar el nuevo frontend en Render.
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
