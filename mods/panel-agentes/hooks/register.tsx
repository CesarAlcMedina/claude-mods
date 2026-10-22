import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, TurnStepInput } from 'claude-code'

import type { AgentRun, ChatMessage, RunStatus, SessionTeam, TeamFilter } from '../types'

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
const notice = atom({ plugin: 'panel-agentes', key: 'notice' } as const, null)
const crewAtom = atom({ plugin: 'panel-agentes', key: 'team' } as const, { roles: [], leaving: [], joined: {}, isChosen: false })
const setup = atom({ plugin: 'panel-agentes', key: 'setup' } as const, null)
const offer = atom({ plugin: 'panel-agentes', key: 'offer' } as const, null)
const planUsage = atom({ plugin: 'panel-agentes', key: 'usage' } as const, null)
const tick = atom({ plugin: 'panel-agentes', key: 'tick' } as const, 0)

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

// The team a session works with. Until the person chooses one, every role
// takes part, as before; once chosen, only those roles are consulted in the
// chats and launched for new work from this session. It lives in the
// session's state, so each session has its own. A role taken off keeps its
// runs, chats and reports, and one taken off while working finishes what it
// has.
const ROLES = TEAM.map(one => one.role)
const NO_TEAM: SessionTeam = { roles: ROLES, leaving: [], joined: {}, isChosen: false }

const teamOf = async ($: EngineInterface): Promise<SessionTeam> => {
  const team = await read($, crewAtom)
  return team.isChosen ? team : { ...NO_TEAM, told: team.told }
}

const setTeam = async ($: EngineInterface, change: (team: SessionTeam) => SessionTeam) =>
  update($, crewAtom, team => change(team.isChosen ? team : NO_TEAM))

const names = (roles: string[]) => {
  const labels = roles.map(labelOf)
  return labels.length < 2 ? (labels[0] ?? 'nadie') : `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`
}

const isBusy = (list: AgentRun[], role: string) => list.some(one => one.role === role && one.status === 'trabajando')

// In the team order, whatever order they were picked in.
const ordered = (roles: string[]) => ROLES.filter(role => roles.includes(role))

const isOut = (team: SessionTeam, role: string) => team.isChosen && ROLES.includes(role) && !team.roles.includes(role)

// The team as the agents and the Coordinador are told it.
const teamLine = (team: SessionTeam) =>
  team.isChosen
    ? `Equipo activo de esta sesión, elegido por el usuario: ${team.roles.length > 0 ? names(team.roles) : 'ninguno'}. Solo cuentas con ellos.`
    : ''

const note = (channel: string, text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  channel,
  from: NOTE,
  text,
  isNote: true as const,
})

const noteGroup = ($: EngineInterface, text: string) => update($, chat, all => [...all, note(GROUP, text)])

// Choosing the team. Roles brought in later are marked, so their first
// answers come with what the session already holds; roles taken off while
// working stay until they finish.
const applyTeam = async ($: EngineInterface, draft: string[], leave: string[]) => {
  const before = await teamOf($)
  const roles = ordered(draft)
  const added = before.isChosen ? roles.filter(role => !before.roles.includes(role)) : []
  const removed = before.roles.filter(role => !roles.includes(role))
  const at = Date.now()
  await setTeam($, team => ({
    ...team,
    roles,
    leaving: ordered([...team.leaving, ...leave].filter(role => !roles.includes(role))),
    joined: { ...team.joined, ...Object.fromEntries(added.map(role => [role, at])) },
    isChosen: true,
  }))
  if (!before.isChosen) {
    await noteGroup($, roles.length > 0 ? `Equipo de esta sesión: ${names(roles)}.` : 'El equipo de esta sesión está vacío.')
  } else {
    if (added.length > 0) await noteGroup($, `${names(added)} ${added.length === 1 ? 'se incorporó' : 'se incorporaron'} al equipo.`)
    const gone = removed.filter(role => !leave.includes(role))
    const going = removed.filter(role => leave.includes(role))
    if (gone.length > 0) await noteGroup($, `${names(gone)} ${gone.length === 1 ? 'salió' : 'salieron'} del equipo.`)
    if (going.length > 0) await noteGroup($, `${names(going)} ${going.length === 1 ? 'sale' : 'salen'} del equipo al terminar su tarea.`)
  }
  await update($, offer, now => (now && now.roles.every(role => roles.includes(role)) ? null : now))
}

const bringIn = async ($: EngineInterface, roles: string[]) => {
  const team = await teamOf($)
  await applyTeam($, [...team.roles, ...roles], team.leaving.filter(role => !roles.includes(role)))
}

// Confirming «Configurar equipo»: roles taken off while working are asked
// about first, to keep them or let them go once they finish. No task is cut.
const confirmTeam = async ($: EngineInterface) => {
  const now = await read($, setup)
  if (now === null) return
  const team = await teamOf($)
  const list = await read($, runs)
  const busy = team.roles.filter(role => !now.draft.includes(role) && isBusy(list, role))
  if (busy.length > 0) {
    await update($, setup, () => ({ ...now, busy }))
    return
  }
  await applyTeam($, now.draft, [])
  await update($, setup, () => null)
}

const settleBusy = async ($: EngineInterface, keep: boolean) => {
  const now = await read($, setup)
  if (now === null) return
  const busy = now.busy ?? []
  await applyTeam($, keep ? [...now.draft, ...busy] : now.draft, keep ? [] : busy)
  await update($, setup, () => null)
}

