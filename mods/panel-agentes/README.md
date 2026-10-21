# panel-agentes

Panel junto al chat para el Agent Control Center. Muestra qué agente está trabajando ahora, en qué tarea y con qué herramienta, y qué entregó cada uno al terminar.

- **Cabecera**: botón **Chat de grupo** y un resumen: cuántos agentes están en curso, completados y disponibles.
- **Equipo**: pestañas Todos, En curso, Completados y Disponibles, y una tarjeta por cada uno de los ocho roles con su icono, su estado (En curso, Completado, Disponible), lo que hace o cuánto tardó, una barra mientras trabaja y **Abrir chat →**.
- **Modelo**: el selector junto a Equipo elige el modelo de todo el equipo (Predeterminado, Haiku, Sonnet u Opus). El menú **⋯** de cada tarjeta lo cambia solo para ese agente. Se aplica la próxima vez que el agente trabaje y se guarda entre sesiones. Predeterminado deja el modelo que trae el agente.
- **Chat**: **Abrir chat →** habla con ese agente. En el **Chat de grupo**, si nombras a alguien (`@po`, `@ba`, `@ux`, `@dev`, `@reviewer`, `@qa`, `@devops`, `@research`) contestan solo esos; si no nombras a nadie, se pregunta a los ocho y solo aparecen los que tienen algo útil que decir. Contesta el modelo hablando como ese agente, con lo que sabe de tu conversación y de lo que el equipo ha hecho, pero sin herramientas: no lee ni cambia archivos (para eso, pídeselo a Claude). Así funciona también en modo automático. Los agentes también se hablan entre ellos en el Chat de grupo: si en su chat le pides a uno que hable con otro («habla con el PO»), le escribe allí y el otro le contesta; y si en el grupo uno nombra a otro con @, el nombrado responde. Una cadena entre agentes se para tras unos pocos saltos. Cada respuesta gasta uso de tu plan. Claude no ve estos chats. En el móvil el chat se lee pero no se escribe.
- **Entregas recientes**: las tres últimas (o todas con **Ver todas →**), con el modelo, la duración y las herramientas. Al abrir una ves su resumen, y **Leer análisis completo →** muestra el informe entero.
- **Limpiar** vacía el panel.

El panel se abre solo cuando Claude delega en un agente. También se abre con `/panel-agentes`.

El trabajo de verdad (leer y cambiar archivos) lo hacen los agentes cuando Claude se lo pasa; el chat del panel es para hablar con ellos.

Necesita el plugin `agent-control-center`. Se ve en una sesión de código (pestaña Code de la app o terminal), no en la vista de Proyectos.
