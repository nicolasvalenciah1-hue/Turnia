# Turnia · Cada turno cuenta

Aplicación web independiente para registrar jornadas y repartir propinas por áreas y horas. Conserva la conexión con el proyecto Supabase existente y la autorización de clientes por invitación. Los cobros están desactivados.

## Publicación en Render

Crear un **Static Site** desde este repositorio:

- Rama: `main`
- Build command: `node --check dist/app.js && node --check dist/sw.js`
- Publish directory: `dist`
- Variable: `SKIP_INSTALL_DEPS=true`
- Auto-deploy: activado

También se incluye `render.yaml` para la alternativa Blueprint. Elegir una sola ruta para evitar servicios duplicados. No se crea una nueva base de datos ni un servicio backend.

## Activación de los enlaces de correo

Cuando Render entregue la URL HTTPS real del sitio, agregar esa URL con `/` al final a **Supabase → Authentication → URL Configuration → Redirect URLs**. Conservar las URLs anteriores mientras se verifica la migración. Si se cambia el Site URL, primero confirmar que otras aplicaciones del mismo proyecto no dependan del valor actual.

Comprobar el registro por invitación y la recuperación de contraseña con el nuevo dominio antes de abrir el servicio a clientes. El acceso por correo y contraseña usa las cuentas existentes; el nuevo dominio requiere iniciar sesión nuevamente.

## Alcance

El enlace de inicio de sesión se podrá abrir sin ChatGPT. Los datos permanecen protegidos por autenticación, RLS y funciones autorizadas de Supabase. La clave incluida en el frontend es publishable; no subir claves secretas, tokens de invitación ni archivos `.env`.

Se conservan los identificadores `propina_*` de base de datos y sesión para mantener compatibilidad. La versión anterior de Sites continúa disponible mientras se verifica la nueva publicación.

## Verificación

- `npm ci --ignore-scripts`
- `npm test`
- `tests/ui-check.cjs` con `jsdom@26.1.0` disponible en `NODE_PATH`: navegación, permisos de consulta, guardado, aislamiento entre restaurantes, CSV, tutorial y recuperación. Usa datos simulados y no escribe en Supabase.

## Estructura

`dist/` contiene los archivos publicados del sitio. `render.yaml` es la configuración opcional de alojamiento. No se requiere compilación ni descargar la app para usarla desde el navegador.


## Administración de accesos

En **Accesos y ajustes**, el propietario del restaurante puede consultar colaboradores,
cambiar entre administrador y consulta, retirar accesos y revocar invitaciones pendientes.
Al cambiar o retirar un permiso se invalidan las invitaciones pendientes de esa persona
para el mismo local. El propietario no puede perder su rol desde este panel.

El **Panel de propietario** de Turnia muestra restaurantes, responsables, cuentas activas
e invitaciones. La suspensión o reactivación requiere un motivo y confirmación; no elimina
datos ni activa pagos.

Los nombres de restaurante admiten de 2 a 80 caracteres al editarse, conforme a la base.
Después de cambiar la contraseña se puede usar **Cerrar sesión y probar mi nueva contraseña**.
Las contraseñas existentes más cortas se envían a Auth para su validación; el mínimo de
8 caracteres se aplica a contraseñas nuevas.

`tests/settings-check.cjs` prueba errores, cambio de clave, salida y nuevo ingreso con Auth
simulado, permisos y respuestas atrasadas. `tests/database-access.sql` comprueba RLS y RPC
con identidades existentes dentro de una transacción que termina en ROLLBACK. Ejecutar
este último solo desde una conexión administrativa de la base correcta; no edita credenciales.

La migración `20261012043242_account_admin_hardening.sql` se aplicó al proyecto existente.
El resto del historial de Supabase incluye migraciones previas que no están completas en este
repositorio: no se debe usar esta carpeta para reconstruir la base ni ejecutar un reset.

## Cuentas vinculadas a trabajadores

La propuesta de vinculación agrega en **Accesos y ajustes** un formulario para asociar
una cuenta de consulta existente con su ficha, o emitir una invitación personal ya vinculada.
Solo el propietario del local administra estas vinculaciones. Requiere confirmar el acuerdo
del equipo y guardar una nota: es una declaración del propietario, no una votación digital.

**Mis propinas** muestra fechas, horas y montos de esa persona, con filtro de fechas.
Por defecto el acceso vinculado es personal. La opción compartida permite consultar también
todo el local y debe acordarse explícitamente. Las cuentas existentes conservan sus permisos
hasta una acción expresa; no hay asociaciones automáticas por nombre o correo.

`tests/worker-links-check.cjs` verifica la interfaz con Auth simulado.
`tests/database-worker-links.sql` verifica aislamiento y redondeo usando identidades existentes
y datos temporales revertidos. La migración `20261012162747_worker_account_links.sql` depende
del esquema existente y debe aplicarse antes de publicar el frontend. Está preparada y
verificada mediante ROLLBACK; pendiente de aprobación para su aplicación permanente.
