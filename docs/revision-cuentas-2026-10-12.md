# Revisión de cuentas y administración — 12 de octubre de 2026

Base revisada: commit `f6fcfe20275b4bd5e8a1649d81473a583ff48cde`.
Se comprobó que el JavaScript servido por Render coincidía con esa revisión.

## Correcciones

- Nombre del restaurante: se alinea el máximo de 80 caracteres entre interfaz,
  función y tabla; se normalizan espacios y se exige propietario activo confirmado.
- La función pública para renombrar pasa a SECURITY INVOKER; la implementación
  privilegiada reside en el esquema privado, con comprobación de identidad y rol.
- Cambio de contraseña: confirmación, validación de longitud, reautenticación,
  envío de contraseña actual, errores visibles y botón para comprobar el siguiente ingreso.
- Inicio de sesión: no se bloquean contraseñas antiguas por un mínimo local de longitud.
- Perfil: solo se envían los campos editados, sin copiar otros metadatos.
- Respuestas atrasadas: se descartan al salir o cambiar de restaurante;
  los datos personales y administrativos se limpian al cerrar sesión.
- Colaboradores: consulta, cambio de permiso y retirada de acceso sin eliminar registros.
- Invitaciones: consulta de estado y revocación. Una invitación antigua no puede
  restaurar el permiso anterior tras un cambio o retirada de acceso.
- Plataforma: listado de restaurantes y responsables, suspensión/reactivación con
  motivo y confirmación. No se cambió el estado de ningún restaurante como resultado final.
- Dependencias de pruebas fijadas en package-lock; CI usa npm ci.

## Comprobaciones realizadas

`npm test` pasa: navegación, registro de jornada, exportación CSV, tutorial,
recuperación, validación de contraseña, contraseña anterior incorrecta, errores del
servidor, salida y entrada con la contraseña nueva, límites del nombre, controles
owner/admin/viewer, confirmación de cambios e aislamiento ante respuestas atrasadas.
Las llamadas Auth de estas pruebas son simuladas.

`tests/database-access.sql` pasó contra Supabase existente. Comprueba identidades reales
bajo el rol authenticated: aislamiento RLS de tablas y vista de reparto, permisos de
propietario/administrador/consulta, rechazo de escalada mediante user_metadata,
protección del propietario, límites de nombre, invalidación de invitaciones y retirada
de acceso. Todos los cambios de prueba terminaron en ROLLBACK.

Las huellas de los registros operativos y de las credenciales coincidieron antes y
después. Se conservaron restaurantes, usuarios, áreas, trabajadores, jornadas y turnos.
Los indicadores de cobros y activación automática siguen deshabilitados.

## Comprobaciones pendientes y límites

La prueba de cambio de contraseña con un titular real sigue pendiente: el titular debe
cambiarla en Accesos y ajustes, pulsar «Cerrar sesión y probar mi nueva contraseña» e
iniciar sesión con la nueva clave. No se solicitaron ni modificaron claves de clientes.
También falta la aceptación visual en dispositivos reales. El ejecutable de Chromium
no estaba disponible y su descarga no produjo un archivo válido en este entorno.

El asesor de seguridad dejó de advertir sobre la función pública de renombrado.
Persisten avisos anteriores sobre tres funciones SECURITY DEFINER autenticadas
(membresía y disponibilidad de pruebas) y la protección de contraseñas filtradas.
Los avisos de tablas privadas con RLS sin políticas corresponden a tablas sin acceso
cliente directo. Esta revisión no certifica la totalidad del backend de pagos.

Referencias de seguimiento:
- [Funciones privilegiadas expuestas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Protección de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [Tablas con RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
