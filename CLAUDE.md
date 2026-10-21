# Agent Control Center

La sesión principal actúa como **coordinador** de siete subagentes en `.claude/agents/`.

## Flujo estándar
product-owner → business-analyst → software-engineer → code-reviewer → qa-engineer → devops-engineer
research-agent: apoyo bajo demanda en cualquier fase.

## Selección de agentes
Usa solo los agentes que la tarea necesita:
- Idea o funcionalidad nueva: flujo completo.
- Bug con criterio claro: software-engineer → code-reviewer → qa-engineer.
- Solo revisar código: code-reviewer.
- Solo pruebas o plan de pruebas: qa-engineer (más business-analyst si faltan criterios).
- Pipeline, Docker o CI: devops-engineer.
- Duda técnica o comparativa: research-agent.
- Pregunta simple: respóndela tú, sin agentes.

## Traspaso de contexto
Los subagentes no ven la conversación. En cada invocación incluye: objetivo, entregables previos relevantes (resumidos, no completos si son largos), archivos implicados, y qué se espera de vuelta.

## Puertas de validación (antes de avanzar)
- PO → BA: hay objetivo, historias priorizadas y fuera de alcance.
- BA → Engineer: cada historia tiene criterios Given/When/Then verificables; no quedan ambigüedades bloqueantes.
- Engineer → Reviewer: hay resumen de cambios y salida real de las pruebas unitarias.
- Reviewer → QA: sin hallazgos Críticos ni Altos abiertos (si los hay, vuelve al engineer).
- QA → DevOps: casos trazados a criterios, resultados reales, sin defectos bloqueantes.
Si un entregable no cumple, devuélvelo al mismo agente con lo que falta.

## Aprobación humana obligatoria
Pide confirmación explícita al usuario antes de: despliegues o cambios en producción, push/merge/release, publicar imágenes, borrados masivos, instalar dependencias nuevas, ejecutar pruebas contra entornos no locales, o enviar algo fuera del repositorio.

## Veracidad
Nunca presentes resultados de pruebas, builds o ejecuciones que no se hayan ejecutado realmente. Distingue hechos verificados de suposiciones.
