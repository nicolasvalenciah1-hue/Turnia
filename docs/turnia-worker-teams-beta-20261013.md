# Turnia para equipos de trabajadores — beta

## Dos modalidades, una plataforma
- **Restaurantes:** mantienen su registro, autorización y membresías existentes. No se altera ningún dato ni se habilitan cobros.
- **Equipos independientes:** un garzón abre `/equipo.html`, crea una cuenta (o usa una ya confirmada) y genera un espacio de trabajo **sin que el dueño del restaurante tenga cuenta**.

## Alta segura
1. Usuario nuevo crea cuenta por Supabase Auth con nombre, contraseña y correo.
2. El correo debe estar verificado antes de que PostgreSQL autorice `turnia_create_worker_team`. El enlace de verificación vuelve a `https://turnia-kkbm.onrender.com/equipo.html`.
3. La función SQL transaccional comprueba el usuario, limita a **un equipo por cuenta**, utiliza bloqueo por identidad y crea:
   - un espacio independiente aislado por el RLS vigente;
   - el permiso `owner` para el coordinador;
   - el área **Garzones (100%)** y su ficha como primer trabajador;
   - una membresía de **90 días de prueba, $0, `trial`**, sin pasarela de pago;
   - un registro interno que marca el espacio como `worker_team`.
4. El coordinador agrega compañeros en **Equipo y áreas**. Los invita desde **Accesos y ajustes**, preferentemente vinculando la cuenta a su ficha personal y eligiendo alcance individual. Las invitaciones siguen vinculadas al correo y requieren aceptación.
5. Los participantes pactan los repartos. La app registra lo acordado; no acredita una autorización del empleador ni reemplaza obligaciones laborales.

## Controles
- Crear equipo es RPC `authenticated` y `SECURITY DEFINER`, con `search_path=''` y correo confirmado; no hay inserciones RLS directas desde el navegador.
- Metadatos de perfil orientan la interfaz, pero no autorizan la creación.
- `turnia_is_worker_team` solo responde si quien consulta tiene permiso de lectura del mismo espacio.
- El coordinador puede invitar personas; los miembros `viewer` solo ven el alcance asignado. El rol `admin` permite editar, por lo que debe concederse solo con acuerdo.
- Un error durante la transacción revierte la creación completa. No hay claves privadas ni credenciales de pasarela en el frontend.
- No se modifica el onboarding `registro.html` del restaurante ni se permite crear un restaurante comercial sin autorización.
- La prueba dura 90 días y se gestionará manualmente durante la beta. No se cobran suscripciones.

## Para probar con clientes
- Supabase Dashboard → Authentication → URL Configuration → Redirect URLs: incluir `https://turnia-kkbm.onrender.com/equipo.html` si aún no figura. No sustituir las URLs existentes.
- Usar una cuenta nueva de prueba: verificar correo; crear espacio; comprobar que aparece Garzones al 100%; registrar un reparto y exportar; invitar a otro correo, vincular a su ficha y comprobar que otro local no es visible.
- Probar un usuario sin correo confirmado: la RPC debe rechazarlo. Probar un segundo clic: la RPC debe devolver el mismo equipo, sin duplicados.
- Revisar `propina_private.access_audit` para la acción `create_worker_team` y `propina_private.turnia_worker_teams` desde la consola autorizada.

## Pendiente de validación
- El registro humano completo con correo real no se simula como exitoso hasta completarlo.
- Estudiar límites de abuso y CAPTCHA para altas públicas si aumenta el volumen; crear una vista propia para cierre semanal pactado.
- Textos de privacidad y términos legales antes de campaña masiva.
