# Turnia — Validación guiada de cuentas, restaurantes y permisos (2026-10-12)

Esta prueba es **manual, optativa y supervisada**. La automatización no conoce contraseñas reales y nunca debe intentar adivinarlas, leerlas ni escribirlas en documentos, capturas o logs.

## Condiciones previas
- La persona que participa acepta probar Turnia con su propia cuenta.
- Confirmar que el restaurante seleccionado sea un local de prueba, antes de cambiar nombres o jornadas.
- No utilizar pagos, tarjetas ni activar suscripciones.
- Anotar solo resultado (aprobado/fallido), fecha y mensaje visible de error sin secretos.
- Las cuentas reales existentes y las propinas históricas no deben alterarse durante estas pruebas.

## Acceso y seguridad
- [ ] Iniciar sesión con el correo confirmado y contraseña actual.
- [ ] En Accesos y ajustes, cambiar nombre visible y comprobar que el encabezado se actualiza. Restaurarlo después si es necesario.
- [ ] Probar una contraseña actual incorrecta: no debe guardar contraseña nueva.
- [ ] Con autorización del titular, cambiar la contraseña utilizando la anterior y confirmar la nueva; elegir una contraseña que él recuerde y no compartirla.
- [ ] Usar «Cerrar sesión y probar mi nueva contraseña»: la contraseña anterior debe fallar y la nueva debe permitir iniciar sesión nuevamente.
- [ ] Comprobar recuperación por «Olvidé mi contraseña» y que el enlace abra https://turnia-kkbm.onrender.com.
- [ ] Confirmar que un invitado sin código activado no recibe permisos de administración.

## Roles (realizar con cuentas autorizadas, nunca cambiando permisos solo en el navegador)
- [ ] Propietario: puede renombrar su restaurante y gestionar accesos; no se pierden turnos/propinas.
- [ ] Administrador: puede manejar áreas y jornadas, pero no cambiar nombre de restaurante ni el rol del propietario.
- [ ] Consultor general: puede consultar, sin botones de guardar jornadas ni cambiar nombres.
- [ ] Trabajador solo-personal: ve únicamente su ficha y sus propinas, nunca listas globales ni otros trabajadores.
- [ ] Al retirar el acceso a un colaborador, desaparece su acceso pero permanecen los registros históricos. Probarlo solo con una cuenta de ensayo.

## Resiliencia
- [ ] Dos sesiones de prueba consultan la misma jornada sin errores, sin ejecutar escrituras concurrentes en producción.
- [ ] En otro restaurante de prueba, la información de un local no aparece mezclada con otro.
- [ ] Verificar el correo de confirmación desde SMTP y el reingreso.
- [ ] Probar desde un teléfono Android o iPhone y desde navegador de escritorio.

## Registro de incidencias
| Escenario | Dispositivo | Resultado | Mensaje visible | Repetido |
|---|---|---|---|---|
| Inicio de sesión tras nueva contraseña | Pendiente | Pendiente | — | — |
| Restricción de rol administrador | Pendiente | Pendiente | — | — |
| Privacidad de trabajador | Pendiente | Pendiente | — | — |

**Alcance:** las pruebas automatizadas de CI usan datos simulados. No se presenta ninguna prueba real como completada hasta registrar su resultado.
