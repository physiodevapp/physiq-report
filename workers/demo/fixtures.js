// workers/demo/fixtures.js — contenido precargado del modo demo.
//
// Declarativo a propósito: la lógica vive en handlers.js. Así el contenido
// clínico se revisa sin leer código.
//
// ⚠ Paciente ficticio. Caso clínicamente verosímil pero inventado.
//
// Es LA MISMA paciente que usan los fixtures del copiloto en el repo del hub
// (physiq/worker/demo/fixtures.js): Nuria V., lumbalgia con irradiación
// radicular L5 izquierda. Un visitante que recorra copiloto e informe en la
// misma sesión debe encontrarse el mismo caso, no dos pacientes distintos.

// Lo que "habría transcrito" Whisper del audio de la consulta. Se emite en el
// evento SSE `transcript`, igual que la transcripción real.
export const DEMO_TRANSCRIPT = `Fisioterapeuta: Buenos días Nuria, cuéntame qué te trae por aquí.
Paciente: Llevo unas tres semanas con dolor en la parte baja de la espalda que se me baja por la pierna izquierda.
Fisioterapeuta: ¿Recuerdas cómo empezó?
Paciente: Fue durante una mudanza. Cogí una caja pesada del suelo girando el cuerpo y noté un pinchazo fuerte en la zona lumbar.
Fisioterapeuta: ¿El dolor de la pierna apareció ese mismo día?
Paciente: Al principio solo era la espalda. A los dos o tres días empezó a bajarme por detrás del muslo, y ahora llega hasta el empeine del pie.
Fisioterapeuta: ¿Notas hormigueo o sensación de que la pierna te falla?
Paciente: Hormigueo sí, sobre todo en la parte de arriba del pie. Debilidad no diría, pero la noto más torpe al subir escaleras.
Fisioterapeuta: Del cero al diez, ¿dónde pondrías el dolor ahora?
Paciente: Sobre un seis. Por las mañanas es cuando peor está, un siete, y va aflojando durante el día.
Fisioterapeuta: ¿Qué lo empeora y qué lo alivia?
Paciente: Estar sentada mucho rato es lo peor, con veinte minutos ya tengo que levantarme. Agacharme también. Caminando se me suaviza bastante.
Paciente: Trabajo en administración, me paso el día delante del ordenador y eso me está costando mucho.
Fisioterapeuta: ¿Has tenido fiebre, pérdida de peso o dolor que te despierte por la noche?
Paciente: No, nada de eso.
Fisioterapeuta: ¿Algún problema para orinar o acorchamiento en la zona de la entrepierna?
Paciente: No, para nada.
Fisioterapeuta: En la exploración veo flexión lumbar limitada a unos cuarenta grados con reproducción del dolor irradiado, extensión conservada y que centraliza el dolor distal. Lasègue positivo a cuarenta y cinco grados en el lado izquierdo, Slump positivo. Fuerza de extensor propio del primer dedo cuatro sobre cinco a la izquierda, dorsiflexión cuatro sobre cinco, flexión plantar conservada. Reflejo aquíleo y rotuliano normales y simétricos. Hipoestesia en dorso del pie izquierdo.
Paciente: Me da miedo que sea una hernia y que se me quede así. Mi madre acabó operada de la espalda.
Fisioterapeuta: Es una preocupación razonable y la vamos a trabajar. Los reflejos normales y la fuerza casi completa son buenas señales, y este cuadro suele mejorar sin cirugía.`;