// Roles out of the team never get a message on their own: the person is
// offered to bring them in first, and they get it once in.
const propose = ($: EngineInterface, channel: string, roles: string[], messageId?: string) =>
  update($, offer, () => ({ channel, roles, messageId }))

const accept = async ($: EngineInterface) => {
  const now = await read($, offer)
  if (now === null) return
  await update($, offer, () => null)
  await bringIn($, now.roles)
  if (now.messageId === undefined) return
  const message = (await read($, chat)).find(one => one.id === now.messageId)
  if (message === undefined) return
  const turns = now.roles.map(role => ({ role, mustAnswer: true }))
  await ask($, now.channel, turns, message, message.from === ME ? 0 : 1, { left: RELAYS })
}

const decline = async ($: EngineInterface) => {
  const now = await read($, offer)
  if (now === null) return
  await update($, offer, () => null)
  const one = now.roles.length === 1
  const text = `${names(now.roles)} ${one ? 'sigue' : 'siguen'} fuera del equipo${now.messageId ? `: no ${one ? 'le' : 'les'} llegó el mensaje` : ''}.`
  await update($, chat, all => [...all, note(now.channel, text)])
}

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
// a new agent of it is refused until the person resumes it. Nor can the panel
// hold an agent and let it go on: a paused one ends saying where it left
// off, and resuming hands that work back to the main session, which goes on
// with it as the person's own request once they send the order.
const HALT = 'El usuario paró a este agente desde el panel de agentes. No sigas trabajando: termina ya con un resumen breve de lo que hiciste y lo que falta.'
const PAUSE = 'El usuario puso en pausa a este agente desde el panel de agentes. Detente ya: termina con un resumen breve de lo que hiciste, lo que falta y dónde lo dejaste, para poder seguir después desde ahí.'

const isPaused = (list: string[], role: string) => list.includes(ALL) || list.includes(role)

const halt = ($: EngineInterface, role?: string, isPause = false) =>
  update($, runs, list =>
    list.map(one =>
      one.status === 'trabajando' && (role === undefined || one.role === role)
        ? { ...one, isHalted: true as const, ...(isPause ? { isPaused: true as const } : {}) }
        : one,
    ),
  )

// Work a pause cut short and not yet handed back: the role's, or all of it.
const cutShort = (list: AgentRun[], role: string) =>
  list.filter(
    one => one.isPaused && !one.isResumed && one.status !== 'trabajando' && (role === ALL || one.role === role),
  )

// Resuming: the work the pause cut short goes back to the main session. The
// order waits in the prompt box for the person's Enter.
const resume = async ($: EngineInterface, role: string) => {
  const left = cutShort(await read($, runs), role)
  if (left.length === 0) return
  const each = left
    .map(run => {
      const where = run.report ? ` Dónde lo dejó: ${summaryOf(run.report)}` : ''
      return `- ${labelOf(run.role)} (agente ${run.id}), tarea «${run.task}».${where}`
    })
    .join('\n')
  const order = `Reanuda el trabajo que quedó en pausa desde el panel de agentes. Sigue con cada agente donde lo dejó, sin empezar de cero: continúa el mismo agente si puedes y, si no, lánzalo otra vez con su tarea y lo que ya hizo.\n${each}`
  const filled = await $.prompt.fill({ text: order }).catch(() => ({ isFilled: false }))
  const ids = left.map(one => one.id)
  await update($, runs, list => list.map(one => (ids.includes(one.id) ? { ...one, isResumed: true as const } : one)))
  const who = left.map(one => labelOf(one.role)).filter((one, at, all) => all.indexOf(one) === at).join(', ')
  await update($, notice, () =>
    filled.isFilled
      ? `Para que ${who} siga donde lo dejó, te dejé la orden en la caja del chat principal: envíala con Enter.`
      : `Para que ${who} siga donde lo dejó, envía esto en el chat principal:\n\n${order}`,
  )
}

const togglePause = async ($: EngineInterface, role: string) => {
  const now = await read($, paused)
  const isOn = now.includes(role)
  await update($, paused, list => (isOn ? list.filter(one => one !== role) : [...list, role]))
  if (!isOn) await halt($, role === ALL ? undefined : role, true)
  else await resume($, role)
}

// The plan's five-hour limit, as the API last reported it to the session.
// The engine pushes it with each measurement (after a main-thread turn, or
// when the window moves a point); a timer keeps the countdown going and
// rereads the free usage figures, never the model. A reading keeps when it
// was seen: an old one says so, and one whose reset time has passed waits
// for new data rather than claiming the window is back at zero.
const FIVE_HOUR = 'five_hour'
const TICK_MS = 30_000
const STALE_MS = 15 * 60_000

const nowOf = ($: EngineInterface) => $.clock.now().catch(() => Date.now())

const record = async ($: EngineInterface, limits: SessionRateLimit[], isFresh: boolean) => {
  const window = limits.find(one => one.kind === FIVE_HOUR)
  if (window === undefined) return
  const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : NaN
  const reading = {
    percent: window.percentUsed,
    resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined,
    seenAt: await nowOf($),
  }
  await update($, planUsage, last =>
    !isFresh && last !== null && last.percent === reading.percent && last.resetsAt === reading.resetsAt
      ? last
      : reading,
  )
}

