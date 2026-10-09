// ============================================================
// PhysiQ · lib/reglas-informe.js — reglas del informe con IA
// ============================================================
//
// ⚠ FICHERO COMPARTIDO: es idéntico, byte a byte, en physiq-assessment y en
// physiq-report. Si lo cambias en uno, cópialo tal cual al otro y actualiza
// la huella (SHA-256) que fija el test de cada repo:
//   · physiq-assessment: tests/unit.js («reglas compartidas»)
//   · physiq-report:     tests/unit.js («reglas compartidas»)
// Cada regla sale de un fallo visto en informes reales (rondas de revisión de
// physiq-assessment; la historia de cada una está en su CLAUDE.md).
//
// Funciona como script clásico (physiq-report: <script src>), como módulo ES
// (physiq-assessment: import './reglas-informe.js') y con require() en Node:
// deja el objeto en globalThis.PHYSIQ_REGLAS_INFORME y, si hay `module`, en
// module.exports. Sin dependencias ni DOM.

(function (g) {
  // Reglas que comparten las plantillas (narrativa y ficha breve).
  const REGLAS_COMUNES = `- Los ejemplos («p. ej.») de estas instrucciones solo muestran la forma de escribir: nunca copies su contenido ni añadas un síntoma, un dato o una frase que no conste en los datos o en la consulta.
- Siglas: escríbelas tal como vienen en los datos; no desarrolles una sigla que los datos no desarrollan (desarrolló «KTW» como un test inexistente).
- Tests: describe solo los tests realizados con su resultado; no menciones tests no realizados uno a uno. Si el nombre de un test da alternativas («dolorosa o con menos movilidad»), descríbelo con esas mismas palabras: no afirmes las dos.
- Reglas pronósticas (marcadas «regla pronóstica, no diagnóstica», p. ej. la regla de Flynn): predicen la respuesta a un tratamiento. Preséntalas así y nunca las uses para reforzar ni descartar una hipótesis diagnóstica.
- Lo que no consta (mediciones, fuerza, escalas, pruebas no realizadas…) no se menciona: no escribas que no se hizo, no se midió o no se dispone de ello.
- Discrepancias: los resultados y clasificaciones del fisioterapeuta (tests, NRS, irritabilidad, banderas, hipótesis) prevalecen sobre lo que se diga en la conversación. Si lo que refiere el paciente cambia entre lo que contestó antes de la consulta y lo que cuenta en ella, recoge las dos versiones UNA vez, en una sola frase neutra y en la sección que le corresponde (un síntoma, en Dolor), sin decir de dónde sale cada una (p. ej. «refiere que el dolor no baja a la pierna, aunque también describe alguna punzada en la nalga al agacharse»). También es una discrepancia cuando lo cuenta con otras palabras (p. ej. «rigidez por la mañana: No» frente a «al levantarme me cuesta arrancar»: «no refiere rigidez matutina, aunque al levantarse le cuesta arrancar los primeros minutos»). No elijas tú una de las dos, no las escribas en lugares distintos como si no chocaran, no cambies fechas ni circunstancias para que encajen como si fueran dos episodios distintos, y no interpretes ni justifiques la discrepancia.
- Lo que solo consta en una de las dos (antes de la consulta o en ella) no es una discrepancia: recógelo tal cual. No escribas que algo «no se menciona», «no se confirma» o «no se recoge» en la consulta, ni lo pongas en condicional («provocaría»).
- Que prevalezca una clasificación del fisioterapeuta (p. ej. riesgo psicosocial bajo) no borra lo que refiere el paciente: mantén la clasificación tal cual y recoge lo referido UNA vez, como algo que refiere (p. ej. «refiere cierto temor a que el tobillo vuelva a fallar al bajar escaleras»), sin reclasificar ni interpretar.
- Atribuye cada indicación a quien la dio: lo que indica el fisioterapeuta en la consulta es una indicación del plan, no del cirujano ni del médico, y viceversa. No escribas que algo «ya se le había indicado» si no consta, ni presentes un consejo (p. ej. «puede hacer bicicleta estática») como algo que el paciente ya hace. Si otro profesional (médico, cirujano…) dio una indicación, recógela atribuida a él aunque choque con la del fisioterapeuta: las dos, cada una con su autor, sin omitir ninguna.
- Si en la consulta el paciente habla de otra zona u otro lado (p. ej. molestias en la otra rodilla), menciónalo UNA vez como algo que refiere el paciente («refiere también…»), en la sección que le corresponde y nunca en Pruebas Clínicas, sin cambiar la región ni el lado valorados. No le añadas plan, seguimiento, prevención ni medidas que no consten en los datos o en la consulta.
- No menciones de dónde sale cada dato: nada de «transcripción», «grabación», «dictado», «formulario», «cuestionario», «PhysiQ», «datos estructurados», «datos recibidos», «razonamiento clínico», «recorrido de la exploración», «en la conversación», «en consulta», «árbol de decisión», «regla de decisión», «notas del plan» ni el nombre de sus campos («variable de control», «ventana de recuperación», «anclaje de hábito»); usa su contenido sin decir de dónde viene. Escribe «refiere» o «en la exploración»; tampoco contrapongas «inicialmente» y «en consulta».
- Hipótesis: no cites cocientes de probabilidad (LR), pesos, puntuaciones ni recuentos de criterios o hallazgos; describe qué tests apoyan o no cada hipótesis.
- Lo que refiere el paciente antes de la consulta: resúmelo en prosa, con los negativos relevantes en una frase. No lo transcribas pregunta por pregunta y no escribas «contestó».
- Respuestas «No sé» o «No sabría decir»: no las menciones de ninguna forma; ni como negación («no refiere…», «niega…») ni como desconocimiento («desconoce si…»).
- Datos personales: edad, sexo y lado afectado (derecho, izquierdo) solo si constan en los datos; nunca los deduzcas del nombre ni de otro dato. Si consta el sexo, concuerda el género con él; si no consta, redacta sin marcar el género, ni en los sustantivos ni en los adjetivos (p. ej. «refiere dolor al permanecer en sedestación» o simplemente «refiere…»).
- Un cribado, una bandera roja o un test negativos «no muestran hallazgos que sugieran…»; no escribas que «descartan» nada.
- Los tests y la exploración «apoyan» una hipótesis o «son compatibles» con ella; no escribas que la «confirman» ni que establecen el diagnóstico.
- «Cuándo reconsiderar o derivar» es contexto para el fisioterapeuta: no lo conviertas en acciones del plan, criterios de vuelta a la actividad ni explicaciones al paciente («se informa a la paciente de…») que no consten, y no lo uses para interpretar los hallazgos o los tests (p. ej. «la lesión aislada es infrecuente» no va junto a los resultados de los tests). En Seguimiento, como mucho, el criterio de no mejoría que figure en él o en la pauta.
- Pruebas de imagen y derivaciones: recógelas solo como las indicó el fisioterapeuta, sin añadir qué se busca con ellas («para descartar…») ni derivaciones o pruebas que nadie indicó.
- Tiempos: «hace X» se refiere al día de la consulta; no lo conviertas en «X después del inicio» ni en otra fecha (con «me miró hace tres semanas» escribió «tres semanas después del inicio»).
- No deduzcas la frecuencia ni la regularidad de una actividad («practica… de forma habitual», «regular») cuando solo consta cuál es, ni desde cuándo la dejó.
- No afirmes negativos que no estén en los datos: si un síntoma no aparece (p. ej. el dolor nocturno), no lo menciones.
- No atribuyas un síntoma a un mecanismo o a un proceso que no conste (p. ej. «la rigidez matutina sugiere un componente degenerativo»): descríbelo tal como lo refiere.
- Las cifras (IMC, tensión arterial, frecuencia cardíaca…) se dan tal cual, sin clasificarlas («normopeso», «hipertensión»…) si los datos no lo hacen.
- No añadas diagnósticos diferenciales que no estén en los datos: nombra la sospecha que consta (p. ej. «sospecha de claudicación vascular») sin contraponerla a otras («más que neurógena»).
- No añadas causas, mecanismos, secuelas ni fases de curación o de recuperación que no estén en los datos (p. ej. inmovilización, adherencias capsulares, consolidación ósea, «fase de consolidación», reparación tisular, desuso); tampoco atribuyas los hallazgos a secuelas ni a la evolución esperable de la lesión o de la cirugía, ni especules sobre cómo podría afectarle una actividad que no refiere limitada. Describe lo encontrado; la interpretación se limita a relacionar hallazgos que sí constan.
- Cada recomendación del plan aparece una sola vez.
- Cada dato aparece una sola vez, en la sección que le corresponde; no remitas a otras secciones («como se indicó…»).
- No crees secciones ni subsecciones que no estén en la estructura, ni cambies ninguna de sección o de orden.
- Plan: si los datos incluyen una pauta recomendada por PhysiQ, basa el plan en ella sin proponer dosis, series ni volúmenes distintos; si dice «Derivar», el plan es la derivación.
- Seguimiento: para medir la evolución, usa la escala recomendada de cada hipótesis cuando la haya. No añadas coordinación, comunicación ni reevaluaciones con otros profesionales (cirujano, médico, equipo quirúrgico) que no consten.
- Paciente operado (si los datos incluyen «Cirugía»): el plan se supedita al protocolo y a las restricciones del cirujano; no propongas nada que las contradiga, y las pautas de PhysiQ solo valen si son compatibles con ellas. Si no hay protocolo, di UNA vez, al principio del plan, que las restricciones están pendientes de confirmar con el cirujano, y no lo repitas en ninguna otra parte (ni en la presentación, ni en lo pendiente, ni en los objetivos). Si hay protocolo (escrito o verbal), sigue sus restricciones tal como constan: no pidas confirmarlo con el cirujano ni lo matices porque sea verbal. La intervención (técnica y fecha) y el protocolo con sus restricciones se describen UNA sola vez; en el plan basta con una frase que lo supedite al protocolo del cirujano, sin volver a enunciar las restricciones. La cirugía y sus restricciones no son factores ambientales.
- Hipótesis con diagnóstico ya confirmado y tratado: preséntala como antecedente (en Condición de Salud), no como sospecha ni como hipótesis de trabajo. No la derives y no escribas que «no se deriva» o que «no procede derivar»: simplemente no hables de derivación por ella.`;

  // Derivaciones: una sola vez, al principio de la sección del plan. Con una
  // derivación no urgente el informe no decide si se espera a la valoración
  // médica: esa decisión es del fisioterapeuta.
  function reglaDerivacion(seccion, conSeguimiento = true) {
  return `Derivaciones: si los datos indican una derivación urgente o una derivación médica, hazla constar de forma explícita UNA sola vez, al principio de ${seccion}, con su motivo (en los hallazgos puedes describir el signo que la motiva, sin repetir la derivación). Si es urgente o la pauta de la hipótesis dice «Derivar», el plan es la derivación. Con una derivación urgente no escribas ningún plan de tratamiento, técnica ni dosis, tampoco para después («una vez descartado…»); como mucho, que la valoración de fisioterapia se retomará tras la valoración médica, si el fisioterapeuta lo indicó. No repitas la derivación en el cribado (describe solo el signo), en la coherencia ni en el seguimiento. No nombres los diagnósticos que el médico deberá descartar ni ningún diagnóstico que no esté en los datos. Una hipótesis cuya pauta dice «Derivar» (fractura, luxación, rotura…) y no está marcada como ya diagnosticada y tratada se deriva aunque sus tests clínicos hayan salido negativos, porque no la descartan: nómbrala como sospecha pendiente de confirmar por el médico, salvo que el fisioterapeuta indique otra cosa en consulta o en las notas del plan; si indica que no procede (p. ej. la lesión ya está diagnosticada y tratada), no menciones esa derivación en ningún punto del informe. Si es una derivación médica no urgente, presenta igualmente el plan de fisioterapia propuesto y no decidas por tu cuenta si se espera a la valoración médica o se trata en paralelo, salvo que el fisioterapeuta lo indique en consulta o en las notas del plan. Orden de ${seccion}: derivación (si la hay) y después plan y pauta${conSeguimiento ? ', y al final el seguimiento' : ''}.`;
  }

  // Bajo lo que el paciente contó antes de la consulta, cuando hay audio: la
  // regla general de discrepancias no bastó.
  const RECORDATORIO_DISCREPANCIAS = 'Si en la consulta el paciente dice otra cosa sobre alguna de estas respuestas, escribe las dos versiones juntas, en una sola frase y en una sola sección; no recojas solo una ni las pongas en sitios distintos.';
  // En la indicación de «Dolor» del narrativo, con audio: el fallo se comete
  // al escribir la lista de lo que niega, así que el aviso va donde se escribe.
  const AVISO_NIEGA = 'Antes de poner un síntoma en la lista de lo que niega, comprueba si en la consulta lo refiere; si lo refiere, sácalo de esa lista y escribe aquí las dos versiones juntas, en una sola frase';

  // Audio: consulta (diálogo) o dictado del fisioterapeuta. En el diálogo,
  // Whisper no separa las voces: el informe atribuía al médico indicaciones
  // del fisio y daba por hechas pruebas que no se hicieron.
  function cabeceraAudio(dictado, ficha) {
    if (dictado) return 'DICTADO DEL FISIOTERAPEUTA (transcripción de lo que narra el fisioterapeuta al terminar la consulta):';
    return ficha ? 'TRANSCRIPCIÓN:' : 'TRANSCRIPCIÓN DE LA SESIÓN:';
  }

  function reglaAudio(conAudio, dictado) {
    if (!conAudio) return 'No hay transcripción de la sesión: redacta el informe exclusivamente con los datos de la valoración estructurada.';
    if (!dictado) return 'La transcripción complementa los datos estructurados.';
    return 'El dictado complementa los datos estructurados. En él habla solo el fisioterapeuta: lo que dice en primera persona («he hecho», «mis indicaciones», «le sugiero», «pediremos») son sus hallazgos e indicaciones; lo que introduce con «refiere», «dice» o «comenta» es lo que refiere el paciente. Lo que dice que no ha hecho («no la he hecho») no se hizo: no lo describas como realizado ni lo menciones. La transcripción puede convertir «he» en «ha» («no la ha hecho», «no la ha explorado»): es lo mismo, lo que el fisioterapeuta no hizo.';
  }

  // Prefijo de la pista de Whisper en dictado.
  const PISTA_DICTADO = 'Dictado de un fisioterapeuta: el paciente refiere…, en la exploración…, mis indicaciones como fisio.';

  const R = { REGLAS_COMUNES, reglaDerivacion, RECORDATORIO_DISCREPANCIAS, AVISO_NIEGA, cabeceraAudio, reglaAudio, PISTA_DICTADO };
  g.PHYSIQ_REGLAS_INFORME = R;
  if (typeof module !== 'undefined' && module.exports) module.exports = R;
})(typeof globalThis !== 'undefined' ? globalThis : this);
