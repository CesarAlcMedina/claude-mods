# panel-agentes

Panel junto al chat para el Agent Control Center. Muestra qué agente está trabajando ahora, en qué tarea y con qué herramienta, y qué entregó cada uno al terminar.

- **Equipo**: una mini tarjeta por cada uno de los ocho roles, en el orden del flujo. ● trabajando, ✓ entregó, ✗ falló, ○ libre.
- **Modelo**: cada tarjeta tiene un selector (Predeterminado, Haiku, Sonnet u Opus). El agente usará ese modelo la próxima vez que trabaje, y la elección se guarda entre sesiones. Predeterminado deja el modelo que trae el agente.
- **Chat**: cada tarjeta tiene un botón Chat para hablar con ese agente. Arriba está el **Chat de grupo** con todo el equipo: si nombras a alguien (`@po`, `@ba`, `@ux`, `@dev`, `@reviewer`, `@qa`, `@devops`, `@research`) contestan solo esos; si no nombras a nadie, se pregunta a los ocho y solo aparecen los que tienen algo útil que decir. Cada respuesta es un agente que trabaja, así que gasta uso de tu plan. Claude no ve estos chats. En el móvil el chat se lee pero no se escribe.
- **Entregas**: cada informe terminado, con el modelo que usó, su duración y cuántas herramientas usó. Toca una entrega para leer el informe completo.
- **Limpiar** vacía el panel.

El panel se abre solo cuando Claude delega en un agente. También se abre con `/panel-agentes`.

Los agentes no tienen chat propio: hablas con Claude y Claude les pasa el trabajo. El panel solo muestra lo que hacen.

Necesita el plugin `agent-control-center`. Se ve en una sesión de código (pestaña Code de la app o terminal), no en la vista de Proyectos.
