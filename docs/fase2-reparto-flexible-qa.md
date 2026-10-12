# Turnia — Fase 2: pruebas de reparto AM/PM

## Reglas de negocio
- «Por turno»: el fondo de cada área se reparte dentro de ese turno usando participaciones: 1 = parte normal, 0,25 = cuarto de parte. Una persona seleccionada en ambos turnos recibe de ambos.
- «Fondo diario · persona única»: se suman las cuotas AM y PM del área y se reparte una vez entre el conjunto de trabajadores distintos presentes durante el día. Si alguien trabajó ambos, aparece una sola vez; en caso de pesos distintos se toma su participación mayor.
- El importe por área y el reparto individual utilizan redondeo de restos mayores para que las sumas den exactamente pesos CLP completos.
- Cada área con porcentaje positivo debe tener por lo menos un trabajador presente en cada turno guardado. Los porcentajes deben sumar 100.
- Participaciones diferentes de 1 requieren declaración de acuerdo + explicación de al menos 10 caracteres, registrada junto al turno y al usuario que lo modificó.
- **No registrar fecha clásica y flexible en paralelo.** La base impide nuevos cruces en ambas direcciones. No migrar ni eliminar jornadas antiguas.
- La configuración AM/PM de un mismo día debe usar el mismo modo por área; actualizar PM puede recalcular el fondo diario de AM.

## Caso calculado sin escrituras a producción
AM: 1001 CLP, PM: 1001 CLP. Garzones 70% por turno, cocina 30% fondo diario.
- Cada turno distribuye garzones 701 y cocina 300.
- En cada turno hay garzón A con participación 1 y B con participación 0,25; A recibe 561, B 140 en ese turno.
- Cocina C participa AM+PM y D solamente PM: el fondo diario total es 600, repartido en dos participaciones de 300 cada una.
- Totales: A 1122, B 280, C 300, D 300 = **2002 CLP**.
- Caso de prueba ejecutado con consulta SQL de solo lectura: total exacto 2002, C cuenta una vez, B recibe 140 por turno.

## Pruebas de extremo a extremo para piloto
1. Usar un **restaurante de prueba** con áreas y trabajadores; no elegir fechas con jornadas clásicas.
2. Abrir Turnos AM/PM; elegir día nuevo, registrar AM y guardar. Verificar totales y exportación CSV.
3. Elegir PM, comprobar que recuerda el modo del área elegido en AM y guardar.
4. Verificar que un garzón seleccionado dos turnos reciba por ambos; si cocina usa fondo diario, que el cocinero doble turno reciba una sola participación de su área.
5. Cambiar participación de alguien a 0,25: sin acuerdo debe rechazar; con acuerdo y justificación debe guardar.
6. Cerrar sesión, volver a entrar y comprobar que los turnos y acuerdos persisten. Verificar que el **historial clásico** no cambió.
7. Probar rol de consulta y trabajador privado: no pueden editar; trabajador solo-personal ve sus propinas de AM/PM sin acceder a información del resto.
8. Verificar fechas con montos impares (1 o 1001 CLP) para asegurar distribución exacta.
9. Cambiar de restaurante y comprobar aislamiento de turnos entre locales.

**Estado:** se ejecutaron pruebas automáticas con usuarios simulados y el caso matemático con SQL sin escrituras. Una operación AM/PM completa con usuarios reales todavía debe ser validada por quienes usarán el piloto. Sin pagos reales.
