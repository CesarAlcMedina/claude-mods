# panel-agentes

Panel junto al chat para el Agent Control Center. Muestra qué agente está trabajando ahora, en qué tarea y con qué herramienta, y qué entregó cada uno al terminar.

- **Equipo**: una mini tarjeta por cada uno de los ocho roles, en el orden del flujo. ● trabajando, ✓ entregó, ✗ falló, ○ libre.
- **Modelo**: cada tarjeta tiene un selector (Predeterminado, Haiku, Sonnet u Opus). El agente usará ese modelo la próxima vez que trabaje, y la elección se guarda entre sesiones. Predeterminado deja el modelo que trae el agente.
- **Entregas**: cada informe terminado, con el modelo que usó, su duración y cuántas herramientas usó. Toca una entrega para leer el informe completo.
- **Limpiar** vacía el panel.

El panel se abre solo cuando Claude delega en un agente. También se abre con `/panel-agentes`.

Los agentes no tienen chat propio: hablas con Claude y Claude les pasa el trabajo. El panel solo muestra lo que hacen.

Necesita el plugin `agent-control-center`. Se ve en una sesión de código (pestaña Code de la app o terminal), no en la vista de Proyectos.