// One timer per loaded copy of the module.
let ticking: { cancel: () => void } | undefined

const keepTicking = ($: EngineInterface) => {
  if (ticking !== undefined) return
  try {
    ticking = $.clock.every(TICK_MS, () => {
      void (async () => {
        const usage = await $.session.usage().catch(() => undefined)
        if (usage !== undefined) await record($, usage.rateLimits, false)
        await update($, tick, n => n + 1)
      })()
    })
  } catch {
    ticking = undefined
  }
}

const untilText = (ms: number) => {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes <= 1) return 'menos de 1 min'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours === 0 ? `${minutes} min` : `${hours} h${rest > 0 ? ` ${rest} min` : ''}`
}

const percentText = (value: number) => `${String(value).replace('.', ',')} %`

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
  const plain = paragraph
    .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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

const wordsOf = (text: string) => [...text.toLowerCase().matchAll(/@([\p{L}/-]+)/gu)].map(m => m[1] ?? '')

const rolesFor = (word: string) => TEAM.filter(one => word === one.role || one.aliases.includes(word)).map(one => one.role)

// The roles a group message names with @, or every role when it names none.
const addressed = (text: string) => {
  const words = wordsOf(text)
  const named = TEAM.filter(one =>
    words.some(word => word === one.role || one.aliases.includes(word)),
  ).map(one => one.role)
  return { roles: named.length > 0 ? named : TEAM.map(one => one.role), isNamed: named.length > 0 }
}

