import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnStepInput } from 'claude-code'

import type { AgentRun, ChatMessage, RunStatus, TeamFilter } from '../types'

const PANE = 'panel-agentes'
const TITLE = 'Agentes'
const PREFIX = 'agent-control-center:'
const GROUP = 'grupo'
const ME = 'tu'
// The panel's own quiet lines in a chat.
const NOTE = 'panel'

const runs = atom({ plugin: 'panel-agentes', key: 'runs' } as const, [])
const expanded = atom({ plugin: 'panel-agentes', key: 'expanded' } as const, null)
const chat = atom({ plugin: 'panel-agentes', key: 'chat' } as const, [])
const view = atom({ plugin: 'panel-agentes', key: 'view' } as const, '')
const full = atom({ plugin: 'panel-agentes', key: 'full' } as const, null)
const filter = atom({ plugin: 'panel-agentes', key: 'filter' } as const, 'todos')
const menu = atom({ plugin: 'panel-agentes', key: 'menu' } as const, null)
const showAll = atom({ plugin: 'panel-agentes', key: 'showAll' } as const, false)
const modelsShown = atom({ plugin: 'panel-agentes', key: 'models' } as const, {})
const effortsShown = atom({ plugin: 'panel-agentes', key: 'efforts' } as const, {})
const paused = atom({ plugin: 'panel-agentes', key: 'paused' } as const, [])
const earlier = atom({ plugin: 'panel-agentes', key: 'earlier' } as const, false)
const requests = atom({ plugin: 'panel-agentes', key: 'requests' } as const, [])

// The team in the order the coordinador skill hands work along, with the
// short names an @mention in the group chat may use.
const TEAM: { role: string; label: string; aliases: string[]; job: string }[] = [
  { role: 'product-owner', label: 'Product Owner', aliases: ['po'], job: 'objetivos, valor de negocio, épicas, historias de usuario y prioridades' },
  { role: 'business-analyst', label: 'Analista de negocio', aliases: ['ba', 'analista'], job: 'requisitos funcionales y no funcionales, reglas de negocio y criterios de aceptación' },
  { role: 'ux-ui-designer', label: 'Diseño UX/UI', aliases: ['ux', 'ui', 'diseño'], job: 'flujos, wireframes, estados de los componentes y accesibilidad' },
  { role: 'backend-engineer', label: 'Backend', aliases: ['backend', 'back', 'dev'], job: 'APIs, lógica de negocio, datos e integraciones del lado del servidor, con pruebas unitarias' },
  { role: 'frontend-engineer', label: 'Frontend', aliases: ['frontend', 'front', 'dev'], job: 'componentes, pantallas, estilos, accesibilidad y consumo de APIs, con pruebas unitarias' },
  { role: 'code-reviewer', label: 'Revisión de código', aliases: ['reviewer', 'revision', 'revisión'], job: 'calidad, mantenibilidad, seguridad, rendimiento y errores lógicos del código' },
  { role: 'qa-engineer', label: 'QA', aliases: ['qa'], job: 'estrategia y planes de prueba, escenarios positivos, negativos y de borde, y defectos' },
  { role: 'devops-engineer', label: 'DevOps', aliases: ['devops'], job: 'CI/CD, Docker y automatización de builds y despliegues' },
  { role: 'research-agent', label: 'Investigación', aliases: ['research', 'investigacion', 'investigación'], job: 'investigar tecnologías, documentación y buenas prácticas, con fuentes' },
]

const roleOf = (subagentType: string) =>
  subagentType.startsWith(PREFIX) ? subagentType.slice(PREFIX.length) : subagentType

// Roles the team no longer has, still named in runs and chats kept from before.
const FORMER: Record<string, string> = { 'software-engineer': 'Ingeniería' }

// The Coordinador is the main session itself, running agent-control-center's
// coordinador skill: a subagent cannot launch others, so the flow is run
// there, with the session's own permissions, and the panel hands it work
// through the prompt box. In the group chat it takes every message that
// names no agent.
const COORD = 'coordinador'
const SKILL = '/agent-control-center:coordinador'
const FROM_PANEL = 'Nueva función pedida desde el panel de agentes'
const ENGINEERS = ['backend-engineer', 'frontend-engineer', 'software-engineer']

const labelOf = (role: string) =>
  role === ME
    ? 'Tú'
    : role === COORD
      ? 'Coordinador'
      : (TEAM.find(one => one.role === role)?.label ?? FORMER[role] ?? role)

const ICON: Record<RunStatus, string> = {
  trabajando: '●',
  entregado: '✓',
  fallo: '✗',
  interrumpido: '■',
}

const COLOR: Record<RunStatus, 'warning' | 'success' | 'error' | 'inactive'> = {
  trabajando: 'warning',
  entregado: 'success',
  fallo: 'error',
  interrumpido: 'inactive',
}

