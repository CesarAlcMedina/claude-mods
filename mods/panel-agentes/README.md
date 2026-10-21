# panel-agentes

Panel junto al chat para el Agent Control Center. Muestra qué agente está trabajando ahora, en qué tarea y con qué herramienta, y qué entregó cada uno al terminar.

- **Cabecera**: botón **Chat de grupo** y un resumen: cuántos agentes están en curso, completados y disponibles.
- **Equipo**: pestañas Todos, En curso, Completados y Disponibles, y una tarjeta por cada uno de los ocho roles con su icono, su estado (En curso, Completado, Disponible), lo que hace o cuánto tardó, una barra mientras trabaja y **Abrir chat →**.
- **Modelo**: el selector junto a Equipo elige el modelo de todo el equipo (Predeterminado, Haiku, Sonnet u Opus). El menú **⋯** de cada tarjeta lo cambia solo para ese agente. Se aplica la próxima vez que el agente trabaje y se guarda entre sesiones. Predeterminado deja el modelo que trae el agente.
- **Chat**: **Abrir chat →** habla con ese agente. En el **Chat de grupo**, si nombras a alguien (`@po`, `@ba`, `@ux`, `@dev`, `@reviewer`, `@qa`, `@devops`, `@research`) contestan solo esos; si no nombras a nadie, se pregunta a los ocho y solo aparecen los que tienen algo útil que decir. Cada respuesta es un agente que trabaja, así que gasta uso de tu plan. Claude no ve estos chats. En el móvil el chat se lee pero no se escribe.
- **Entregas recientes**: las tres últimas (o todas con **Ver todas →**), con el modelo, la duración y las herramientas. Al abrir una ves su resumen, y **Leer análisis completo →** muestra el informe entero.
- **Limpiar** vacía el panel.

El panel se abre solo cuando Claude delega en un agente. También se abre con `/panel-agentes`.

Los agentes no tienen chat propio: hablas con Claude y Claude les pasa el trabajo. El panel solo muestra lo que hacen.

Necesita el plugin `agent-control-center`. Se ve en una sesión de código (pestaña Code de la app o terminal), no en la vista de Proyectos.
