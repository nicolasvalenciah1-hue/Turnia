# Invitaciones automáticas por correo

Al crear invitaciones de membresía, de acceso al restaurante o de cuenta personal,
la web llama a `turnia-invite-email`. El servidor valida sesión y permisos vigentes,
obtiene el destinatario de la invitación almacenada y envía mediante Supabase Auth,
que utiliza el SMTP ya configurado en el proyecto. No requiere Resend ni nuevas claves.

Para usuarios nuevos, Supabase reserva una cuenta sin contraseña y envía su enlace.
Al abrirlo se confirma el correo y Turnia muestra primero la confirmación del código,
después nombre y contraseña. Solo al terminar se acepta el código en la base de datos.
Las cuentas existentes reciben un enlace de ingreso y aceptan el acceso sin cambiar
su contraseña. Se conservan las invitaciones manuales existentes.

La validez se comprueba en el servidor: mismo correo confirmado, reserva compatible,
sin revocación, sin vencimiento y sin uso previo. La confirmación previa no consume
el código. El consumo final conserva la operación atómica existente.

Los reenvíos requieren esperar un minuto y reutilizan el mismo código. Los fallos
de SMTP no se anuncian como enviados. La entrega en la bandeja de entrada todavía
requiere una prueba real: aceptación por SMTP no garantiza recepción ni ausencia de spam.
La URL de destino de Auth es `https://turnia-kkbm.onrender.com/?turnia_invite=CODIGO`.
Si Supabase limita las redirecciones, incluir `https://turnia-kkbm.onrender.com/**`
en Authentication → URL Configuration. Los usuarios nuevos tienen además una ruta
de recuperación mediante metadata de presentación; los permisos no dependen de ella.

Validación realizada:

- `npm test`: navegación, configuración, trabajadores, soporte e invitaciones; Auth/SMTP simulados.
- Pruebas de base de datos con rollback: permiso de envío, límite de reenvío, destinatario,
  rechazo de otro correo, revocación, vencimiento, uso previo y prohibición de falsificar envío.
- Endpoint publicado exige JWT: petición anónima retorna 401.
- Advisors de seguridad: sin nuevos hallazgos respecto de la revisión previa.

Pendiente de verificar con destinatario real: generación de una invitación desde
el panel, recepción del correo, apertura del enlace, creación de contraseña e ingreso.
No se enviaron correos a clientes durante las pruebas automatizadas.