// The roles named that are out of the team. A name several roles share
// (@dev) reaches those in the team, and offers the others only when none is.
const absentOf = (text: string, team: SessionTeam) => {
  if (!team.isChosen) return []
  const out = wordsOf(text).flatMap(word => {
    const roles = rolesFor(word)
    return roles.some(role => team.roles.includes(role)) ? [] : roles
  })
  return ordered(out)
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
//
// Only the session's team is picked from. A specialty the message needs and
// the team lacks comes back as missing, for the Coordinador to propose; with
// no one to consult, the Coordinador answers alone.
type Pick = { kind: Kind; turns: Turn[]; missing: string[]; isAlone?: true }

const pick = async ($: EngineInterface, history: ChatMessage[], text: string, crew: SessionTeam): Promise<Pick> => {
  const members = TEAM.filter(one => crew.roles.includes(one.role))
  const absent = crew.isChosen ? TEAM.filter(one => !crew.roles.includes(one.role)) : []
  const team =
    members.length > 0
      ? members.map(one => `@${one.aliases[0]}: ${one.label}, ${one.job}`).join('\n')
      : 'Nadie: el usuario no eligió ningún agente para esta sesión.'
  const prompt = [
    'Clasificas los mensajes del chat de grupo de un equipo de agentes de software y decides a quién consulta el Coordinador. Cada consulta cuesta: elige por la aportación concreta que necesita el mensaje, no solo por la especialidad.',
    `El equipo:\n${team}`,
    absent.length > 0
      ? `Fuera del equipo de esta sesión, porque el usuario los dejó fuera (nunca los elijas): ${absent.map(one => `@${one.aliases[0]} (${one.label})`).join(', ')}. Si el mensaje necesita de verdad una de esas especialidades y nadie del equipo la cubre, añade al final una línea «FUERA: @alias»: el Coordinador propondrá incorporarla.`
      : '',
    titled('Chat hasta ahora (fíjate en lo que sigue pendiente: preguntas sin contestar, decisiones a medias):', history, PICK_CHARS),
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
  const outside = /^.*FUERA:(.*)$/im.exec(answer)?.[1] ?? ''
  const said = answer.replace(/^.*TIPO:.*$/im, '').replace(/^.*FUERA:.*$/im, '').trim()
  const named = turnsOf(said)
  const turns = named
    .filter(turn => crew.roles.includes(turn.role))
    .slice(0, PICKED)
    .map((turn, at) => ({ ...turn, mustAnswer: at === 0 }))
  const missing =
    kind === 'otro' ? ordered([...turnsOf(outside), ...named].map(turn => turn.role).filter(role => isOut(crew, role))) : []
  if (kind !== 'otro' || turns.length > 0 || missing.length > 0) return { kind, turns, missing }
  const isNobody = said.replace(/[\s.*_]/g, '').toUpperCase() === NOBODY
  if (isNobody && !isQuestion(text)) return { kind, turns: [], missing }
  const fallback = crew.roles.includes('product-owner') ? 'product-owner' : crew.roles[0]
  if (fallback === undefined) return { kind, turns: [], missing, isAlone: true }
  return {
    kind,
    turns: [{ role: fallback, aim: 'contestar al usuario o pedirle la aclaración que haga falta', mustAnswer: true }],
    missing,
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

// A chat under its heading, or nothing when it holds no lines yet.
const titled = (heading: string, messages: ChatMessage[], max = HISTORY_CHARS) => {
  const text = transcript(messages, max)
  return text === '' ? '' : `${heading}\n\n${text}`
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

// What a role brought in partway through gets to catch up: what the others
// delivered this session. The chats it reads give the rest.
const catchUpOf = (role: string, list: AgentRun[]) => {
  const done = list.filter(one => one.role !== role && one.status === 'entregado').slice(-6)
  return done.length === 0
    ? 'Todavía nadie del equipo ha entregado nada en esta sesión.'
    : done.map(run => `- ${labelOf(run.role)}, tarea «${run.task}»: ${summaryOf(run.report)}`).join('\n')
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
  /** The session's team: the only agents it may name. */
  members: string[]
  /** For a role brought in partway through: what the others delivered. */
  catchUp?: string
}

const chatPrompt = ({ role, channel, group, before, message, since, turn, canReach, work, isConsulted, members, catchUp }: Prompt) => {
  const isGroup = channel === GROUP
  const member = TEAM.find(one => one.role === role)
  const team = TEAM.filter(one => members.includes(one.role) || one.role === role)
    .map(one => `${one.label} (@${one.aliases[0]})`)
    .join(', ')
  const writer = message.from === ME ? 'del usuario' : `del agente ${labelOf(message.from)}`
  const reach = !canReach
    ? 'No nombres a otros agentes con @ en esta respuesta.'
    : isGroup
      ? 'Nombra con @ a otro agente solo para resolver una dependencia concreta: una pregunta que solo ese rol puede contestar y sin cuya respuesta no puedes seguir; hazla concreta. Nunca para pedir que confirme, para agradecer o de pasada. Si te escribe otro agente, contesta lo que te pide sin devolverle la pregunta.'
      : `Si el usuario te pide hablar con otro agente, o necesitas algo concreto de otro para seguir, añade al final una línea que empiece por «AL GRUPO:» con el mensaje para el chat de grupo, nombrando con @ a quien va dirigido. El equipo: ${team}. Ese agente te contestará en el chat de grupo.`
  const reachAll = canReach && members.length < ROLES.length ? `${reach} Solo puedes nombrar a agentes del equipo de esta sesión.` : reach
  const pass = turn.mustAnswer
    ? ''
    : message.from === ME
      ? `Si lo que ibas a aportar ya está dicho, o no tienes nada nuevo, responde solo con la palabra ${PASS}.`
      : `Si el mensaje ya no te pide nada (solo confirma, agradece o cierra el tema), o lo que ibas a decir ya está dicho, responde solo con la palabra ${PASS}: la conversación puede terminar ahí.`
  return [
    `A partir de aquí no eres el asistente principal: eres el agente ${labelOf(role)} del Agent Control Center, que se ocupa de ${member?.job ?? 'su rol'}.`,
    isConsulted
      ? `El Coordinador te consulta por un mensaje del usuario en el chat de grupo del panel de agentes, y le contestará con lo que reúna: dale solo tu aportación, sin dirigirte al usuario ni saludar. El equipo: ${team}.`
      : isGroup
        ? `Estás en el chat de grupo del panel de agentes, con el usuario y todo el equipo: ${team}.`
        : 'Estás en tu chat con el usuario en el panel de agentes.',
    `Lo que has hecho en esta sesión:\n${work}`,
    catchUp
      ? `Te incorporaste al equipo con la sesión ya empezada. Lo que entregaron los demás, para ponerte al día (el chat de abajo tiene lo hablado):\n${catchUp}`
      : '',
    VOICE,
    isGroup
      ? 'Aporta solo lo nuevo: una respuesta pendiente, una decisión, evidencia, un riesgo concreto, una pregunta necesaria o un avance verificado. Repetir o reformular lo que ya se dijo no cuenta. Ante una decisión del usuario, reconócela en una frase y añade solo lo que cambia o el siguiente paso; no rehagas entregables en el chat.'
      : '',
    TRUTH,
    reachAll,
    turn.aim ? `Lo que se espera de ti en este mensaje (una aportación de chat, no un entregable): ${turn.aim}.` : '',
    pass,
    titled('Lo último del chat de grupo, donde el usuario también decide cosas con el equipo:', group, GROUP_CHARS),
    titled('Chat hasta ahora:', before),
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
  const team = await teamOf($)
  const absent = channel === GROUP ? absentOf(said, team) : isOut(team, channel) ? [channel] : []
  if (absent.length > 0) await propose($, channel, absent, message.id)
  // Whoever the person names in the team must answer.
  const turns = named.roles.filter(role => !isOut(team, role)).map(role => ({ role, mustAnswer: true }))
  if (turns.length > 0) await ask($, channel, turns, message, 0, { left: RELAYS })
}

// The Coordinador's answer to a group message that names no one. Asking how
// the work goes only reads what the panel and the session hold; a new
// function is handed to the main session; anything else, it asks the agents
// it needs and answers with what they bring, once.
const coordinate = async ($: EngineInterface, channel: string, history: ChatMessage[], message: ChatMessage) => {
  const id = crypto.randomUUID()
  await update($, chat, all => [...all, { id, channel, from: COORD, text: '', isPending: true }])
  await follow($, channel)
  const team = await teamOf($)
  const picked = await pick($, history, message.text, team)
  const { kind, missing } = picked
  const text =
    kind === 'estado'
      ? await report($, history, message, team)
      : kind === 'funcion'
        ? await handOff($, message.text, team)
        : await gather($, history, message, picked, team)
  if (missing.length > 0) await propose($, channel, missing)
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

const report = async ($: EngineInterface, history: ChatMessage[], message: ChatMessage, team: SessionTeam) => {
  const known = await facts($)
  const prompt = [
    `${COORD_ROLE} Ahora el usuario pregunta cómo va el trabajo. Solo informas: no lanzas agentes, no retomas tareas y no prometes trabajo.`,
    teamLine(team),
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
    titled('Chat hasta ahora:', history),
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
//
// With a team chosen, the order names it: the flow runs with those agents
// only, and a specialty missing is proposed to the person, not launched.
const handOff = async ($: EngineInterface, goal: string, team: SessionTeam) => {
  if (team.isChosen && team.roles.length === 0) {
    return 'No hay ningún agente en el equipo de esta sesión, así que nadie puede trabajar en esto. Configura el equipo desde el panel y vuelve a pedírmelo.'
  }
  await update($, requests, list => [...list, { id: crypto.randomUUID(), goal, at: Date.now() }].slice(-10))
  const crew = team.isChosen
    ? ` Equipo activo de esta sesión: ${names(team.roles)}. Usa solo esos agentes; si hace falta otra especialidad, propónmela sin lanzarla.`
    : ''
  const order = `${SKILL} ${FROM_PANEL}: «${goal}».${crew} Sigue el recorrido «Nueva función» de la skill.`
  const filled = await $.prompt.fill({ text: order }).catch(() => ({ isFilled: false }))
  const start = team.isChosen
    ? `empiezo con el equipo de esta sesión (${names(team.roles)}), en el orden del flujo`
    : 'empiezo con Product Owner, análisis de negocio y QA, según haga falta, para tener historias, requisitos y criterios de aceptación. Después pasa a desarrollo y a pruebas'
  return filled.isFilled
    ? `Lo llevo al flujo del equipo. Te dejé la orden en la caja del chat principal: envíala con Enter y ${start}. Verás a cada agente en su tarjeta, y aquí puedes preguntarme «¿cómo va?».`
    : `Lo llevo al flujo del equipo, pero no pude dejar la orden en la caja del chat principal. Envíala tú allí:\n\n\`\`\`\n${order}\n\`\`\``
}

// Anything else: the agents picked answer the Coordinador in turn, each
// seeing what the one before said, and it answers the person once.
const gather = async (
  $: EngineInterface,
  history: ChatMessage[],
  message: ChatMessage,
  { turns, missing, isAlone }: Pick,
  team: SessionTeam,
) => {
  if (turns.length === 0 && missing.length === 0 && !isAlone) return null
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
      members: team.roles,
      catchUp: team.joined[turn.role] !== undefined ? catchUpOf(turn.role, list) : undefined,
    })
    const reply = await answerAs($, turn.role, prompt).catch(() => ({ isAnswered: false as const }))
    const text = reply.isAnswered ? reply.text.trim() : ''
    if (text !== '' && !isPass(text)) heard.push({ id: crypto.randomUUID(), channel: GROUP, from: turn.role, text })
  }
  const asked = turns.map(turn => labelOf(turn.role)).join(' y ')
  const prompt = [
    `${COORD_ROLE} Consultas solo a quien hace falta y contestas tú, con una sola respuesta.`,
    teamLine(team),
    turns.length === 0
      ? 'Por este mensaje no consultaste a ningún agente.'
      : heard.length > 0
        ? `Por este mensaje consultaste a ${asked}. Sus aportaciones:\n\n${transcript(heard)}`
        : `Por este mensaje consultaste a ${asked}, y nadie tenía nada nuevo que aportar.`,
    missing.length > 0
      ? `Para este mensaje haría falta ${names(missing)}, que no está en el equipo activo. No ${missing.length === 1 ? 'lo' : 'los'} consultes ni hables en su nombre: propón al usuario ${missing.length === 1 ? 'incorporarlo' : 'incorporarlos'}, en una frase; el panel le muestra debajo el botón para hacerlo.`
      : '',
    team.isChosen && team.roles.length === 0
      ? 'Como el equipo está vacío, dile también que puede elegir agentes con «Configurar equipo».'
      : '',
    [
      'Cómo respondes:',
      '- Reúne las aportaciones en una respuesta clara y natural, más corta que lo que te dieron: quédate con lo esencial, sin repetir ideas ni añadir lo que no dijeron, y ofrece el detalle si lo quiere. Nombra a un rol solo cuando ayude, por ejemplo para atribuir un riesgo o una decisión.',
      '- Si nadie aportó, contesta tú con lo que sabes, o pide la aclaración que falte.',
    ].join('\n'),
    VOICE,
    TRUTH,
    titled('Chat hasta ahora:', history),
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

  const list = await read($, runs)
  const team = await teamOf($)
  const work = workOf(role, list)
  const catchUp = team.joined[role] !== undefined ? catchUpOf(role, list) : undefined
  const prompt = chatPrompt({ role, channel, group, before, message, since, turn, canReach, work, members: team.roles, catchUp })
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
    await relay($, posted, hop, budget)
    return
  }
  if (channel === GROUP) await relay($, { id, channel, from: role, text }, hop, budget)
}

// What an agent says to others in the group reaches those in the team; one
// named out of it is offered to the person instead.
const relay = async ($: EngineInterface, posted: ChatMessage, hop: number, budget: { left: number }) => {
  const team = await teamOf($)
  const absent = absentOf(posted.text, team).filter(role => role !== posted.from)
  if (absent.length > 0) await propose($, GROUP, absent, posted.id)
  const targets = take(reached(posted.text, posted.from).filter(role => !isOut(team, role)), budget)
  if (targets.length > 0) await ask($, GROUP, targets, posted, hop + 1, budget)
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
    const usage = await $.session.usage().catch(() => undefined)
    if (usage !== undefined) await record($, usage.rateLimits, true)
    keepTicking($)

    return next(e)
  })

  on('command.run', { command: 'panel-agentes' }, async $ => {
    keepTicking($)
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
    // New work only for the session's team; an agent already at work goes on.
    if (isMember && e.resume === undefined) {
      const team = await teamOf($)
      if (isOut(team, role)) {
        return {
          deny: `${labelOf(role)} no está en el equipo de esta sesión, que el usuario eligió en el panel de agentes (${
            team.roles.length > 0 ? `equipo activo: ${names(team.roles)}` : 'ahora no hay ningún agente'
          }). No lo lances: si hace falta esa especialidad, propón al usuario incorporarla desde «Configurar equipo» en el panel.`,
        }
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
      // Going on with it: it is no longer stopped.
      await update($, runs, list =>
        list.map(one => {
          if (one.id !== id) return one
          const { isHalted: _halted, isPaused: _paused, isResumed: _resumed, ...rest } = one
          return { ...rest, status: 'trabajando' as const }
        }),
      )
      await update($, notice, () => null)
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
      if (cutShort(await read($, runs), role).length === 0) await update($, notice, () => null)
    }
    void $.ui.open({ id: PANE, title: TITLE })

    return started
  })

  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      const run = (await read($, runs)).find(one => one.id === agentId)
      if (run?.isHalted) return { deny: run.isPaused ? PAUSE : HALT }
      await update($, runs, list =>
        list.map(one =>
          one.id === agentId ? { ...one, tools: one.tools + 1, lastTool: e.tool } : one,
        ),
      )
    }

    return next(e)
  })

  // The Coordinador's order, once the person sends it in the main session.
  // The main session hears of the team when it changes, with the next prompt.
  on('prompt.submit', async ($, e, next) => {
    if (e.text.includes(FROM_PANEL)) {
      await update($, requests, list =>
        list.map((one, at) => (at === list.length - 1 && e.text.includes(one.goal) ? { ...one, isSent: true as const } : one)),
      )
    }
    const team = await teamOf($)
    const signature = `${team.roles.join(',')}|${team.leaving.join(',')}`
    if (!team.isChosen || team.told === signature) return next(e)
    const was = team.told?.split('|')[0]?.split(',').filter(Boolean)
    const newcomers = was === undefined ? [] : team.roles.filter(role => !was.includes(role))
    const line = [
      `Equipo activo de esta sesión, elegido por el usuario en el panel de agentes: ${team.roles.length > 0 ? names(team.roles) : 'ninguno'}.`,
      'Lanza solo a esos agentes del Agent Control Center. Si hace falta otra especialidad, propón al usuario incorporarla desde «Configurar equipo» en el panel; no la lances ni la actives tú.',
      newcomers.length > 0
        ? `${names(newcomers)} ${newcomers.length === 1 ? 'se acaba de incorporar' : 'se acaban de incorporar'}: al darle trabajo, pásale el contexto de lo que ya se hizo en la sesión.`
        : '',
      team.leaving.length > 0
        ? `${names(team.leaving)} ${team.leaving.length === 1 ? 'sale' : 'salen'} del equipo: termina lo que tiene y no le des trabajo nuevo.`
        : '',
    ]
      .filter(Boolean)
      .join(' ')
    await setTeam($, now => ({ ...now, told: signature }))
    return next({ ...e, context: [...(e.context ?? []), line] })
  })

  // Each measurement brings the limit as the last response reported it.
  on('session.measure', async ($, e, next) => {
    await record($, e.rateLimits, true)
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
      // One leaving the team goes once its work is done.
      const role = (await read($, runs)).find(one => one.id === agentId)?.role
      const team = await teamOf($)
      if (role !== undefined && team.leaving.includes(role) && !isBusy(await read($, runs), role)) {
        await setTeam($, now => ({ ...now, leaving: now.leaving.filter(one => one !== role) }))
        await noteGroup($, `${labelOf(role)} terminó su tarea y salió del equipo.`)
      }
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

    // «Límite de sesión · 5 h», at the top of the team and of each chat.
    await read($, tick)
    const reading = await read($, planUsage)
    const now = await nowOf($)
    const limitBar = () => {
      const cells = Math.max(10, width - 4)
      const isReset = reading?.resetsAt !== undefined && now >= reading.resetsAt
      const isStale = reading !== null && !isReset && now - reading.seenAt > STALE_MS
      const percent = reading === null || isReset ? undefined : reading.percent
      const filled = percent === undefined ? 0 : Math.min(cells, Math.round((Math.min(percent, 100) / 100) * cells) || (percent > 0 ? 1 : 0))
      const color = percent === undefined ? 'inactive' : percent >= 90 ? 'error' : percent >= 70 ? 'warning' : TONE.accent
      const caption =
        reading === null
          ? 'Uso no disponible'
          : isReset
            ? 'La ventana ya se restableció: esperando datos nuevos'
            : [
                reading.percent >= 100 ? 'Límite alcanzado' : '',
                reading.resetsAt !== undefined
                  ? `Se restablece en ${untilText(reading.resetsAt - now)}`
                  : 'Hora de restablecimiento no disponible',
                isStale ? `datos de hace ${untilText(now - reading.seenAt)}` : '',
              ]
                .filter(Boolean)
                .join(' · ')
      return (
        <Box
          key="limite-sesion"
          flexDirection="column"
          borderStyle="round"
          borderColor={TONE.border}
          backgroundColor={fill(TONE.card)}
          paddingX={1}
        >
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Text bold wrap="truncate-end">
              Límite de sesión · 5 h
            </Text>
            <Text bold color={percent !== undefined && percent >= 90 ? 'error' : undefined} dimColor={percent === undefined}>
              {percent === undefined ? '—' : percentText(percent)}
            </Text>
          </Box>
          <Text wrap="truncate-end">
            <Text color={color}>{'█'.repeat(filled)}</Text>
            <Text color={TONE.border}>{'░'.repeat(cells - filled)}</Text>
          </Text>
          <Text dimColor={!isStale || reading === null} color={isStale ? 'warning' : undefined} size="caption">
            {caption}
          </Text>
        </Box>
      )
    }

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
      const offered = await read($, offer)
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
          {limitBar()}
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
          {offered !== null && offered.channel === showing && (
            <Box key="oferta" flexDirection="column" gap={1} borderStyle="round" borderColor="warning" paddingX={1}>
              <Text>
                {names(offered.roles)} no {offered.roles.length === 1 ? 'está' : 'están'} en el equipo de esta sesión. ¿
                {offered.roles.length === 1 ? 'Lo' : 'Los'} incorporo
                {offered.messageId ? ` y ${offered.roles.length === 1 ? 'le' : 'les'} paso el mensaje` : ''}?
              </Text>
              <Box flexDirection="row" flexWrap="wrap" gap={2}>
                <Button key="incorporar" variant="primary" onPress={() => accept($)}>
                  Incorporar
                </Button>
                <Button key="no-incorporar" plain onPress={() => decline($)}>
                  <Text dimColor>Ahora no</Text>
                </Button>
              </Box>
            </Box>
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
    const team = await teamOf($)
    const choosing = await read($, setup)

    // «Configurar equipo»: a box per agent, kept apart from the team until
    // confirmed, so cancelling leaves the team as it was.
    if (choosing !== null) {
      const draft = choosing.draft
      const busy = choosing.busy ?? []
      const toggle = (role: string) =>
        update($, setup, now =>
          now === null
            ? now
            : { draft: now.draft.includes(role) ? now.draft.filter(one => one !== role) : [...now.draft, role] },
        )
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1} alignItems="center">
            {icon('grupo', 18)}
            <Text bold size="title">
              Configurar equipo
            </Text>
          </Box>
          <Text dimColor>
            Elige qué agentes participan en esta sesión. Los que dejes fuera conservan su historial, sus chats y sus entregas.
          </Text>
          {TEAM.map(member => {
            const isOn = draft.includes(member.role)
            const isWorking = isBusy(list, member.role)
            return (
              <Box
                key={`fila-${member.role}`}
                flexDirection="row"
                gap={1}
                alignItems="center"
                borderStyle="round"
                borderColor={isOn ? TONE.accent : TONE.border}
                backgroundColor={fill(isOn ? TONE.tabOn : TONE.card)}
                paddingX={1}
              >
                <Button key={`casilla-${member.role}`} plain onPress={() => toggle(member.role)}>
                  <Text color={isOn ? TONE.accent : undefined} dimColor={!isOn}>
                    {isOn ? '☑' : '☐'}
                  </Text>
                </Button>
                {tile(member.role, 16)}
                <Box flexDirection="column" flexShrink={1} minWidth={0}>
                  <Text bold wrap="truncate-end">
                    {member.label}
                    {isWorking ? <Text color="warning"> · trabajando</Text> : ''}
                  </Text>
                  <Text dimColor size="caption">
                    {member.job.charAt(0).toUpperCase() + member.job.slice(1)}
                  </Text>
                </Box>
              </Box>
            )
          })}
          <Text dimColor size="caption">
            {draft.length} de {TEAM.length} seleccionados
          </Text>
          {busy.length > 0 ? (
            <Box key="ocupados" flexDirection="column" gap={1} borderStyle="round" borderColor="warning" paddingX={1}>
              <Text>
                {names(busy)} {busy.length === 1 ? 'está' : 'están'} trabajando ahora y su tarea no se cancela. ¿
                {busy.length === 1 ? 'Lo' : 'Los'} mantengo en el equipo, o {busy.length === 1 ? 'sale' : 'salen'} cuando
                {busy.length === 1 ? ' termine' : ' terminen'}?
              </Text>
              <Box flexDirection="row" flexWrap="wrap" gap={2}>
                <Button key="mantener-ocupados" plain onPress={() => settleBusy($, true)}>
                  <Text color={TONE.accent}>Mantener en el equipo</Text>
                </Button>
                <Button key="retirar-al-terminar" plain onPress={() => settleBusy($, false)}>
                  <Text color={TONE.accent}>Retirar al terminar</Text>
                </Button>
                <Button key="cancelar-equipo" plain onPress={() => update($, setup, () => null)}>
                  <Text dimColor>Cancelar</Text>
                </Button>
              </Box>
            </Box>
          ) : (
            <Box flexDirection="row" gap={2} alignItems="center">
              <Button key="confirmar-equipo" variant="primary" onPress={() => confirmTeam($)}>
                Confirmar
              </Button>
              <Button key="cancelar-equipo" plain onPress={() => update($, setup, () => null)}>
                <Text dimColor>Cancelar</Text>
              </Button>
            </Box>
          )}
        </Box>
      )
    }
    const configure = async () => {
      const now = await teamOf($)
      await update($, setup, () => ({ draft: [...now.roles] }))
    }
    // The cards: the team, and those leaving it once they finish.
    const crew = TEAM.filter(m => team.roles.includes(m.role) || team.leaving.includes(m.role))
    const isEmpty = team.isChosen && crew.length === 0

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
    const told = await read($, notice)
    const isTeamPaused = onPause.includes(ALL)

    const stateOf = (role: string) => {
      const mine = list.filter(one => one.role === role)
      return { mine, last: mine[mine.length - 1] }
    }
    const counts = {
      'en-curso': crew.filter(m => stateOf(m.role).last?.status === 'trabajando').length,
      completados: crew.filter(m => {
        const status = stateOf(m.role).last?.status
        return status !== undefined && status !== 'trabajando'
      }).length,
      disponibles: crew.filter(m => stateOf(m.role).last === undefined).length,
    }
    // Working first, then finished, then free, as the team's order has them.
    const rank = (role: string) => {
      const status = stateOf(role).last?.status
      return status === 'trabajando' ? 0 : status !== undefined ? 1 : 2
    }
    const shown = crew.filter(m => {
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
      const isCutShort = !isWorking && last?.isPaused === true
      const pill = isHalted
        ? { icon: '●', text: last?.isPaused ? 'Pausando…' : 'Parando…', color: 'warning' as const }
        : isOnPause && !isWorking
          ? PAUSED_PILL
          : isCutShort
            ? { icon: '⏸', text: last?.isResumed ? 'Listo para seguir' : 'En pausa', color: 'warning' as const }
            : PILL[status ?? 'libre']
      const own = models[member.role] ?? ''
      const ownEffort = efforts[member.role] ?? ''
      const took = !isWorking && last?.durationMs !== undefined ? duration(last.durationMs) : ''
      const doing = isWorking && last && !isHalted ? `${last.task}${last.lastTool ? ` · ${last.lastTool}` : ''}` : ''
      const isLeaving = team.leaving.includes(member.role)
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
          {isLeaving && (
            <Box paddingLeft={5}>
              <Text color="warning" size="caption">
                Se retira al terminar
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
      { id: 'todos', label: 'Todos', count: crew.length },
      { id: 'en-curso', label: 'En curso', count: counts['en-curso'] },
      { id: 'completados', label: 'Completados', count: counts.completados },
      { id: 'disponibles', label: 'Disponibles', count: counts.disponibles },
    ]

    return (
      <Box flexDirection="column" gap={1}>
        {limitBar()}
        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" gap={1}>
          <Box flexDirection="row" gap={1} alignItems="center">
            {icon('grupo', 18)}
            <Text bold size="title">
              Agentes
            </Text>
            {badge(team.roles.length)}
          </Box>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Button key="configurar-equipo" plain onPress={configure}>
              <Text dimColor>⚙ Configurar equipo</Text>
            </Button>
            <Button key="chat-grupo" variant="primary" onPress={() => openChat($, GROUP)}>
              Chat de grupo
            </Button>
          </Box>
        </Box>
        <Text dimColor size="caption">
          {team.isChosen
            ? `Equipo de esta sesión: ${team.roles.length} de ${TEAM.length} agentes`
            : `Equipo de esta sesión: los ${TEAM.length} agentes (sin configurar)`}
        </Text>

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
        {told !== null && (
          <Box key="aviso" flexDirection="row" justifyContent="space-between" gap={1} borderStyle="round" borderColor="warning" paddingX={1}>
            <Box flexShrink={1}>
              <Markdown text={told} />
            </Box>
            <Button key="cerrar-aviso" plain onPress={() => update($, notice, () => null)}>
              <Text dimColor>✕</Text>
            </Button>
          </Box>
        )}

        {coordinator}

        {isEmpty ? (
          <Box key="equipo-vacio" flexDirection="column" gap={1} borderStyle="round" borderColor={TONE.border} paddingX={1} paddingY={1}>
            <Text>No hay agentes en el equipo de esta sesión.</Text>
            <Text dimColor>El Coordinador no podrá consultar a nadie, ni Claude lanzar agentes, hasta que elijas alguno.</Text>
            <Button key="configurar-equipo-vacio" variant="primary" onPress={configure}>
              Configurar equipo
            </Button>
          </Box>
        ) : (
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
          <Text color={TONE.border} wrap="truncate-end">
            {'─'.repeat(Math.max(10, width))}
          </Text>
        </Box>

        )}
        {!isEmpty && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
            {cards.length > 0 ? cards : <Text dimColor>Ningún agente en esta pestaña.</Text>}
          </Box>
        )}

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
                  <Text color={TONE.border} wrap="truncate-end">
                    {'─'.repeat(Math.max(10, width - 4))}
                  </Text>
                  <Box key={`resumen-${run.id}`} flexDirection="column" paddingX={1} paddingTop={1}>
                    <Text dimColor size="caption">
                      {run.isPaused || run.status === 'interrumpido' ? 'DÓNDE LO DEJÓ' : 'RESUMEN'}
                    </Text>
                    <Text>
                      {run.report
                        ? summaryOf(run.report)
                        : run.status === 'interrumpido'
                          ? 'No dejó informe: se paró antes de poder resumir lo que hizo.'
                          : 'No dejó informe.'}
                    </Text>
                  </Box>
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