// Informe narrativo (plantilla institucional CIF-APTA). Respeta la estructura
// que exige buildPrompt(): empieza directamente en la primera sección ##, sin
// ficha de identificación, y usa tablas markdown para los datos numéricos.
export const DEMO_REPORT_NARRATIVE = `## CONDICIÓN DE SALUD Y FACTORES CONTEXTUALES

La valoración se aborda desde un marco biopsicosocial, integrando la condición de salud con los factores personales y ambientales que condicionan el funcionamiento y la participación de la paciente en su vida diaria y laboral.

### Condición de Salud (Diagnóstico Médico)

Lumbalgia mecánica aguda con irradiación radicular en territorio L5 izquierdo, de tres semanas de evolución, secundaria a mecanismo de carga con flexo-rotación de tronco. No se dispone de pruebas de imagen en el momento de la valoración, ni se consideran indicadas en ausencia de banderas rojas y con déficit motor no progresivo.

### Factores Personales

Mujer de 43 años, administrativa, sin antecedentes de episodios lumbares previos ni comorbilidades relevantes referidas. Automedicación con antiinflamatorios no esteroideos durante los primeros días del cuadro, con alivio parcial, suspendida por decisión propia. Refiere expectativa negativa respecto a la evolución del cuadro y temor explícito a una resolución quirúrgica, asociado al antecedente de cirugía de columna en su madre.

### Factores Ambientales

Puesto de trabajo administrativo con sedestación mantenida durante la jornada completa, sin adaptación ergonómica ni pausas estructuradas, lo que reproduce a diario el principal factor agravante. Entorno domiciliario sin barreras y con apoyo familiar disponible.

## HISTORIA CLÍNICA Y EVOLUCIÓN

### Presentación Inicial y Antecedentes

El cuadro se inicia de forma aguda durante una mudanza, al levantar una carga pesada desde el suelo con flexión y rotación simultáneas de tronco, con dolor lumbar inmediato. En las 48-72 horas siguientes el dolor progresa distalmente siguiendo un patrón centrífugo por cara posterior de muslo y cara lateral de pierna, alcanzando el dorso del pie, y se acompaña de parestesias en ese mismo territorio. La paciente refiere torpeza subjetiva del miembro inferior izquierdo al subir escaleras, sin caídas ni fallos francos.

El dolor se cuantifica en 6/10 en el momento de la valoración, con máximo matutino de 7/10 y mejoría progresiva a lo largo del día. Se identifica un patrón postural claro: agravamiento con sedestación mantenida (tolerancia aproximada de 20 minutos) y flexión de tronco, con alivio durante la marcha.

El cribado de banderas rojas resulta negativo: ausencia de fiebre, pérdida de peso no intencionada, dolor nocturno constante, clínica esfinteriana y alteración de la sensibilidad perineal.

## EVALUACIÓN DE FUNCIONES Y ESTRUCTURAS CORPORALES

### Funciones Neuromusculoesqueléticas y Relacionadas con el Movimiento

#### Rango de Movimiento Activo (ROM)

Se objetiva restricción de la flexión lumbar con reproducción del dolor irradiado al final del recorrido, con extensión conservada y con efecto de centralización del síntoma distal, hallazgo de valor pronóstico favorable y con implicación terapéutica directa.

| Articulación | Movimiento | Rango | Observaciones |
| --- | --- | --- | --- |
| Columna lumbar | Flexión | 40° | Reproduce dolor irradiado a MII |
| Columna lumbar | Extensión | Completa | Centraliza el dolor distal |
| Columna lumbar | Inclinación izquierda | Limitada, sin dolor | — |
| Columna lumbar | Inclinación derecha | Completa | — |

#### Fuerza Muscular

Se documenta déficit motor leve en territorio L5 izquierdo, sin afectación de S1 ni del lado contralateral. El registro cuantificado establece la línea base necesaria para monitorizar la progresión del déficit en sucesivas reevaluaciones.

| Miotoma | Movimiento | Izquierda | Derecha | Asimetría |
| --- | --- | --- | --- | --- |
| L5 | Extensión 1.er dedo | 4/5 | 5/5 | Presente |
| L4-L5 | Dorsiflexión de tobillo | 4/5 | 5/5 | Presente |
| S1 | Flexión plantar | 5/5 | 5/5 | Ausente |
| L3-L4 | Extensión de rodilla | 5/5 | 5/5 | Ausente |

Los reflejos rotuliano y aquíleo se muestran normales y simétricos, lo que resulta consistente con una afectación radicular L5 aislada y contribuye a descartar compromiso de S1.

### Funciones Sensoriales y Dolor

Hipoestesia en dorso del pie izquierdo, de distribución compatible con dermatoma L5. Dolor de características mecánicas con componente neuropático asociado, valorado en 6/10 mediante escala numérica en el momento de la exploración. Los tests de tensión neural resultan positivos: elevación de la pierna recta a 45° en el lado sintomático y test de Slump positivo, ambos con reproducción del dolor irradiado y no de tirantez muscular posterior.

## ANÁLISIS DEL FUNCIONAMIENTO: LIMITACIONES EN LA ACTIVIDAD Y RESTRICCIONES EN LA PARTICIPACIÓN

### Limitación Funcional Global

El impacto funcional es moderado y se concentra en las actividades que implican mantenimiento de la sedestación y flexión de tronco, con preservación de la marcha, que actúa además como postura antiálgica. El componente cognitivo-emocional —temor a la evolución quirúrgica y expectativa negativa de recuperación— constituye un determinante del pronóstico de magnitud comparable a los hallazgos físicos.

### Limitaciones en las Actividades

Tolerancia a la sedestación limitada a aproximadamente 20 minutos, con necesidad de cambio postural. Limitación para la flexión de tronco y para el manejo de cargas desde el suelo, gesto que reproduce el mecanismo lesional. Ascenso de escaleras referido como torpe, en coherencia con el déficit de dorsiflexores objetivado.

### Restricciones en la Participación

Afectación directa del desempeño laboral por incompatibilidad entre la tolerancia actual a la sedestación y las exigencias de un puesto administrativo sin adaptación. No se identifican, por el momento, restricciones relevantes en el ámbito social o familiar.

## CONCLUSIONES Y PLAN DE TRATAMIENTO

Los hallazgos configuran un cuadro de radiculopatía L5 izquierda de probable origen discal en fase aguda, con déficit motor leve no progresivo, tests de tensión neural positivos y reflejos conservados. El patrón postural, la topografía de las parestesias y la respuesta a los movimientos repetidos apoyan un origen discogénico frente a las alternativas de dolor referido facetario o estenosis de canal, cuyo comportamiento postural sería el inverso al observado.

El problema primario se define como la mecanosensibilidad radicular con limitación de la tolerancia a la sedestación, sobre la que se articula el resto del cuadro funcional. La existencia de preferencia direccional en extensión ofrece una vía terapéutica inmediata y un marcador objetivo de evolución.

El plan se estructura en tres fases con criterios de progresión clínicos, no temporales. Una primera fase de control sintomático y reactivación, centrada en educación en dolor y pronóstico —intervención prioritaria dada la carga cognitivo-emocional identificada—, ejercicio en la dirección de centralización, adaptación de la sedestación laboral con pausas por debajo del umbral de tolerancia actual y marcha diaria progresiva. Una segunda fase de control motor y tolerancia a la carga, con trabajo de estabilización lumbopélvica, reeducación del patrón de bisagra de cadera y reexposición gradual al gesto desencadenante. Una tercera fase de fortalecimiento progresivo y reexposición completa a la carga, con plan de mantenimiento y de manejo de recaídas por escrito.

Se establecen como criterios de reevaluación y eventual derivación la progresión del déficit motor, la aparición de afectación bilateral o de clínica esfinteriana, y la ausencia de mejoría significativa transcurridas seis a ocho semanas de tratamiento conservador.

---

*Documento generado en MODO DEMO de PhysiQ, sobre un caso clínico ficticio. No corresponde a ningún paciente real y no tiene validez clínica ni legal.*`;

