import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnStepInput } from 'claude-code'

import type { AgentRun, ChatMessage, RunStatus, TeamFilter } from '../types'

const PANE = 'panel-agentes'
const TITLE = 'Agentes'
const PREFIX = 'agent-control-center:'
const GROUP = 'grupo'
const ME = 'tu'

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

// The team in the order the coordinador skill hands work along, with the
// short names an @mention in the group chat may use.
const TEAM: { role: string; label: string; aliases: string[]; job: string }[] = [
  { role: 'product-owner', label: 'Product Owner', aliases: ['po'], job: 'objetivos, valor de negocio, épicas, historias de usuario y prioridades' },
  { role: 'business-analyst', label: 'Analista de negocio', aliases: ['ba', 'analista'], job: 'requisitos funcionales y no funcionales, reglas de negocio y criterios de aceptación' },
  { role: 'ux-ui-designer', label: 'Diseño UX/UI', aliases: ['ux', 'ui', 'diseño'], job: 'flujos, wireframes, estados de los componentes y accesibilidad' },
  { role: 'software-engineer', label: 'Ingeniería', aliases: ['dev', 'ingenieria', 'ingeniería'], job: 'diseño técnico, implementación y pruebas unitarias' },
  { role: 'code-reviewer', label: 'Revisión de código', aliases: ['reviewer', 'revision', 'revisión'], job: 'calidad, mantenibilidad, seguridad, rendimiento y errores lógicos del código' },
  { role: 'qa-engineer', label: 'QA', aliases: ['qa'], job: 'estrategia y planes de prueba, escenarios positivos, negativos y de borde, y defectos' },
  { role: 'devops-engineer', label: 'DevOps', aliases: ['devops'], job: 'CI/CD, Docker y automatización de builds y despliegues' },
  { role: 'research-agent', label: 'Investigación', aliases: ['research', 'investigacion', 'investigación'], job: 'investigar tecnologías, documentación y buenas prácticas, con fuentes' },
]

const roleOf = (subagentType: string) =>
  subagentType.startsWith(PREFIX) ? subagentType.slice(PREFIX.length) : subagentType

