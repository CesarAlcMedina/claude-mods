# agent-control-center

Ocho subagentes de Claude Code que trabajan como un equipo de software, y la skill `coordinador` que los orquesta.

| Agente | Rol | Permisos |
|---|---|---|
| product-owner | Objetivos, épicas, historias, prioridades | Solo lectura |
| business-analyst | Requisitos, reglas de negocio, criterios Given/When/Then | Solo lectura |
| ux-ui-designer | Flujos, wireframes, estados, accesibilidad | Solo lectura |
| software-engineer | Diseño técnico, implementación, pruebas unitarias | Edita y ejecuta |
| code-reviewer | Calidad, seguridad, rendimiento (sin modificar) | Solo lectura |
| qa-engineer | Plan de pruebas ISTQB, E2E, API, defectos | Edita pruebas y ejecuta |
| devops-engineer | CI/CD, Docker, GitHub Actions (sin producción sin aprobación) | Edita infraestructura y ejecuta |
| research-agent | Investigación con fuentes | Solo lectura + web |

Flujo: product-owner → business-analyst → ux-ui-designer (si hay interfaz) → software-engineer → code-reviewer → qa-engineer → devops-engineer, con research-agent como apoyo.

Instalar: `/plugin install agent-control-center --marketplace CesarAlcMedina/claude-mods` (o en la app: **+** → **Plugins** → **Add plugin**).

Uso: "Usa el Agent Control Center para…", `/agent-control-center:coordinador`, o un agente directo: "Usa product-owner para…". Lista con `/agents`.

Los plugins no pueden traer permisos de `settings.json`. Para que Claude pida confirmación antes de push, release o `docker push` en un proyecto, copia `.claude/settings.json` de este repositorio al proyecto.
