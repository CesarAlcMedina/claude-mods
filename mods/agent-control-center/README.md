# agent-control-center

Ocho subagentes de Claude Code que trabajan como un equipo de software, y la skill `coordinador` que los orquesta.

| Agente | Rol | Permisos |
|---|---|---|
| product-analyst (Producto y negocio) | Problema, usuario y valor, alcance, prioridades e historias, requisitos, reglas de negocio y criterios Given/When/Then, ajustados al encargo | Solo lectura |
| ux-ui-designer | Flujos, wireframes, estados, accesibilidad | Solo lectura |
| backend-engineer | APIs, lógica de negocio, datos e integraciones, con pruebas unitarias | Edita y ejecuta |
| frontend-engineer | Componentes, pantallas, estilos, accesibilidad y consumo de APIs, con pruebas unitarias | Edita y ejecuta |
| code-reviewer | Calidad, seguridad, rendimiento (sin modificar) | Solo lectura |
| qa-engineer | Plan de pruebas ISTQB, E2E, API, defectos | Edita pruebas y ejecuta |
| devops-engineer | CI/CD, Docker, GitHub Actions (sin producción sin aprobación) | Edita infraestructura y ejecuta |
| research-agent | Investigación con fuentes | Solo lectura + web |

Flujo: product-analyst → ux-ui-designer (si hay interfaz) → backend-engineer y/o frontend-engineer → code-reviewer → qa-engineer → devops-engineer, con research-agent como apoyo.

Instalar: `/plugin install agent-control-center --marketplace CesarAlcMedina/claude-mods` (o en la app: **+** → **Plugins** → **Add plugin**).

Uso: "Usa el Agent Control Center para…", `/agent-control-center:coordinador`, o un agente directo: "Usa product-analyst para…". Para verlos, pregúntale a Claude «¿qué agentes tienes?».

El coordinador también lleva dos recorridos: **Nueva función** (prepara historias, requisitos y criterios con Producto y negocio y QA, y luego pasa a desarrollo y a pruebas, corrigiendo lo que falle) y **Consultar avances** (pregunta «¿cómo va…?» y te dice qué está terminado, qué falta y si hay bloqueos, sin lanzar nada). Con el plugin panel-agentes, el Chat de grupo del panel le pasa los mensajes que no nombran a ningún agente, y los encargos que haces en el panel le llegan directamente («Encargo del usuario desde el panel de agentes»): los ejecuta lanzando a los agentes, sin que tengas que repetirlos en el chat principal. Con el panel instalado, cada agente publica allí sus avances y consulta a otro rol en el Chat de grupo cuando lo necesita. Si eliges el equipo de la sesión con **Configurar equipo** en el panel, el coordinador usa solo esos agentes y te propone incorporar los que falten.

Los plugins no pueden traer permisos de `settings.json`. Para que Claude pida confirmación antes de push, release o `docker push` en un proyecto, copia `.claude/settings.json` de este repositorio al proyecto.

**Producto y negocio** (`product-analyst`) sustituye a product-owner y business-analyst: un solo agente hace las dos partes en una entrega, ajustada al encargo (una respuesta directa para una pregunta sencilla, una definición con trazabilidad para una función compleja). Su método está en la skill `producto-negocio`, que el agente carga al empezar con el campo `skills` de su definición; la skill no aparece en el menú de comandos.

**Investigaciones del proyecto.** Lo que entrega research-agent se conserva en el propio proyecto, en `docs/investigaciones/` (o en una carpeta equivalente si el proyecto ya tiene una), con un `indice.md` donde cada investigación sale con su tema, fecha, estado (completa, parcial o bloqueada, con lo que falta), si es la vigente y el enlace. research-agent sigue siendo de solo lectura más web: entrega el informe (pregunta y alcance, hallazgos, conclusiones, fuentes con fecha de consulta, contradicciones y datos sin verificar, recomendaciones y limitaciones) y lo guarda el coordinador, que solo dice «Guardado» después de comprobar el archivo y el índice; si no puede guardar, explica por qué y te deja el informe completo. Al actualizar una investigación se crea otra versión (`-v2`…) y la anterior queda marcada como sustituida, sin borrarse. Antes de investigar, el coordinador mira si ya hay un informe vigente; a los demás agentes les pasa la ruta y un resumen de los que les sirven, y ellos lo leen cuando necesitan el detalle. Las recomendaciones de un informe no son requisitos: solo lo que figure en sus «Decisiones del usuario».