// Variante breve (tres secciones, prosa continua, ≤550 palabras).
export const DEMO_REPORT_BRIEF = `## PRESENTACIÓN CLÍNICA

Mujer de 43 años, administrativa, que consulta por lumbalgia de tres semanas de evolución con irradiación al miembro inferior izquierdo. El cuadro se inicia de forma aguda durante una mudanza, al levantar una carga pesada desde el suelo con flexo-rotación de tronco. En las 48-72 horas siguientes el dolor progresa distalmente por cara posterior de muslo y cara lateral de pierna hasta alcanzar el dorso del pie, acompañado de parestesias en ese territorio y de torpeza subjetiva del miembro al subir escaleras. Refiere dolor de 6/10, con máximo matutino de 7/10, agravado por la sedestación mantenida —con tolerancia aproximada de veinte minutos— y por la flexión de tronco, y aliviado durante la marcha. El cribado de banderas rojas resulta negativo, sin fiebre, pérdida de peso, dolor nocturno constante ni clínica esfinteriana. Expresa temor a una evolución quirúrgica, asociado al antecedente de cirugía de columna en su madre.

## HALLAZGOS Y CODIFICACIÓN CIF

La exploración objetiva restricción de la flexión lumbar a 40° con reproducción del dolor irradiado (b7101), con extensión conservada y centralización del síntoma distal, indicativa de preferencia direccional. Los tests de tensión neural resultan positivos, con elevación de la pierna recta a 45° y Slump positivo en el lado sintomático. Se documenta déficit motor leve en territorio L5 izquierdo, con extensión del primer dedo y dorsiflexión de tobillo valoradas en 4/5 frente a 5/5 contralateral (b7301), mientras que la flexión plantar y la extensión de rodilla se mantienen conservadas. Los reflejos rotuliano y aquíleo son normales y simétricos, hallazgo coherente con afectación radicular L5 aislada. Se aprecia hipoestesia en dorso del pie izquierdo de distribución dermatomérica (b2703), con dolor de características mecánicas y componente neuropático asociado (b28013). Funcionalmente, destaca la limitación para mantener la sedestación (d4153) y para el manejo de cargas desde el suelo (d4300), con repercusión directa sobre el desempeño laboral (d850). El entorno de trabajo, sin adaptación ergonómica ni pausas estructuradas (e135), actúa como factor ambiental perpetuador del cuadro.

## OBJETIVOS Y PLAN

Los hallazgos configuran una radiculopatía L5 izquierda de probable origen discal en fase aguda, con déficit motor leve no progresivo. Se plantea como objetivo principal la reducción de la mecanosensibilidad radicular y la recuperación de la tolerancia a la sedestación hasta niveles compatibles con la jornada laboral, junto con la normalización del déficit motor y la modificación de las creencias asociadas al pronóstico. El plan se articula en tres fases con criterios de progresión clínicos: una primera de control sintomático y reactivación, con educación en dolor y pronóstico, ejercicio en la dirección de centralización, adaptación de las pausas laborales por debajo del umbral de tolerancia actual y marcha diaria progresiva; una segunda de control motor y tolerancia a la carga, con estabilización lumbopélvica, reeducación de la bisagra de cadera y reexposición gradual al gesto desencadenante; y una tercera de fortalecimiento progresivo y reexposición completa, con plan de mantenimiento y de manejo de recaídas por escrito. Se establecen como criterios de reevaluación y derivación la progresión del déficit motor, la aparición de afectación bilateral o de clínica esfinteriana, y la ausencia de mejoría tras seis a ocho semanas de tratamiento conservador.

---

*Documento generado en MODO DEMO de PhysiQ, sobre un caso clínico ficticio. No corresponde a ningún paciente real y no tiene validez clínica ni legal.*`;

// Resumen de documentos adjuntos (evento previo a la generación del informe).
export const DEMO_DOC_SUMMARY = `Informe de resonancia magnética lumbar (documento de ejemplo): protrusión discal posterolateral izquierda L4-L5 con contacto radicular, sin signos de compromiso del canal central ni estenosis foraminal significativa. Discopatía degenerativa incipiente L5-S1 sin repercusión radicular. Resto de segmentos sin hallazgos relevantes. Correlación clínico-radiológica coherente con la sintomatología L5 izquierda descrita en la anamnesis.`;
