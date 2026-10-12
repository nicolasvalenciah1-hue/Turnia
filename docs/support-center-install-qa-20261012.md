# Centro de soporte Turnia — instalación y pruebas (2026-10-12)

## Estado
- PR #32: https://github.com/nicolasvalenciah1-hue/Turnia/pull/32
- Pruebas GitHub Actions: completadas correctamente en simulación (2026-10-12).
- La migración de Supabase **no pudo aplicarse automáticamente** debido a una restricción de seguridad de la herramienta. **No desplegar la interfaz hasta que exista la base.**
- El correo automático queda desactivado hasta configurar proveedor de envío; Gmail es el destinatario previsto, no el remitente verificado.
- No activar cobros ni alterar jornadas, cuentas o membresías.

## Instalación aprobada por el propietario
1. Abrir Supabase > proyecto Turnia > **SQL Editor**.
2. Revisar el archivo `supabase/migrations/20261012190000_support_tickets.sql` de esta rama y ejecutarlo **una sola vez** con la cuenta administrativa. El SQL crea únicamente dos tablas nuevas, índices, políticas RLS y permisos de las nuevas tablas.
3. Comprobar con SQL de solo lectura:
```sql
select to_regclass('public.turnia_support_tickets') as tickets,
       to_regclass('public.turnia_support_messages') as mensajes;
select c.relname, c.relrowsecurity
from pg_class c where c.oid in ('public.turnia_support_tickets'::regclass,
                               'public.turnia_support_messages'::regclass);
select tablename, policyname, cmd from pg_policies
where schemaname='public' and tablename in ('turnia_support_tickets','turnia_support_messages');
```
4. Ejecutar las pruebas automáticas de GitHub: `npm test`.
5. Publicar mediante fusión de PR #32 a `main` y confirmar estado **live** en Render.

## Pruebas manuales (cuentas diferentes, sin compartir contraseñas)
- Cuenta administradora de restaurante A: enviar consulta, confirmar número y descripción, responder, recargar y verificar persistencia.
- Cuenta de trabajador de A con consulta personal: crear reporte, verificar que no ve solicitudes de terceros, ni puede cambiar su estado.
- Cuenta de restaurante B: comprobar que no ve solicitudes de A.
- Propietario de Turnia: acceder a Panel de propietario, visualizar ambas cuentas, abrir y responder; alternar Pendiente > En revisión > Resuelto. Confirmar persistencia tras recargar.
- Verificar que un error de conexión genera mensaje y no afirma que el ticket se guardó.
- Comprobar que ningún usuario cambia otros datos del restaurante mediante permisos del módulo de soporte.
- Comprobar que los cobros siguen desactivados y que las jornadas/propinas existentes se conservan.

## Correo
El centro de soporte **no envía notificaciones por correo todavía**. Antes de activarlas:
- Verificar dominio de envío con proveedor transaccional (p. ej. Resend).
- Guardar claves solo en secretos de Supabase Edge Functions, jamás en `dist/app.js`.
- Enviar aviso a `turnia.notificaciones@gmail.com` al crear ticket, con cola/reintento y sin adjuntar contraseñas ni información sensible.
- Probar entrega, fallos y duplicados con cuentas de prueba.