const duration = (ms?: number) => {
  if (ms === undefined) return ''
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

const short = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

// The model each role runs on, chosen in the panel and kept across sessions:
// the team's choice (under ALL), which a role's own choice overrides. An
// empty choice leaves the model to the agent's own definition.
const MODELS_KEY = 'modelos'
const ALL = '*'
const MODELS: { value: string; label: string }[] = [
  { value: '', label: 'Predeterminado' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
]

const AGENT_MODELS = [{ value: '', label: 'Como el equipo' }, ...MODELS.slice(1)]

// A full model id reads as its family: claude-sonnet-… shows as Sonnet.
const modelLabel = (value: string) =>
  MODELS.find(one => one.value !== '' && value.includes(one.value))?.label ??
  MODELS.find(one => one.value === value)?.label ??
  value

// How hard each role's model thinks, chosen and kept the same way. It is set
// on each model request of the agent's, where its model takes an effort.
const EFFORTS_KEY = 'esfuerzos'
const EFFORTS: { value: string; label: string }[] = [
  { value: '', label: 'Predeterminado' },
  { value: 'low', label: 'Bajo' },
  { value: 'medium', label: 'Medio' },
  { value: 'high', label: 'Alto' },
  { value: 'xhigh', label: 'Muy alto' },
  { value: 'max', label: 'Máximo' },
]

const AGENT_EFFORTS = [{ value: '', label: 'Como el equipo' }, ...EFFORTS.slice(1)]

const effortLabel = (value: string) => EFFORTS.find(one => one.value === value)?.label ?? value

const readChoices = async ($: EngineInterface, key: string): Promise<Record<string, string>> => {
  const value = await $.store.get(key)
  return value !== null && typeof value === 'object' ? (value as Record<string, string>) : {}
}

const readModels = ($: EngineInterface) => readChoices($, MODELS_KEY)

const setModel = async ($: EngineInterface, role: string, model: string) => {
  const models = { ...(await readModels($)) }
  if (model === '') delete models[role]
  else models[role] = model
  await $.store.set(MODELS_KEY, models)
  await update($, modelsShown, () => models)
}

const setEffort = async ($: EngineInterface, role: string, effort: string) => {
  const efforts = { ...(await readChoices($, EFFORTS_KEY)) }
  if (effort === '') delete efforts[role]
  else efforts[role] = effort
  await $.store.set(EFFORTS_KEY, efforts)
  await update($, effortsShown, () => efforts)
}

// Stopping. The panel cannot end an agent's loop, but it can refuse every
// tool call the agent makes from then on, with a note telling it to wrap up:
// it ends within a step or two. A role on pause is stopped the same way, and
// a new agent of it is refused until the person resumes it.
const HALT = 'El usuario paró a este agente desde el panel de agentes. No sigas trabajando: termina ya con un resumen breve de lo que hiciste y lo que falta.'

const isPaused = (list: string[], role: string) => list.includes(ALL) || list.includes(role)

const halt = ($: EngineInterface, role?: string) =>
  update($, runs, list =>
    list.map(one =>
      one.status === 'trabajando' && (role === undefined || one.role === role)
        ? { ...one, isHalted: true as const }
        : one,
    ),
  )

const togglePause = async ($: EngineInterface, role: string) => {
  const now = await read($, paused)
  const isOn = now.includes(role)
  await update($, paused, list => (isOn ? list.filter(one => one !== role) : [...list, role]))
  if (!isOn) await halt($, role === ALL ? undefined : role)
}

const STATUS_TEXT: Record<RunStatus, string> = {
  trabajando: 'Trabajando',
  entregado: 'Entregó',
  fallo: 'Falló',
  interrumpido: 'Interrumpido',
}

// The status chip on a card and a delivery.
const PILL: Record<RunStatus | 'libre', { icon: string; text: string; color: 'warning' | 'success' | 'error' | 'inactive' }> = {
  trabajando: { icon: '●', text: 'En curso', color: 'warning' },
  entregado: { icon: '✓', text: 'Completado', color: 'success' },
  fallo: { icon: '✗', text: 'Falló', color: 'error' },
  interrumpido: { icon: '■', text: 'Interrumpido', color: 'inactive' },
  libre: { icon: '○', text: 'Disponible', color: 'inactive' },
}

const PAUSED_PILL = { icon: '⏸', text: 'En pausa', color: 'warning' } as const

// The panel's dark palette, from the person's mockup.
const TONE = {
  card: '#1f2024',
  border: '#34363c',
  hover: '#4a4d55',
  tile: '#2c2e33',
  badge: '#2e3036',
  workingCard: '#28241a',
  workingBorder: '#6b5a2a',
  doneTile: '#1f3a2b',
  tabOn: '#2d2a40',
  accent: '#b4a5ff',
}

// A delivery's title: its task without the role's own prefix ("BA: …").
const titleOf = (run: AgentRun) => {
  const task = run.task.replace(/^[\p{L}/ ]{1,24}:\s*/u, '').trim() || run.task
  return task.charAt(0).toUpperCase() + task.slice(1)
}

// A report's first paragraph as plain text, for the summary box.
const summaryOf = (report?: string) => {
  const paragraph =
    (report ?? '')
      .split(/\n\s*\n/)
      .map(part => part.replace(/^#+\s.*$/gm, '').trim())
      .find(part => part.length > 0) ?? ''
  const plain = paragraph.replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim()
  return plain === '' ? 'Sin informe.' : short(plain, 320)
}

// Line icons, drawn in the surface's pictures where it has them.
const ICONS: Record<string, string> = {
  'product-owner': '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  'business-analyst': '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18M11 13v2h2v-2"/>',
  'ux-ui-designer': '<path d="M16 3l5 5L8 21H3v-5z"/><path d="M13 6l5 5"/>',
  'backend-engineer': '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  'frontend-engineer': '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M9 9l-2 2 2 2M15 9l2 2-2 2"/>',
  'code-reviewer': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
  'qa-engineer': '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  'devops-engineer': '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8"/><path d="M12 13v8M9 16l3-3 3 3"/>',
  'research-agent': '<path d="M3 21h18M6 21v-6M11 21V9M16 21v-9M21 21V5"/>',
  coordinador: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  grupo: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2.4.7 4 2.4 4 5.2"/>',
  entregas: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
}
const GLYPHS: Record<string, string> = {
  coordinador: '🧭',
  'product-owner': '👤',
  'business-analyst': '💼',
  'ux-ui-designer': '✏️',
  'backend-engineer': '🗄️',
  'frontend-engineer': '🖥️',
  'code-reviewer': '🔍',
  'qa-engineer': '🛡️',
  'devops-engineer': '☁️',
  'research-agent': '📊',
  grupo: '👥',
  entregas: '📦',
}
const svg = (body: string, size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#c9ced6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

// The chat. Each message is answered by the model speaking as the role, with
// no tools: a spawned agent would start without a request of the person's,
// which auto mode refuses. The answer forks the session's own conversation,
// so it knows the project and what the team did; where there is nothing to
// fork yet, a plain completion answers.
//
// A group message that names no one goes to the roles a quick model call
// picks for what the message needs from them: one as a rule, a second only
// for something the first cannot give, and none when nothing is asked or
// left open. Roles answer one after another, each seeing what was already
// said to the message, so a later one can pass (PASS) instead of saying it
// again.
const PASS = 'PASO'
const NOBODY = 'NADIE'
// What an agent reads of its chat (and, in its own chat, of the group's),
// and what the pick reads: the chats' own lines, not only those the pane
// shows.
const HISTORY_CHARS = 8000
const PICK_CHARS = 4000
const GROUP_CHARS = 3000
const PICKED = 2
// The chat shows its last lines; the earlier ones open on request.
const SHOWN = 12

// One role's turn at a message: what it is asked to bring, and whether it
// must answer or may pass.
type Turn = { role: string; aim?: string; mustAnswer: boolean }

const isPass = (answer: string) => new RegExp(`^${PASS}\\.?$`, 'i').test(answer)
const isQuestion = (text: string) => /[?¿]/.test(text)

const roleNamed = (word: string) =>
  TEAM.find(one => one.role === word || one.aliases.includes(word))?.role

// The roles a group message names with @, or every role when it names none.
const addressed = (text: string) => {
  const words = [...text.toLowerCase().matchAll(/@([\p{L}/-]+)/gu)].map(m => m[1] ?? '')
  const named = TEAM.filter(one =>
    words.some(word => word === one.role || one.aliases.includes(word)),
  ).map(one => one.role)
  return { roles: named.length > 0 ? named : TEAM.map(one => one.role), isNamed: named.length > 0 }
}

// The pick's lines, «@alias: what to bring», in the order written.
const turnsOf = (text: string): Turn[] => {
  const turns: Turn[] = []
  for (const m of text.matchAll(/@([\p{L}/-]+)([^@\n]*)/gu)) {
    const role = roleNamed((m[1] ?? '').toLowerCase())
    if (role === undefined || turns.some(one => one.role === role)) continue
    const aim = (m[2] ?? '').replace(/^[\s:,;—–-]+|[\s,;]+$/g, '')
    turns.push({ role, aim: aim || undefined, mustAnswer: turns.length === 0 })
  }
  return turns
}

// What a group message that names no one is: a question on how the work
// goes, a new function to build, or anything else, for which the Coordinador
// consults the agents picked.
type Kind = 'estado' | 'funcion' | 'otro'

const kindOf = (text: string): Kind => {
  const said = /TIPO:\s*(estado|funci[oó]n|otro)/i.exec(text)?.[1]?.toLowerCase()
  return said === 'estado' ? 'estado' : said?.startsWith('funci') ? 'funcion' : 'otro'
}

// What the message is, and whom the Coordinador consults. A clear "no one"
// stands, unless the person asked something; a pick that fails or names no
// one usable still leaves one role to consult, the Product Owner, asked to
// answer or to ask what is missing.
const pick = async (
  $: EngineInterface,
  history: ChatMessage[],
  text: string,
): Promise<{ kind: Kind; turns: Turn[] }> => {
  const team = TEAM.map(one => `@${one.aliases[0]}: ${one.label}, ${one.job}`).join('\n')
  const prompt = [
    'Clasificas los mensajes del chat de grupo de un equipo de agentes de software y decides a quién consulta el Coordinador. Cada consulta cuesta: elige por la aportación concreta que necesita el mensaje, no solo por la especialidad.',
    `El equipo:\n${team}`,
    history.length > 0
      ? `Chat hasta ahora (fíjate en lo que sigue pendiente: preguntas sin contestar, decisiones a medias):\n\n${transcript(history, PICK_CHARS)}`
      : '',
    `Mensaje nuevo del usuario:\n\n${text}`,
    [
      'Primero, qué es el mensaje: «TIPO: estado» si pregunta cómo va un trabajo, qué falta o si algo está hecho; «TIPO: funcion» si pide construir, añadir o cambiar una funcionalidad del producto; «TIPO: otro» para todo lo demás (preguntas, opiniones, decisiones, saludos).',
      'Después, solo para TIPO: otro, a quién consultar:',
      '- Lo normal es un solo agente. Elige un segundo solo si aporta algo distinto que el primero no puede dar: otra parte de la respuesta, otra evidencia, otro riesgo. Que dos roles tengan que ver con el tema no significa que deban contestar los dos.',
      '- Si el usuario comunica una decisión o confirma algo, elige uno solo: el que tiene que actuar o el que tiene algo que añadir. Nunca una ronda de confirmaciones.',
      '- Una pregunta del usuario siempre necesita a alguien que la conteste o pida la aclaración que falte.',
      `- Si el mensaje no pide nada (un gracias, un vale) o el usuario cierra la conversación, responde solo ${NOBODY}, aunque quede algo pendiente: se retoma cuando vuelva.`,
      '- Lo que pides a cada uno es una aportación de chat, no una tarea ni un entregable: dilo en pocas palabras. Ante una decisión, pide reconocerla y, si lo hay, el siguiente paso o un riesgo; nunca que rehaga requisitos, planes o documentos.',
      `Responde solo con la línea TIPO y, si es otro, una línea por agente, ${PICKED} como mucho y el más necesario primero, así: @alias: lo concreto que debe aportar. O, en lugar de los agentes, ${NOBODY}.`,
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
  const reply = await $.model
    .complete({ model: 'haiku', prompt, effort: 'low' })
    .catch(() => ({ isAnswered: false as const }))
  const answer = reply.isAnswered ? reply.text.trim() : ''
  const kind = kindOf(answer)
  const said = answer.replace(/^.*TIPO:.*$/im, '').trim()
  const turns = turnsOf(said).slice(0, PICKED)
  if (kind !== 'otro' || turns.length > 0) return { kind, turns }
  const isNobody = said.replace(/[\s.*_]/g, '').toUpperCase() === NOBODY
  if (isNobody && !isQuestion(text)) return { kind, turns: [] }
  return {
    kind,
    turns: [{ role: 'product-owner', aim: 'contestar al usuario o pedirle la aclaración que haga falta', mustAnswer: true }],
  }
}

// A chat as text, in at most max characters. Over the limit the oldest
// answers go first: what the person said, their decisions among it, stays
// longest. The newest line always stays.
const transcript = (messages: ChatMessage[], max = HISTORY_CHARS) => {
  const lines = messages
    .filter(one => !one.isPending && !one.isNote)
    .map(one => ({ isMine: one.from === ME, text: `${labelOf(one.from)}: ${one.text}` }))
  const size = () => lines.reduce((sum, one) => sum + one.text.length + 2, 0)
  while (size() > max && lines.length > 1) {
    const at = lines.findIndex(one => !one.isMine)
    lines.splice(at < 0 || at === lines.length - 1 ? 0 : at, 1)
  }
  return lines.map(one => one.text).join('\n\n')
}

// What the panel knows of a role's own work this session.
const workOf = (role: string, list: AgentRun[]) => {
  const mine = list.filter(one => one.role === role)
  if (mine.length === 0) return 'En esta sesión todavía no has trabajado en ninguna tarea.'
  return mine
    .slice(-3)
    .map(run => {
      const state =
        run.status === 'trabajando'
          ? `estás trabajando en ella ahora${run.lastTool ? ` (última herramienta: ${run.lastTool})` : ''}`
          : `${STATUS_TEXT[run.status].toLowerCase()}${run.durationMs !== undefined ? ` en ${duration(run.durationMs)}` : ''}`
      const summary = run.report ? ` Resumen de tu informe: ${summaryOf(run.report)}` : ''
      return `- Tarea «${run.task}»: ${state}.${summary}`
    })
    .join('\n')
}

// Agents reach each other through the group chat. In its own chat a role
// that must ask another writes a line opening with TO_GROUP; the panel posts
// it in the group, and whoever it names with @ answers there. A reply in the
// group that names others with @ is answered the same way, and the one named
// may pass when nothing is left to answer. HOPS bounds how far one message
// of the person's can travel from agent to agent, and RELAYS how many
// answers between agents it can start in all.
const TO_GROUP = /^[\s*_]*al grupo[\s*_]*:[\s*_]*/i
const HOPS = 2
const RELAYS = 3

// How every chat answer talks, and what it may claim without tools.
const VOICE = [
  'Cómo hablas:',
  '- En español, como en un chat de trabajo. Breve por defecto, a la medida de lo que se pide: una confirmación o un dato, una frase; una respuesta normal, dos a cuatro frases, por debajo de unas 80 palabras. Un plan, una lista larga, código o un entregable completo solo si te lo piden; si el tema da para más, da lo esencial y ofrece el detalle.',
  '- Respeta lo que el usuario ya decidió en la conversación. Si una pregunta o una propuesta choca con una decisión suya, dilo en lugar de contradecirla.',
  '- Ve directo a lo que aportas. No abras con fórmulas («Perfecto», «Entendido», «Claro», «Buena pregunta»), no resumas el mensaje al que contestas y no anuncies tu rol («Como QA…», «Desde backend…»).',
  '- Listas o código solo si te los piden o si de verdad hacen falta. Sin títulos ni negritas.',
  '- Te distingue tu criterio profesional y lo que te preocupa desde tu especialidad, no un personaje: sin emociones, anécdotas ni experiencias humanas.',
].join('\n')

const TRUTH = [
  'Qué puedes afirmar:',
  '- En este chat no tienes herramientas: no lees ni cambias archivos y no ejecutas nada. Nunca digas que estás editando, probando, revisando el código o incorporando cambios, ni que lo vas a hacer ahora.',
  '- Distingue lo que recomiendas, lo que ya está hecho (solo si aparece en tu trabajo de esta sesión o en la conversación) y lo que falta ejecutar. Si te piden ejecutar algo, o alguien podría creer que ya está hecho, dilo y sugiere pedírselo a Claude en el chat principal; no lo añadas como coletilla a cada respuesta.',
].join('\n')

type Prompt = {
  role: string
  channel: string
  /** In a role's own chat, the group's lines, for what was decided there. */
  group: ChatMessage[]
  before: ChatMessage[]
  message: ChatMessage
  since: ChatMessage[]
  turn: Turn
  canReach: boolean
  work: string
  /** Asked by the Coordinador, who answers the person with what it gathers. */
  isConsulted?: boolean
}

const chatPrompt = ({ role, channel, group, before, message, since, turn, canReach, work, isConsulted }: Prompt) => {
  const isGroup = channel === GROUP
  const member = TEAM.find(one => one.role === role)
  const team = TEAM.map(one => `${one.label} (@${one.aliases[0]})`).join(', ')
  const writer = message.from === ME ? 'del usuario' : `del agente ${labelOf(message.from)}`
  const reach = !canReach
    ? 'No nombres a otros agentes con @ en esta respuesta.'
    : isGroup
      ? 'Nombra con @ a otro agente solo para resolver una dependencia concreta: una pregunta que solo ese rol puede contestar y sin cuya respuesta no puedes seguir; hazla concreta. Nunca para pedir que confirme, para agradecer o de pasada. Si te escribe otro agente, contesta lo que te pide sin devolverle la pregunta.'
      : `Si el usuario te pide hablar con otro agente, o necesitas algo concreto de otro para seguir, añade al final una línea que empiece por «AL GRUPO:» con el mensaje para el chat de grupo, nombrando con @ a quien va dirigido. El equipo: ${team}. Ese agente te contestará en el chat de grupo.`
  const pass = turn.mustAnswer
    ? ''
    : message.from === ME
      ? `Si lo que ibas a aportar ya está dicho, o no tienes nada nuevo, responde solo con la palabra ${PASS}.`
      : `Si el mensaje ya no te pide nada (solo confirma, agradece o cierra el tema), o lo que ibas a decir ya está dicho, responde solo con la palabra ${PASS}: la conversación puede terminar ahí.`
  return [
    `A partir de aquí no eres el asistente principal: eres el agente ${labelOf(role)} del Agent Control Center, que se ocupa de ${member?.job ?? 'su rol'}.`,
    isConsulted
      ? 'El Coordinador te consulta por un mensaje del usuario en el chat de grupo del panel de agentes, y le contestará con lo que reúna: dale solo tu aportación, sin dirigirte al usuario ni saludar.'
      : isGroup
        ? `Estás en el chat de grupo del panel de agentes, con el usuario y todo el equipo: ${team}.`
        : 'Estás en tu chat con el usuario en el panel de agentes.',
    `Lo que has hecho en esta sesión:\n${work}`,
    VOICE,
    isGroup
      ? 'Aporta solo lo nuevo: una respuesta pendiente, una decisión, evidencia, un riesgo concreto, una pregunta necesaria o un avance verificado. Repetir o reformular lo que ya se dijo no cuenta. Ante una decisión del usuario, reconócela en una frase y añade solo lo que cambia o el siguiente paso; no rehagas entregables en el chat.'
      : '',
    TRUTH,
    reach,
    turn.aim ? `Lo que se espera de ti en este mensaje (una aportación de chat, no un entregable): ${turn.aim}.` : '',
    pass,
    group.length > 0
      ? `Lo último del chat de grupo, donde el usuario también decide cosas con el equipo:\n\n${transcript(group, GROUP_CHARS)}`
      : '',
    before.length > 0 ? `Chat hasta ahora:\n\n${transcript(before)}` : '',
    `Mensaje nuevo ${writer}:\n\n${message.text}`,
    since.length > 0
      ? `Lo que ya se respondió a este mensaje:\n\n${transcript(since)}\n\nNo lo repitas ni lo reformules: añade solo lo que falte.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

const answerAs = async ($: EngineInterface, role: string, prompt: string) => {
  const forked = await $.model.fork({ prompt })
  if (forked.isAnswered || forked.reason !== 'nothing-to-fork') return forked
  const models = await readModels($)
  return $.model.complete({ model: models[role] || models[ALL] || 'sonnet', prompt })
}

// The roles a message of another agent's names with @, never the writer.
const reached = (text: string, writer: string) => {
  const { roles, isNamed } = addressed(text)
  return isNamed ? roles.filter(role => role !== writer) : []
}

// As many of the roles as the budget still allows, spending it. An agent
// written to by another may pass.
const take = (roles: string[], budget: { left: number }): Turn[] => {
  const taken = roles.slice(0, Math.max(0, budget.left))
  budget.left -= taken.length
  return taken.map(role => ({ role, mustAnswer: false }))
}

const send = async ($: EngineInterface, channel: string, text: string) => {
  const said = text.trim()
  if (said === '') return
  const history = (await read($, chat)).filter(one => one.channel === channel)
  const message: ChatMessage = { id: crypto.randomUUID(), channel, from: ME, text: said }
  await update($, chat, lines => [...lines, message])
  await follow($, channel)
  const named = channel === GROUP ? addressed(said) : { roles: [channel], isNamed: true }
  if (!named.isNamed) return coordinate($, channel, history, message)
  // Whoever the person names must answer.
  const turns = named.roles.map(role => ({ role, mustAnswer: true }))
  await ask($, channel, turns, message, 0, { left: RELAYS })
}

// The Coordinador's answer to a group message that names no one. Asking how
// the work goes only reads what the panel and the session hold; a new
// function is handed to the main session; anything else, it asks the agents
// it needs and answers with what they bring, once.
const coordinate = async ($: EngineInterface, channel: string, history: ChatMessage[], message: ChatMessage) => {
  const id = crypto.randomUUID()
  await update($, chat, all => [...all, { id, channel, from: COORD, text: '', isPending: true }])
  await follow($, channel)
  const { kind, turns } = await pick($, history, message.text)
  const text =
    kind === 'estado'
      ? await report($, history, message)
      : kind === 'funcion'
        ? await handOff($, message.text)
        : await gather($, history, message, turns)
  await update($, chat, all =>
    all.flatMap(one => {
      if (one.id !== id) return [one]
      if (text === null) {
        return [{ id, channel, from: NOTE, text: 'Nadie tenía nada que añadir.', isNote: true as const }]
      }
      return [{ id, channel, from: COORD, text }]
    }),
  )
  await follow($, channel)
}

const say = async ($: EngineInterface, role: string, prompt: string) => {
  const reply = await answerAs($, role, prompt).catch((error: unknown) => ({
    isAnswered: false as const,
    reason: String(error),
  }))
  return reply.isAnswered ? reply.text.trim() || '_Sin respuesta._' : `_No pude contestar (${reply.reason})._`
}

const COORD_ROLE =
  'A partir de aquí no eres el asistente principal: eres el Coordinador del Agent Control Center, en el chat de grupo del panel de agentes. Recibes los mensajes del usuario que no nombran a ningún agente.'

// The states a piece of work can be in, as the panel knows them.
const STATE: Record<RunStatus, string> = {
  trabajando: 'iniciado, trabaja en ello ahora',
  entregado: 'terminado, entregó su informe',
  fallo: 'bloqueado, falló antes de entregar',
  interrumpido: 'interrumpido antes de terminar',
}

// What the panel can vouch for: the last function asked from it, and the
// agents that started since (or this session's, with none asked). An agent
// still working is not asked how it goes, which would take it off its task:
// what it last wrote is read instead.
const facts = async ($: EngineInterface) => {
  const list = await read($, runs)
  const asked = (await read($, requests)).at(-1)
  const scope = asked ? list.filter(one => (one.startedAt ?? 0) >= asked.at) : list.slice(-12)
  const lines: string[] = []
  if (asked) {
    lines.push(
      `Última función pedida desde el panel: «${asked.goal}», hace ${duration(Date.now() - asked.at)}. ${
        asked.isSent ? 'La orden llegó a la sesión principal.' : 'No consta que la orden se enviara en la sesión principal.'
      }`,
    )
  }
  if (scope.length === 0) {
    lines.push(asked ? 'Desde entonces no ha empezado ningún agente.' : 'El panel no tiene registrado ningún agente en esta sesión.')
  }
  for (const run of scope) {
    const took = run.durationMs !== undefined ? ` (${duration(run.durationMs)})` : ''
    let line = `- ${labelOf(run.role)}, tarea «${run.task}»: ${STATE[run.status]}${took}, ${run.tools} herramientas.`
    if (run.status === 'trabajando') {
      const seen = await $.session.messages({ agentId: run.id }).catch(() => ({ deny: 'error' }))
      const last = Array.isArray(seen)
        ? seen.filter(one => one.role === 'assistant' && one.text.trim() !== '').at(-1)?.text
        : undefined
      line += last ? ` Lo último que escribió: «${short(last, 400)}»` : ' No se pudo leer lo que lleva hecho.'
      if (run.lastTool) line += ` Última herramienta: ${run.lastTool}.`
    } else if (run.report) {
      line += ` Resumen de su informe: ${summaryOf(run.report)}`
    }
    lines.push(line)
  }
  const builds = scope.filter(one => ENGINEERS.includes(one.role))
  if (builds.length > 0) {
    const built = Math.max(...builds.map(one => one.startedAt ?? 0))
    const checked = scope.some(
      one => one.role === 'qa-engineer' && one.status === 'entregado' && (one.startedAt ?? 0) > built,
    )
    lines.push(
      checked && builds.every(one => one.status === 'entregado')
        ? 'QA entregó después del desarrollo: su resumen dice si las pruebas pasan.'
        : 'No consta ninguna entrega de QA posterior al desarrollo: nada está verificado.',
    )
  }
  return lines.join('\n')
}

const report = async ($: EngineInterface, history: ChatMessage[], message: ChatMessage) => {
  const known = await facts($)
  const prompt = [
    `${COORD_ROLE} Ahora el usuario pregunta cómo va el trabajo. Solo informas: no lanzas agentes, no retomas tareas y no prometes trabajo.`,
    `Datos que el panel acaba de comprobar:\n${known}`,
    'También ves la conversación principal con Claude: úsala para saber qué se pidió y a quién, y di cuándo algo viene de ahí y no de los datos del panel.',
    [
      'Cómo respondes:',
      '- Identifica la tarea por la que pregunta y a sus responsables. Si no está claro de cuál habla, di de cuál informas.',
      '- Di qué está terminado, qué queda pendiente y si hay algún bloqueo, en pocas frases o una lista corta.',
      '- Usa los estados con su sentido exacto: solicitado (se pidió y no consta que haya empezado), iniciado (un agente trabaja en ello ahora), terminado (el agente entregó), verificado (QA lo probó después del desarrollo y su informe dice que pasa). No llames verificado a nada que no cumpla eso.',
      '- Lo que no se pueda confirmar con estos datos, dilo claramente; no lo supongas.',
    ].join('\n'),
    VOICE,
    TRUTH,
    history.length > 0 ? `Chat hasta ahora:\n\n${transcript(history)}` : '',
    `Pregunta del usuario:\n\n${message.text}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  return say($, COORD, prompt)
}

// A new function goes to the main session, which runs the flow with the
// coordinador skill and launches each agent for real. The panel leaves the
// order in the prompt box: the person's own Enter sends it, so it runs as
// their request, with the permissions they already have.
const handOff = async ($: EngineInterface, goal: string) => {
  await update($, requests, list => [...list, { id: crypto.randomUUID(), goal, at: Date.now() }].slice(-10))
  const order = `${SKILL} ${FROM_PANEL}: «${goal}». Sigue el recorrido «Nueva función» de la skill.`
  const filled = await $.prompt.fill({ text: order }).catch(() => ({ isFilled: false }))
  return filled.isFilled
    ? 'Lo llevo al flujo del equipo. Te dejé la orden en la caja del chat principal: envíala con Enter y empiezo con Product Owner, análisis de negocio y QA, según haga falta, para tener historias, requisitos y criterios de aceptación. Después pasa a desarrollo y a pruebas. Verás a cada agente en su tarjeta, y aquí puedes preguntarme «¿cómo va?».'
    : `Lo llevo al flujo del equipo, pero no pude dejar la orden en la caja del chat principal. Envíala tú allí:\n\n\`\`\`\n${order}\n\`\`\``
}

// Anything else: the agents picked answer the Coordinador in turn, each
// seeing what the one before said, and it answers the person once.
const gather = async ($: EngineInterface, history: ChatMessage[], message: ChatMessage, turns: Turn[]) => {
  if (turns.length === 0) return null
  const list = await read($, runs)
  const heard: ChatMessage[] = []
  for (const turn of turns) {
    const prompt = chatPrompt({
      role: turn.role,
      channel: GROUP,
      group: [],
      before: history,
      message,
      since: heard,
      turn: { ...turn, mustAnswer: heard.length === 0 },
      canReach: false,
      work: workOf(turn.role, list),
      isConsulted: true,
    })
    const reply = await answerAs($, turn.role, prompt).catch(() => ({ isAnswered: false as const }))
    const text = reply.isAnswered ? reply.text.trim() : ''
    if (text !== '' && !isPass(text)) heard.push({ id: crypto.randomUUID(), channel: GROUP, from: turn.role, text })
  }
  const asked = turns.map(turn => labelOf(turn.role)).join(' y ')
  const prompt = [
    `${COORD_ROLE} Consultas solo a quien hace falta y contestas tú, con una sola respuesta.`,
    heard.length > 0
      ? `Por este mensaje consultaste a ${asked}. Sus aportaciones:\n\n${transcript(heard)}`
      : `Por este mensaje consultaste a ${asked}, y nadie tenía nada nuevo que aportar.`,
    [
      'Cómo respondes:',
      '- Reúne las aportaciones en una respuesta clara y natural, más corta que lo que te dieron: quédate con lo esencial, sin repetir ideas ni añadir lo que no dijeron, y ofrece el detalle si lo quiere. Nombra a un rol solo cuando ayude, por ejemplo para atribuir un riesgo o una decisión.',
      '- Si nadie aportó, contesta tú con lo que sabes, o pide la aclaración que falte.',
    ].join('\n'),
    VOICE,
    TRUTH,
    history.length > 0 ? `Chat hasta ahora:\n\n${transcript(history)}` : '',
    `Mensaje nuevo del usuario:\n\n${message.text}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  return say($, COORD, prompt)
}

const openChat = async ($: EngineInterface, channel: string) => {
  await update($, view, () => channel)
  await follow($, channel)
}

// Keeps the newest line of the open chat in view, as a chat app does.
const follow = async ($: EngineInterface, channel: string) => {
  if ((await read($, view)) !== channel) return
  await $.ui.scroll({ to: 'end', in: PANE }).catch(() => undefined)
}

// The roles answer one message in a channel one after another, each with
// what was already said to it; what they say to others is passed on, a hop
// further, before the next role answers.
const ask = async (
  $: EngineInterface,
  channel: string,
  turns: Turn[],
  message: ChatMessage,
  hop: number,
  budget: { left: number },
) => {
  for (const turn of turns) await answer($, channel, turn, message, hop, budget)
}

const answer = async (
  $: EngineInterface,
  channel: string,
  turn: Turn,
  message: ChatMessage,
  hop: number,
  budget: { left: number },
) => {
  const { role } = turn
  const canReach = hop < HOPS
  const id = crypto.randomUUID()
  const everything = (await read($, chat)).filter(one => !one.isPending)
  const lines = everything.filter(one => one.channel === channel)
  const group = channel === GROUP ? [] : everything.filter(one => one.channel === GROUP)
  const at = lines.findIndex(one => one.id === message.id)
  const before = at < 0 ? lines : lines.slice(0, at)
  const since = at < 0 ? [] : lines.slice(at + 1)
  await update($, chat, all => [...all, { id, channel, from: role, text: '', isPending: true }])
  await follow($, channel)

  const work = workOf(role, await read($, runs))
  const prompt = chatPrompt({ role, channel, group, before, message, since, turn, canReach, work })
  const reply = await answerAs($, role, prompt).catch((error: unknown) => ({
    isAnswered: false as const,
    reason: String(error),
  }))
  const text = reply.isAnswered ? reply.text.trim() : ''
  const passes = isPass(text) && !turn.mustAnswer

  // In its own chat, the line for the group leaves the reply.
  const split = text.split('\n')
  const cut = channel === GROUP || !canReach ? -1 : split.findIndex(line => TO_GROUP.test(line))
  const toGroup = cut < 0 ? '' : split.slice(cut).join('\n').replace(TO_GROUP, '').trim()
  const kept = cut < 0 ? text : split.slice(0, cut).join('\n').trim()
  const shown = toGroup === '' ? kept : `${kept}\n\n_Le escribí al chat de grupo: «${toGroup}»_`.trim()

  await update($, chat, all =>
    all.flatMap(one => {
      if (one.id !== id) return [one]
      if (passes) return []
      const said = reply.isAnswered ? shown || '_Sin respuesta._' : `_No pude contestar (${reply.reason})._`
      return [{ id, channel, from: role, text: said }]
    }),
  )
  await follow($, channel)
  if (!canReach || passes || !reply.isAnswered) return

  if (toGroup !== '') {
    const posted: ChatMessage = { id: crypto.randomUUID(), channel: GROUP, from: role, text: toGroup }
    await update($, chat, all => [...all, posted])
    const targets = take(reached(toGroup, role), budget)
    if (targets.length > 0) await ask($, GROUP, targets, posted, hop + 1, budget)
    return
  }
  if (channel === GROUP) {
    const targets = take(reached(text, role), budget)
    if (targets.length > 0) await ask($, GROUP, targets, { id, channel, from: role, text }, hop + 1, budget)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const kept = await readModels($)
    await update($, modelsShown, () => kept)
    const keptEfforts = await readChoices($, EFFORTS_KEY)
    await update($, effortsShown, () => keptEfforts)
    await $.command.register({
      name: 'panel-agentes',
      description: 'Abre el panel de agentes del Agent Control Center',
    })

    return next(e)
  })

  on('command.run', { command: 'panel-agentes' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Panel de agentes abierto.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const role = roleOf(e.subagentType)
    const isMember = TEAM.some(one => one.role === role)
    if (isMember && isPaused(await read($, paused), role)) {
      return {
        deny: `El usuario puso en pausa a ${labelOf(role)} desde el panel de agentes. No lo lances hasta que lo reanude; si hace falta, pregúntale.`,
      }
    }
    const models = isMember ? await readModels($) : {}
    const efforts = isMember ? await readChoices($, EFFORTS_KEY) : {}
    const chosen = models[role] || models[ALL] || undefined
    const effort = efforts[role] || efforts[ALL] || undefined
    const started = await next(chosen ? { ...e, model: chosen } : e)
    if (started.deny !== undefined || started.agentId === undefined) return started

    const id = started.agentId
    if (e.resume !== undefined) {
      await update($, runs, list =>
        list.map(one => (one.id === id ? { ...one, status: 'trabajando' } : one)),
      )
    } else {
      const run: AgentRun = {
        id,
        role,
        task: e.description,
        status: 'trabajando',
        tools: 0,
        model: chosen ?? started.model,
        effort,
        startedAt: Date.now(),
      }
      await update($, runs, list => [...list, run].slice(-50))
    }
    void $.ui.open({ id: PANE, title: TITLE })

    return started
  })

  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      const run = (await read($, runs)).find(one => one.id === agentId)
      if (run?.isHalted) return { deny: HALT }
      await update($, runs, list =>
        list.map(one =>
          one.id === agentId ? { ...one, tools: one.tools + 1, lastTool: e.tool } : one,
        ),
      )
    }

    return next(e)
  })

  // The Coordinador's order, once the person sends it in the main session.
  on('prompt.submit', async ($, e, next) => {
    if (e.text.includes(FROM_PANEL)) {
      await update($, requests, list =>
        list.map((one, at) => (at === list.length - 1 && e.text.includes(one.goal) ? { ...one, isSent: true as const } : one)),
      )
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    // A model that takes no effort has none here, and is sent none.
    if (agentId === undefined || e.effort === undefined) return yield* next(e)
    const run = (await read($, runs)).find(one => one.id === agentId)
    const effort = run?.effort as TurnStepInput['effort']
    return yield* next(effort ? { ...e, effort } : e)
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      const status: RunStatus =
        e.reason === 'answer' ? 'entregado' : e.reason === 'aborted' ? 'interrumpido' : 'fallo'
      await update($, runs, list =>
        list.map(one =>
          one.id === agentId
            ? {
                ...one,
                status: one.isHalted ? 'interrumpido' : status,
                durationMs: (one.durationMs ?? 0) + e.durationMs,
                report: e.answer || one.report,
              }
            : one,
        ),
      )
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = elements
    // The mobile app draws no picker or field yet: there a button walks the
    // models, and the chat is read only. The terminal draws no pictures:
    // there each icon is a glyph.
    const Select = 'Select' in elements && e.surface !== 'mobile' ? elements.Select : undefined
    const Input = 'Input' in elements && e.surface !== 'mobile' ? elements.Input : undefined
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const width = Math.max(20, e.props.bodyColumns)
    const showing = await read($, view)

    const icon = (name: string, size = 22) =>
      Svg ? (
        <Svg source={svg(ICONS[name] ?? '', size)} alt={name} width={size} height={size} />
      ) : (
        <Text>{GLYPHS[name] ?? '•'}</Text>
      )
    // The design's dark fills; the terminal keeps its own background.
    const fill = (color: string) => (e.surface === 'terminal' ? undefined : color)
    const tile = (name: string, size = 22) => (
      <Box
        backgroundColor={fill(TONE.tile)}
        borderStyle={e.surface === 'terminal' ? 'round' : undefined}
        borderColor="inactive"
        paddingX={1}
        alignSelf="flex-start"
        flexShrink={0}
      >
        {icon(name, size)}
      </Box>
    )
    const badge = (count: number) => (
      <Box backgroundColor={fill(TONE.badge)} paddingX={1} flexShrink={0}>
        <Text size="caption">{count}</Text>
      </Box>
    )

    if (showing !== '') {
      const isGroup = showing === GROUP
      const all = (await read($, chat)).filter(one => one.channel === showing)
      const said = all.filter(one => one.from === ME).length
      const lines = all.filter(one => !one.isPending)
      const typing = all.filter(one => one.isPending).map(one => labelOf(one.from))
      const isEarlier = await read($, earlier)
      const shownLines = isEarlier ? lines : lines.slice(-SHOWN)
      const hidden = lines.length - shownLines.length
      const room = isGroup
        ? 'Escribe al Coordinador, o nombra a un agente con @ (@po, @qa, @dev…)'
        : `Escribe a ${labelOf(showing)}`
      const back = (key: string) => (
        <Button
          key={key}
          plain
          onPress={async () => {
            await update($, view, () => '')
            await update($, earlier, () => false)
          }}
        >
          <Text dimColor>← Equipo</Text>
        </Button>
      )
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" gap={1}>
            <Box flexDirection="row" gap={1} alignItems="center">
              {back('volver')}
              {tile(isGroup ? 'grupo' : showing, 16)}
              <Text bold>{isGroup ? 'Chat de grupo' : labelOf(showing)}</Text>
            </Box>
            {lines.length > 0 && (
              <Button
                key="vaciar"
                plain
                onPress={() => update($, chat, list => list.filter(one => one.channel !== showing || one.isPending))}
              >
                <Text dimColor>Vaciar</Text>
              </Button>
            )}
          </Box>
          {hidden > 0 && (
            <Button key="anteriores" plain onPress={() => update($, earlier, () => true)}>
              <Text color={TONE.accent}>Ver {hidden} mensajes anteriores</Text>
            </Button>
          )}
          {lines.length === 0 && typing.length === 0 && (
            <Text dimColor>
              {isGroup
                ? 'Escribe al Coordinador: pregúntale «¿cómo va…?» o pídele una función nueva. Para hablar con un agente, nómbralo con @.'
                : `Escribe a ${labelOf(showing)} para empezar.`}
            </Text>
          )}
          {shownLines.map(one => {
            const isMine = one.from === ME
            if (one.isNote) {
              return (
                <Text key={`mensaje-${one.id}`} dimColor italic>
                  {one.text}
                </Text>
              )
            }
            return (
              <Box
                key={`mensaje-${one.id}`}
                flexDirection="column"
                alignSelf={isMine ? 'flex-end' : 'flex-start'}
                width={isMine ? undefined : '100%'}
                backgroundColor={fill(isMine ? TONE.tabOn : TONE.card)}
                borderStyle="round"
                borderColor={isMine ? TONE.accent : TONE.border}
                paddingX={1}
              >
                {!isMine && (
                  <Box flexDirection="row" gap={1} alignItems="center">
                    <Text bold color="claude" size="caption">
                      {labelOf(one.from)}
                    </Text>
                  </Box>
                )}
                <Markdown text={one.text} />
              </Box>
            )
          })}
          {typing.length > 0 && (
            <Text dimColor>
              {typing.join(', ')} {typing.length === 1 ? 'está' : 'están'} escribiendo…
            </Text>
          )}
          {Input ? (
            // The field takes the pane's whole width, two lines tall, with room
            // below so its focus ring is not cut off. Its key moves on with each
            // message the person sends, so it starts empty, and stays put while
            // answers arrive, so what they are typing is kept.
            <Box key="caja" flexDirection="column" width="100%" paddingY={1} gap={1}>
              <Input
                key={`entrada-${showing}-${said}`}
                placeholder={room}
                value=""
                rows={2}
                submitLabel="enviar"
                autoFocus
                onSubmit={text => send($, showing, text)}
              />
              <Box flexDirection="row" justifyContent="space-between" alignItems="center">
                {back('volver-abajo')}
                <Text dimColor size="caption">
                  Enter envía
                </Text>
              </Box>
            </Box>
          ) : (
            <Box flexDirection="column" gap={1}>
              <Text dimColor>Para escribir, abre el panel en el escritorio o la terminal.</Text>
              {back('volver-abajo')}
            </Box>
          )}
        </Box>
      )
    }

    const list = await read($, runs)
    const open = await read($, expanded)
    const whole = await read($, full)
    const tab = await read($, filter)
    const menuOf = await read($, menu)
    const isAll = await read($, showAll)
    const models = await read($, modelsShown)
    const teamModel = models[ALL] ?? ''
    const efforts = await read($, effortsShown)
    const teamEffort = efforts[ALL] ?? ''
    const onPause = await read($, paused)
    const isTeamPaused = onPause.includes(ALL)

    const stateOf = (role: string) => {
      const mine = list.filter(one => one.role === role)
      return { mine, last: mine[mine.length - 1] }
    }
    const counts = {
      'en-curso': TEAM.filter(m => stateOf(m.role).last?.status === 'trabajando').length,
      completados: TEAM.filter(m => {
        const status = stateOf(m.role).last?.status
        return status !== undefined && status !== 'trabajando'
      }).length,
      disponibles: TEAM.filter(m => stateOf(m.role).last === undefined).length,
    }
    // Working first, then finished, then free, as the team's order has them.
    const rank = (role: string) => {
      const status = stateOf(role).last?.status
      return status === 'trabajando' ? 0 : status !== undefined ? 1 : 2
    }
    const shown = TEAM.filter(m => {
      const status = stateOf(m.role).last?.status
      if (tab === 'en-curso') return status === 'trabajando'
      if (tab === 'completados') return status !== undefined && status !== 'trabajando'
      if (tab === 'disponibles') return status === undefined
      return true
    }).sort((x, y) => rank(x.role) - rank(y.role))

    // Two cards a row only where each still fits its name.
    const perRow = width >= 64 ? 2 : 1
    const cardWidth = Math.floor((width - (perRow - 1)) / perRow)

    const picker = (key: string, value: string, options: { value: string; label: string }[], label: string, pick: (value: string) => unknown) =>
      Select ? (
        <Select key={key} label={label} options={options} value={value} onSelect={v => pick(v)} />
      ) : (
        <Button
          key={key}
          plain
          onPress={async () => {
            const at = options.findIndex(one => one.value === value)
            await pick(options[(at + 1) % options.length]?.value ?? '')
          }}
        >
          {label}: {options.find(one => one.value === value)?.label ?? value} <Text dimColor>▸</Text>
        </Button>
      )

    const cards = shown.map(member => {
      const { mine, last } = stateOf(member.role)
      const status = last?.status
      const isWorking = status === 'trabajando'
      const isHalted = isWorking && mine.some(one => one.status === 'trabajando' && one.isHalted)
      const isOnPause = isPaused(onPause, member.role)
      const pill = isHalted
        ? { icon: '●', text: 'Parando…', color: 'warning' as const }
        : isOnPause && !isWorking
          ? PAUSED_PILL
          : PILL[status ?? 'libre']
      const own = models[member.role] ?? ''
      const ownEffort = efforts[member.role] ?? ''
      const took = !isWorking && last?.durationMs !== undefined ? duration(last.durationMs) : ''
      const doing = isWorking && last && !isHalted ? `${last.task}${last.lastTool ? ` · ${last.lastTool}` : ''}` : ''
      return (
        <Box
          key={`tarjeta-${member.role}`}
          flexDirection="column"
          gap={1}
          width={cardWidth}
          borderStyle="round"
          borderColor={isWorking ? TONE.workingBorder : TONE.border}
          backgroundColor={fill(isWorking ? TONE.workingCard : TONE.card)}
          hover={{ borderColor: isWorking ? 'warning' : TONE.hover }}
          paddingX={1}
          paddingY={1}
        >
          <Box flexDirection="row" gap={1} alignItems="center">
            {tile(member.role, 16)}
            <Box flexShrink={1} minWidth={0}>
              <Text bold wrap="truncate-end">
                {member.label}
                {mine.length > 1 ? ` ×${mine.length}` : ''}
              </Text>
            </Box>
          </Box>
          <Box flexDirection="row" justifyContent="space-between" gap={1} paddingLeft={5}>
            <Text color={pill.color === 'inactive' ? undefined : pill.color} dimColor={pill.color === 'inactive'} wrap="truncate-end">
              <Text color={pill.color}>{pill.icon === '○' ? '●' : pill.icon}</Text> {pill.text}
            </Text>
            {took !== '' && <Text dimColor>{took}</Text>}
          </Box>
          {doing !== '' && (
            <Box paddingLeft={5}>
              <Text dimColor size="caption" wrap="truncate-end">
                {doing}
              </Text>
            </Box>
          )}
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" gap={1}>
            <Button key={`chat-${member.role}`} plain onPress={() => openChat($, member.role)}>
              <Text dimColor>Abrir chat ↗</Text>
            </Button>
            <Box flexDirection="row" gap={1}>
              {isWorking && !isHalted && (
                <Button key={`parar-${member.role}`} plain onPress={() => halt($, member.role)}>
                  <Text color="error">■ Parar</Text>
                </Button>
              )}
              <Button
                key={`menu-${member.role}`}
                plain
                onPress={() => update($, menu, now => (now === member.role ? null : member.role))}
              >
                <Text dimColor>⋯</Text>
              </Button>
            </Box>
          </Box>
          {menuOf === member.role && (
            <Box flexDirection="column" gap={1}>
              {picker(`modelo-${member.role}`, own, AGENT_MODELS, 'Modelo', value => setModel($, member.role, value))}
              {picker(`esfuerzo-${member.role}`, ownEffort, AGENT_EFFORTS, 'Esfuerzo', value => setEffort($, member.role, value))}
              {!isTeamPaused && (
                <Button key={`pausa-${member.role}`} plain onPress={() => togglePause($, member.role)}>
                  {onPause.includes(member.role) ? '▶ Reanudar' : '⏸ Pausar'}
                </Button>
              )}
            </Box>
          )}
        </Box>
      )
    })

    // The Coordinador: the main session, and the last function handed to it.
    const asked = (await read($, requests)).at(-1)
    const coordinator = (
      <Box
        key="tarjeta-coordinador"
        flexDirection="column"
        gap={1}
        borderStyle="round"
        borderColor={TONE.border}
        backgroundColor={fill(TONE.card)}
        hover={{ borderColor: TONE.hover }}
        paddingX={1}
        paddingY={1}
      >
        <Box flexDirection="row" gap={1} alignItems="center">
          {tile(COORD, 16)}
          <Text bold>Coordinador</Text>
          <Text dimColor size="caption">
            sesión principal
          </Text>
        </Box>
        <Box paddingLeft={5}>
          <Text dimColor size="caption" wrap="truncate-end">
            {asked
              ? `Última función: «${asked.goal}»${asked.isSent ? '' : ' · orden aún no enviada'}`
              : 'Recibe los mensajes del grupo que no nombran a nadie.'}
          </Text>
        </Box>
        <Button key="chat-coordinador" plain onPress={() => openChat($, GROUP)}>
          <Text dimColor>Hablar con el Coordinador ↗</Text>
        </Button>
      </Box>
    )

    const delivered = list.filter(one => one.status !== 'trabajando').reverse()
    const recent = isAll ? delivered : delivered.slice(0, 3)

    const tabs: { id: TeamFilter; label: string; count: number }[] = [
      { id: 'todos', label: 'Todos', count: TEAM.length },
      { id: 'en-curso', label: 'En curso', count: counts['en-curso'] },
      { id: 'completados', label: 'Completados', count: counts.completados },
      { id: 'disponibles', label: 'Disponibles', count: counts.disponibles },
    ]

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" gap={1}>
          <Box flexDirection="row" gap={1} alignItems="center">
            {icon('grupo', 18)}
            <Text bold size="title">
              Agentes
            </Text>
            {badge(TEAM.length)}
          </Box>
          <Button key="chat-grupo" variant="primary" onPress={() => openChat($, GROUP)}>
            Chat de grupo
          </Button>
        </Box>

        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" gap={1}>
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={2}>
            {picker('modelo-todos', teamModel, MODELS, 'Modelo del equipo', value => setModel($, ALL, value))}
            {picker('esfuerzo-todos', teamEffort, EFFORTS, 'Esfuerzo', value => setEffort($, ALL, value))}
          </Box>
          <Box flexDirection="row" gap={1}>
            {counts['en-curso'] > 0 && (
              <Button key="parar-todos" plain onPress={() => halt($)}>
                <Text color="error">■ Parar todos</Text>
              </Button>
            )}
            <Button key="pausa-todos" plain onPress={() => togglePause($, ALL)}>
              <Text dimColor={!isTeamPaused} color={isTeamPaused ? 'warning' : undefined}>
                {isTeamPaused ? '▶ Reanudar equipo' : '⏸ Pausar equipo'}
              </Text>
            </Button>
          </Box>
        </Box>
        {isTeamPaused && (
          <Text color="warning">⏸ El equipo está en pausa: Claude no puede lanzar agentes hasta que lo reanudes.</Text>
        )}

        {coordinator}

        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {tabs.map(one => {
              const isOn = tab === one.id
              return (
                <Box key={`pestana-caja-${one.id}`} backgroundColor={isOn ? fill(TONE.tabOn) : undefined} paddingX={1}>
                  <Button key={`pestana-${one.id}`} plain onPress={() => update($, filter, () => one.id)}>
                    <Text color={isOn ? TONE.accent : undefined} dimColor={!isOn} underline={isOn && e.surface === 'terminal'}>
                      {one.label}
                    </Text>{' '}
                    <Text color={isOn ? TONE.accent : undefined} dimColor={!isOn}>
                      {one.count}
                    </Text>
                  </Button>
                </Box>
              )
            })}
          </Box>
          <Text color={TONE.border}>{'─'.repeat(Math.max(10, width))}</Text>
        </Box>

        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {cards.length > 0 ? cards : <Text dimColor>Ningún agente en esta pestaña.</Text>}
        </Box>

        <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginTop={1}>
          <Box flexDirection="row" gap={1} alignItems="center">
            {icon('entregas', 16)}
            <Text bold>Entregas recientes</Text>
            {badge(delivered.length)}
          </Box>
          <Box flexDirection="row" gap={2}>
            {delivered.length > 3 && (
              <Button key="ver-todas" plain onPress={() => update($, showAll, now => !now)}>
                <Text color={TONE.accent}>{isAll ? 'Ver menos' : 'Ver todas'}</Text>
              </Button>
            )}
            {list.length > 0 && (
              <Button
                key="limpiar"
                plain
                onPress={async () => {
                  await update($, runs, () => [])
                  await update($, expanded, () => null)
                  await update($, full, () => null)
                }}
              >
                <Text dimColor>Limpiar</Text>
              </Button>
            )}
          </Box>
        </Box>
        {delivered.length === 0 && <Text dimColor>Ningún agente ha entregado todavía.</Text>}
        {recent.map(run => {
          const isOpen = open === run.id
          const done = PILL[run.status]
          const byline = [labelOf(run.role), duration(run.durationMs)].filter(Boolean).join(' · ')
          const facts = [
            run.model ? `Modelo: ${modelLabel(run.model)}` : '',
            run.effort ? `Esfuerzo: ${effortLabel(run.effort)}` : '',
            `${run.tools} herramientas`,
          ].filter(Boolean)
          return (
            <Box
              key={`entrega-${run.id}`}
              flexDirection="column"
              borderStyle="round"
              borderColor={TONE.border}
              backgroundColor={fill(TONE.card)}
              hover={{ borderColor: TONE.hover }}
            >
              <Box flexDirection="row" gap={1} alignItems="center" paddingX={1} paddingY={1}>
                <Box backgroundColor={fill(run.status === 'entregado' ? TONE.doneTile : TONE.tile)} paddingX={1} flexShrink={0}>
                  <Text color={done.color}>{done.icon}</Text>
                </Box>
                <Box flexDirection="column" flexShrink={1} minWidth={0}>
                  <Text bold wrap="truncate-end">
                    {titleOf(run)}
                  </Text>
                  <Text dimColor size="caption" wrap="truncate-end">
                    {byline}
                  </Text>
                </Box>
                <Button
                  key={run.id}
                  plain
                  onPress={() => update($, expanded, now => (now === run.id ? null : run.id))}
                >
                  <Text dimColor>{isOpen ? '⌃' : '⌄'}</Text>
                </Button>
              </Box>
              {isOpen && (
                <Box flexDirection="column">
                  <Text color={TONE.border}>{'─'.repeat(Math.max(10, width - 2))}</Text>
                  <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" gap={1} paddingX={1} paddingY={1}>
                    <Box flexDirection="row" flexWrap="wrap" gap={3}>
                      {facts.map(fact => (
                        <Text key={`dato-${run.id}-${fact}`} dimColor size="caption">
                          {fact}
                        </Text>
                      ))}
                    </Box>
                    <Button
                      key={`completo-${run.id}`}
                      plain
                      onPress={() => update($, full, now => (now === run.id ? null : run.id))}
                    >
                      <Text color={TONE.accent}>{whole === run.id ? 'Ocultar conversación ⌃' : 'Ver conversación ↗'}</Text>
                    </Button>
                  </Box>
                  {whole === run.id && (
                    <Box paddingX={1} paddingBottom={1}>
                      <Markdown text={run.report || '_Sin informe._'} />
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