const labelOf = (role: string) =>
  role === ME ? 'Tú' : (TEAM.find(one => one.role === role)?.label ?? role)

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
  'software-engineer': '<path d="M9 18l-6-6 6-6M15 6l6 6-6 6"/>',
  'code-reviewer': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
  'qa-engineer': '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  'devops-engineer': '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8"/><path d="M12 13v8M9 16l3-3 3 3"/>',
  'research-agent': '<path d="M3 21h18M6 21v-6M11 21V9M16 21v-9M21 21V5"/>',
  grupo: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2.4.7 4 2.4 4 5.2"/>',
  entregas: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
}
const GLYPHS: Record<string, string> = {
  'product-owner': '👤',
  'business-analyst': '💼',
  'ux-ui-designer': '✏️',
  'software-engineer': '</>',
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
// fork yet, a plain completion answers. In the group chat a role with
// nothing to add answers PASS and is left out.
const PASS = 'PASO'
const HISTORY_CHARS = 8000

// The roles a group message names with @, or every role when it names none.
const addressed = (text: string) => {
  const words = [...text.toLowerCase().matchAll(/@([\p{L}/-]+)/gu)].map(m => m[1] ?? '')
  const named = TEAM.filter(one =>
    words.some(word => word === one.role || one.aliases.includes(word)),
  ).map(one => one.role)
  return { roles: named.length > 0 ? named : TEAM.map(one => one.role), isNamed: named.length > 0 }
}

const transcript = (messages: ChatMessage[]) => {
  const lines = messages
    .filter(one => !one.isPending)
    .map(one => `${labelOf(one.from)}: ${one.text}`)
  let text = lines.join('\n\n')
  while (text.length > HISTORY_CHARS && lines.length > 1) {
    lines.shift()
    text = lines.join('\n\n')
  }
  return text
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
// group that names others with @ is answered the same way. HOPS bounds how
// far one message of the person's can travel from agent to agent, and
// RELAYS how many answers between agents it can start in all.
const TO_GROUP = /^[\s*_]*al grupo[\s*_]*:[\s*_]*/i
const HOPS = 3
const RELAYS = 8

const chatPrompt = (
  role: string,
  channel: string,
  history: ChatMessage[],
  text: string,
  from: string,
  mustAnswer: boolean,
  canReach: boolean,
  work: string,
) => {
  const isGroup = channel === GROUP
  const member = TEAM.find(one => one.role === role)
  const team = TEAM.map(one => `${one.label} (@${one.aliases[0]})`).join(', ')
  const writer = from === ME ? 'del usuario' : `del agente ${labelOf(from)}`
  const reach = !canReach
    ? 'No nombres a otros agentes con @ en esta respuesta.'
    : isGroup
      ? 'Si necesitas que otro agente te conteste, nómbralo con @. Usa @ solo para eso, no para mencionar a alguien de pasada. Si te escribe otro agente, contéstale; no le devuelvas la pregunta salvo que de verdad necesites algo.'
      : `Si el usuario te pide hablar con otro agente, o necesitas algo de otro, añade al final una línea que empiece por «AL GRUPO:» con el mensaje para el chat de grupo, nombrando con @ a quien va dirigido. El equipo: ${team}. Ese agente te contestará en el chat de grupo.`
  return [
    `A partir de aquí no eres el asistente principal: eres el agente ${labelOf(role)} del Agent Control Center, que se ocupa de ${member?.job ?? 'su rol'}.`,
    isGroup
      ? `Estás en el chat de grupo del panel de agentes, con el usuario y todo el equipo: ${team}.`
      : 'Estás en tu chat con el usuario en el panel de agentes.',
    `Lo que has hecho en esta sesión:\n${work}`,
    // Answers in the pane read as chat lines: short, plain text, no report.
    isGroup
      ? 'Responde en español como en un chat de grupo: una o dos frases cortas, sin listas, títulos ni negritas, en primera persona y desde tu rol. No repitas lo que ya dijo otro agente.'
      : 'Responde en español como en un chat: de una a tres frases cortas, sin listas, títulos ni negritas, en primera persona y desde tu rol.',
    'Da más detalle solo si te lo piden. Usa lo que sabes de la conversación y del proyecto. En este chat no tienes herramientas: si hace falta hacer algo, dilo y sugiere pedírselo a Claude.',
    reach,
    isGroup && !mustAnswer
      ? `Si desde tu rol no tienes nada útil que aportar a este mensaje, responde solo con la palabra ${PASS}.`
      : '',
    history.length > 0 ? `Chat hasta ahora:\n\n${transcript(history)}` : '',
    `Mensaje nuevo ${writer}:\n\n${text}`,
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

// As many of the roles as the budget still allows, spending it.
const take = (roles: string[], budget: { left: number }) => {
  const taken = roles.slice(0, Math.max(0, budget.left))
  budget.left -= taken.length
  return taken
}

const send = async ($: EngineInterface, channel: string, text: string) => {
  const said = text.trim()
  if (said === '') return
  const history = (await read($, chat)).filter(one => one.channel === channel)
  const { roles, isNamed } =
    channel === GROUP ? addressed(said) : { roles: [channel], isNamed: true }
  await update($, chat, lines => [...lines, { id: crypto.randomUUID(), channel, from: ME, text: said }])
  await ask($, channel, roles, history, said, ME, isNamed, 0, { left: RELAYS })
}

// Each role answers one message in a channel; what they say to others is
// passed on, a hop further.
const ask = async (
  $: EngineInterface,
  channel: string,
  roles: string[],
  history: ChatMessage[],
  text: string,
  from: string,
  mustAnswer: boolean,
  hop: number,
  budget: { left: number },
) => {
  const list = await read($, runs)
  const canReach = hop < HOPS
  const waiting = roles.map(role => ({ role, id: crypto.randomUUID() }))
  await update($, chat, lines => [
    ...lines,
    ...waiting.map(({ role, id }) => ({ id, channel, from: role, text: '', isPending: true })),
  ])

  await Promise.all(
    waiting.map(async ({ role, id }) => {
      const prompt = chatPrompt(role, channel, history, text, from, mustAnswer, canReach, workOf(role, list))
      const reply = await answerAs($, role, prompt).catch((error: unknown) => ({
        isAnswered: false as const,
        reason: String(error),
      }))
      const answer = reply.isAnswered ? reply.text.trim() : ''
      const isPass = answer === PASS || answer === `${PASS}.`

      // In its own chat, the line for the group leaves the reply.
      const lines = answer.split('\n')
      const at = channel === GROUP || !canReach ? -1 : lines.findIndex(line => TO_GROUP.test(line))
      const toGroup = at < 0 ? '' : lines.slice(at).join('\n').replace(TO_GROUP, '').trim()
      const kept = at < 0 ? answer : lines.slice(0, at).join('\n').trim()
      const shown = toGroup === '' ? kept : `${kept}\n\n_Le escribí al chat de grupo: «${toGroup}»_`.trim()

      await update($, chat, all =>
        all.flatMap(one => {
          if (one.id !== id) return [one]
          if (isPass) return []
          const said = reply.isAnswered
            ? shown || '_Sin respuesta._'
            : `_No pude contestar (${reply.reason})._`
          return [{ id, channel, from: role, text: said }]
        }),
      )
      if (!canReach || isPass || !reply.isAnswered) return

      if (toGroup !== '') {
        const before = (await read($, chat)).filter(one => one.channel === GROUP)
        await update($, chat, all => [
          ...all,
          { id: crypto.randomUUID(), channel: GROUP, from: role, text: toGroup },
        ])
        const targets = take(reached(toGroup, role), budget)
        if (targets.length > 0) await ask($, GROUP, targets, before, toGroup, role, true, hop + 1, budget)
        return
      }
      if (channel === GROUP) {
        const targets = take(reached(answer, role), budget)
        if (targets.length === 0) return
        const before = (await read($, chat)).filter(one => one.channel === GROUP && one.id !== id)
        await ask($, GROUP, targets, before, answer, role, true, hop + 1, budget)
      }
    }),
  )
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
    const tile = (name: string) => (
      <Box borderStyle="round" borderColor="inactive" paddingX={1} alignSelf="flex-start">
        {icon(name)}
      </Box>
    )

    if (showing !== '') {
      const isGroup = showing === GROUP
      const messages = (await read($, chat)).filter(one => one.channel === showing).slice(-40)
      const room = isGroup
        ? 'Escribe a todos, o nombra a alguien con @ (@po, @qa, @dev…)'
        : `Escribe a ${labelOf(showing)}`
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={2} alignItems="center">
            <Button key="volver" plain onPress={() => update($, view, () => '')}>
              ← Equipo
            </Button>
            {tile(isGroup ? 'grupo' : showing)}
            <Text bold size="heading">
              {isGroup ? 'Chat de grupo' : `Chat con ${labelOf(showing)}`}
            </Text>
          </Box>
          {messages.length === 0 && <Text dimColor>Todavía no hay mensajes.</Text>}
          {messages.map(one => (
            <Box
              key={`mensaje-${one.id}`}
              flexDirection="column"
              borderStyle="round"
              borderColor={one.from === ME ? 'suggestion' : 'inactive'}
              paddingX={1}
            >
              <Text bold color={one.from === ME ? 'suggestion' : 'claude'}>
                {labelOf(one.from)}
              </Text>
              {one.isPending ? <Text dimColor>escribiendo…</Text> : <Markdown text={one.text} />}
            </Box>
          ))}
          {Input ? (
            // The field takes the pane's whole width, two lines tall, with room
            // below so its focus ring is not cut off.
            <Box key="caja" flexDirection="column" width="100%" paddingY={1} gap={1}>
              <Input
                key={`entrada-${showing}-${messages.length}`}
                placeholder={room}
                value=""
                rows={2}
                submitLabel="enviar"
                autoFocus
                onSubmit={text => send($, showing, text)}
              />
              <Text dimColor>Enter envía el mensaje.</Text>
            </Box>
          ) : (
            <Text dimColor>Para escribir, abre el panel en el escritorio o la terminal.</Text>
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
    const shown = TEAM.filter(m => {
      const status = stateOf(m.role).last?.status
      if (tab === 'en-curso') return status === 'trabajando'
      if (tab === 'completados') return status !== undefined && status !== 'trabajando'
      if (tab === 'disponibles') return status === undefined
      return true
    })

    // Two cards a row where the pane is wide enough, one otherwise.
    const perRow = width >= 56 ? 2 : 1
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
      const pill = isOnPause && !isWorking ? PAUSED_PILL : PILL[status ?? 'libre']
      const own = models[member.role] ?? ''
      const ownEffort = efforts[member.role] ?? ''
      const subtitle =
        isHalted
          ? 'Parando…'
          : status === 'trabajando' && last
          ? `${last.task}${last.lastTool ? ` · ${last.lastTool}` : ''}`
          : status && last
            ? `${STATUS_TEXT[status]}${last.durationMs !== undefined ? ` · ${duration(last.durationMs)}` : ''}`
            : 'Listo para una nueva tarea'
      const progress = status === 'trabajando' && last ? Math.min(0.9, 0.15 + last.tools / 40) : 0
      const barWidth = Math.max(6, cardWidth - 12)
      return (
        <Box
          key={`tarjeta-${member.role}`}
          flexDirection="row"
          gap={1}
          width={cardWidth}
          borderStyle="round"
          borderColor={status === 'trabajando' ? 'warning' : 'inactive'}
          hover={{ borderColor: 'suggestion' }}
          padding={1}
        >
          {tile(member.role)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1} gap={1}>
            <Box flexDirection="row" justifyContent="space-between" gap={1}>
              <Text bold wrap="truncate-end">
                {member.label}
                {mine.length > 1 ? ` ×${mine.length}` : ''}
              </Text>
              <Box borderStyle="round" borderColor={pill.color} paddingX={1}>
                <Text color={pill.color} size="caption">
                  {pill.icon} {pill.text}
                </Text>
              </Box>
            </Box>
            <Text dimColor wrap="truncate-end">
              {subtitle}
            </Text>
            {progress > 0 && (
              <Box flexDirection="row" width={barWidth} backgroundColor="subtle">
                <Box width={Math.max(1, Math.round(barWidth * progress))} backgroundColor="warning">
                  <Text> </Text>
                </Box>
              </Box>
            )}
            <Box flexDirection="row" justifyContent="space-between" gap={1}>
              <Button key={`chat-${member.role}`} plain onPress={() => update($, view, () => member.role)}>
                Abrir chat →
              </Button>
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
                ⋯
              </Button>
            </Box>
            {menuOf === member.role &&
              picker(`modelo-${member.role}`, own, AGENT_MODELS, 'Modelo', value => setModel($, member.role, value))}
            {menuOf === member.role &&
              picker(`esfuerzo-${member.role}`, ownEffort, AGENT_EFFORTS, 'Esfuerzo', value => setEffort($, member.role, value))}
            {menuOf === member.role && !isTeamPaused && (
              <Button key={`pausa-${member.role}`} plain onPress={() => togglePause($, member.role)}>
                {onPause.includes(member.role) ? '▶ Reanudar' : '⏸ Pausar'}
              </Button>
            )}
          </Box>
        </Box>
      )
    })

    const delivered = list.filter(one => one.status !== 'trabajando' ).reverse()
    const recent = isAll ? delivered : delivered.slice(0, 3)

    const tabs: { id: TeamFilter; label: string; count: number; color: 'suggestion' | 'warning' | 'success' | 'inactive' }[] = [
      { id: 'todos', label: 'Todos', count: TEAM.length, color: 'suggestion' },
      { id: 'en-curso', label: 'En curso', count: counts['en-curso'], color: 'warning' },
      { id: 'completados', label: 'Completados', count: counts.completados, color: 'success' },
      { id: 'disponibles', label: 'Disponibles', count: counts.disponibles, color: 'inactive' },
    ]

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={2} alignItems="center">
          {tile('grupo')}
          <Box flexDirection="column">
            <Text bold size="title">
              Agentes
            </Text>
            <Text dimColor>Tu equipo, en un solo lugar</Text>
          </Box>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={2} alignItems="center">
          <Button key="chat-grupo" variant="primary" onPress={() => update($, view, () => GROUP)}>
            💬 Chat de grupo
          </Button>
          {counts['en-curso'] > 0 && (
            <Button key="parar-todos" onPress={() => halt($)}>
              <Text color="error">■ Parar todos</Text>
            </Button>
          )}
          <Button key="pausa-todos" onPress={() => togglePause($, ALL)}>
            {isTeamPaused ? '▶ Reanudar equipo' : '⏸ Pausar equipo'}
          </Button>
          <Text>
            {TEAM.length} roles · <Text color="warning">●</Text> {counts['en-curso']} en curso ·{' '}
            <Text color="success">●</Text> {counts.completados} completados ·{' '}
            <Text color="inactive">●</Text> {counts.disponibles} disponibles
          </Text>
        </Box>

        <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" gap={1}>
          <Box flexDirection="row" gap={1} alignItems="center">
            {icon('grupo', 18)}
            <Text bold size="heading">
              Equipo
            </Text>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {picker('modelo-todos', teamModel, MODELS, 'Modelo', value => setModel($, ALL, value))}
            {picker('esfuerzo-todos', teamEffort, EFFORTS, 'Esfuerzo', value => setEffort($, ALL, value))}
          </Box>
        </Box>
        {isTeamPaused && (
          <Text color="warning">⏸ El equipo está en pausa: Claude no puede lanzar agentes hasta que lo reanudes.</Text>
        )}
        <Box flexDirection="row" flexWrap="wrap" gap={2}>
          {tabs.map(one => (
            <Button key={`pestana-${one.id}`} plain onPress={() => update($, filter, () => one.id)}>
              <Text bold={tab === one.id} underline={tab === one.id} color={tab === one.id ? 'suggestion' : undefined}>
                {one.label}
              </Text>{' '}
              <Text color={one.color}>{one.count}</Text>
            </Button>
          ))}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {cards.length > 0 ? cards : <Text dimColor>Ningún agente en esta pestaña.</Text>}
        </Box>

        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1} alignItems="center">
            {icon('entregas', 18)}
            <Text bold size="heading">
              Entregas recientes
            </Text>
            <Box borderStyle="round" borderColor="inactive" paddingX={1}>
              <Text size="caption">{delivered.length}</Text>
            </Box>
          </Box>
          {delivered.length > 3 && (
            <Button key="ver-todas" plain onPress={() => update($, showAll, now => !now)}>
              <Text color="suggestion">{isAll ? 'Ver menos ←' : 'Ver todas →'}</Text>
            </Button>
          )}
        </Box>
        {delivered.length === 0 && <Text dimColor>Ningún agente ha entregado todavía.</Text>}
        {recent.map(run => {
          const isOpen = open === run.id
          const facts = [
            labelOf(run.role),
            run.model ? modelLabel(run.model) : '',
            run.effort ? `esfuerzo ${effortLabel(run.effort).toLowerCase()}` : '',
            duration(run.durationMs),
            `${run.tools} herramientas`,
          ]
            .filter(Boolean)
            .join(' · ')
          const done = PILL[run.status]
          return (
            <Box
              key={`entrega-${run.id}`}
              flexDirection="column"
              borderStyle="round"
              borderColor="inactive"
              hover={{ borderColor: 'suggestion' }}
              paddingX={1}
            >
              <Button
                key={run.id}
                plain
                onPress={() => update($, expanded, now => (now === run.id ? null : run.id))}
              >
                <Text color={done.color}>{done.icon}</Text> <Text bold>{titleOf(run)}</Text>{' '}
                <Text dimColor>{isOpen ? '▴' : '▾'}</Text>
              </Button>
              <Text dimColor wrap="truncate-end">
                {'  '}
                {facts}
              </Text>
              {isOpen && (
                <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1} marginTop={1}>
                  <Text dimColor size="caption">
                    RESUMEN
                  </Text>
                  <Text>{summaryOf(run.report)}</Text>
                </Box>
              )}
              {isOpen && (
                <Button
                  key={`completo-${run.id}`}
                  plain
                  onPress={() => update($, full, now => (now === run.id ? null : run.id))}
                >
                  <Text color="suggestion">
                    {whole === run.id ? 'Ocultar análisis completo ▴' : 'Leer análisis completo →'}
                  </Text>
                </Button>
              )}
              {isOpen && whole === run.id && <Markdown text={run.report || '_Sin informe._'} />}
            </Box>
          )
        })}
        {list.length > 0 && (
          <Button
            key="limpiar"
            dimColor
            onPress={async () => {
              await update($, runs, () => [])
              await update($, expanded, () => null)
              await update($, full, () => null)
            }}
          >
            Limpiar
          </Button>
        )}
      </Box>
    )
  })
}
