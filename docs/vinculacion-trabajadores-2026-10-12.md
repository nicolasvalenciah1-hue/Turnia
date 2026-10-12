# Vincular cuentas con trabajadores

Estado: implementación lista para revisión. No publicada y migración no aplicada permanentemente.
Base: main `1cca0ba63c7c915ae5234dda0ee852b23414442a`.

## Comportamiento para el usuario

En Accesos y ajustes, el propietario selecciona una cuenta de consulta y su ficha de trabajador.
También puede crear una invitación personal: el correo verificado y la ficha se vinculan al
activar el código en una sola transacción. No se envían correos ni mensajes desde este cambio.

La opción inicial es **Solo sus propinas**. La alternativa **Sus propinas y todo el local**
permite ver y exportar la información general del restaurante. Ambas requieren una nota y
la declaración del propietario de que todos los trabajadores acordaron esa vinculación y
visibilidad. La interfaz explica que esto no equivale a recoger votos ni firmas digitales.

Mis propinas muestra el historial anterior y futuro de la ficha, sus horas y el monto calculado.
No afirma que los montos estén pagados: registrar pagos es otro pendiente. Las cuentas de
administración mantienen su acceso general. La vinculación inicial se ofrece para cuentas
de consulta; cambiar un administrador a consulta sigue siendo una acción independiente.

## Controles de datos

- Cuenta y trabajador deben pertenecer al mismo restaurante; un trabajador solo admite una cuenta activa por local.
- RLS bloquea al lector personal el acceso directo a áreas, personas, jornadas, turnos y reparto general.
- La RPC personal toma la identidad de la sesión, nunca un identificador de trabajador enviado por el cliente.
- El reparto completo se calcula primero y luego se filtra, conservando proporciones y redondeos.
- La aceptación de la invitación crea acceso y vínculo atómicamente; no existe una etapa con consulta general.
- Vincular invalida los códigos anteriores de esa persona en el local.
- Retirar el acceso o suspender el local bloquea también la consulta personal.
- Desactivar una ficha conserva su historial para una cuenta que siga autorizada.
- Las vinculaciones y declaraciones quedan en el registro privado de auditoría.
- No se migran automáticamente cuentas existentes ni se editan credenciales o registros operativos.

## Verificación realizada

`npm test`: navegación previa, ajustes, permisos, vinculación, invitaciones, privacidad de
pantallas, fechas, errores, cambios de local y respuestas atrasadas. Auth está simulado.

En el Supabase existente, dos transacciones con migración temporal y ROLLBACK:

1. `tests/database-worker-links.sql`: identidades reales de Auth, restaurantes/fichas/turnos
   temporales, funciones públicas bajo rol authenticated. Verifica correo correcto,
   acuerdo requerido, duplicados, otro restaurante, metadatos falsificados, modo personal
   y compartido, revocación, suspensión, ficha inactiva y auditoría. Un reparto de $100.001
   con 8 y 12 horas conserva $40.000 y $60.001 respectivamente.
2. `tests/database-access.sql`: regresión de propietario, administrador, lector, cuentas
   ajenas, edición de nombre, revocación e invalidación de invitaciones antiguas.

Estas pruebas no inician sesión por HTTP ni prueban entrega de correo. Falta una revisión
visual autenticada en navegador/móvil y el recorrido con una cuenta de trabajador elegida
por el propietario. Ninguna cuenta real quedó vinculada durante las pruebas.

## Publicación

Requiere aprobación de esta propuesta, conforme a la solicitud de publicar mejoras aprobadas.
Después: aplicar la migración al proyecto Supabase existente, verificar esquema y pruebas
revertidas, fusionar la propuesta con CI aprobado, y comprobar los archivos servidos por Render.
Los cobros y suscripciones permanecen desactivados. No ejecutar reset de Supabase.
