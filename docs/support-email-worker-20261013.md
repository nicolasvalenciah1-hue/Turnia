# Worker automático de avisos de soporte (Turnia)

Se suma a la integración Resend verificada en el PR #44; no reemplaza ni modifica tickets, usuarios ni porcentajes de propinas.

## Arquitectura y garantías
- El trigger crea una fila por ticket en `public.turnia_support_email_outbox`, clave primaria `ticket_id`.
- `pg_cron` ejecuta una llamada HTTP mediante `pg_net` a `turnia-support-drain` cada minuto.
- Un token de 32 bytes se genera **dentro de PostgreSQL** y permanece cifrado en Vault. Ni el valor ni las claves Resend aparecen en GitHub.
- La Edge Function utiliza autenticación propia: valida el token por RPC restringida a `service_role`. Se despliega con `verify_jwt=false` **únicamente** porque usa esta autenticación explícita. No admite CORS ni destinatarios enviados por el cliente.
- El remitente, destinatario y clave Resend solo se leen de secretos de Supabase.
- La actualización de cola reclama eventos por estado + contador de intentos, con bloqueo temporal. El remitente usa el mismo `Idempotency-Key` por ticket que la función web.
- Máximo 4 envíos por invocación, 5 intentos por ticket; backoff exponencial hasta 15 minutos. Errores permanentes se detienen. Si el resultado es ambiguo, se detiene el reintento pasado el margen seguro de 23 horas (Resend almacena la idempotencia por 24 horas).
- Una respuesta HTTP 200 de Resend implica aceptación, no entrega en Gmail. Los tickets se conservan incluso si el correo falla.

## Orden seguro de publicación
1. Asegurar el PR y CI de `npm test`.
2. Ejecutar migración `20261013_support_email_cron_security.sql` (extensiones + Vault + RPC).
3. Desplegar `supabase/functions/turnia-support-drain/index.ts` y `policy.mjs` con `verify_jwt=false`. Nunca probar esta función sin el token interno.
4. Confirmar las restricciones de la RPC, el secreto por **nombre**, y el estado `ACTIVE` de la función.
5. Ejecutar migración `20261013_support_email_cron_activate.sql` para registrar el job cada minuto.
6. Revisar registros de Cron, salida de `pg_net` y cola por estado; probar un ticket nuevo y verificar su entrega a Gmail, incluida la prueba con navegador cerrado.
7. Fusionar el PR, ya que los cambios de servidor son independientes del frontend.

## Consultas de comprobación (solo lectura)
```sql
select jobid, jobname, schedule, active from cron.job
where jobname = 'turnia-support-email-drain';

select status, count(*) from public.turnia_support_email_outbox group by status;
select left(ticket_id::text, 8) ticket, status, attempts, sent_at, last_error
from public.turnia_support_email_outbox order by created_at desc limit 10;

select status, start_time, end_time, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname='turnia-support-email-drain')
order by start_time desc limit 10;
```

## Limitación restante
Una interrupción en Resend después de aceptar el envío, pero antes de persistir el ID, puede producir un estado ambiguo; por seguridad, no se reintenta automáticamente después de 23 horas. En ese caso el propietario revisará los registros de Resend y la cola. Para observar entregas definitivas o rebotes, incorporar webhooks autenticados en una fase posterior.
