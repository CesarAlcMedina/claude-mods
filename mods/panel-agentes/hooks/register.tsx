import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

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

// The team in the order the coordinador skill hands work along, with the
// short names an @mention in the group chat may use.
const TEAM: { role: string; label: string; aliases: string[] }[] = [
  { role: 'product-owner', label: 'Product Owner', aliases: ['po'] },
  { role: 'business-analyst', label: 'Analista de negocio', aliases: ['ba', 'analista'] },
  { role: 'ux-ui-designer', label: 'Diseño UX/UI', aliases: ['ux', 'ui', 'diseño'] },
  { role: 'software-engineer', label: 'Ingeniería', aliases: ['dev', 'ingenieria', 'ingeniería'] },
  { role: 'code-reviewer', label: 'Revisión de código', aliases: ['reviewer', 'revision', 'revisión'] },
  { role: 'qa-engineer', label: 'QA', aliases: ['qa'] },
  { role: 'devops-engineer', label: 'DevOps', aliases: ['devops'] },
  { role: 'research-agent', label: 'Investigación', aliases: ['research', 'investigacion', 'investigación'] },
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

const readModels = async ($: EngineInterface): Promise<Record<string, string>> => {
  const value = await $.store.get(MODELS_KEY)
  return value !== null && typeof value === 'object' ? (value as Record<string, string>) : {}
}

const setModel = async ($: EngineInterface, role: string, model: string) => {
  const models = { ...(await readModels($)) }
  if (model === '') delete models[role]
  else models[role] = model
  await $.store.set(MODELS_KEY, models)
  await update($, modelsShown, () => models)
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

// The chat. Each message the person sends starts the agent afresh with the
// conversation so far; in the group chat a role with nothing to add answers
// PASS and is left out.
const CHAT_TASK = 'Chat'
// A chat spawn is named after the line that waits for its answer.
const CHAT_NAME = 'chat-'
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

const chatPrompt = (role: string, channel: string, history: ChatMessage[], text: string, mustAnswer: boolean) => {
  const isGroup = channel === GROUP
  const team = TEAM.map(one => `${one.label} (@${one.aliases[0]})`).join(', ')
  return [
    isGroup
      ? `Estás en el chat de grupo del panel de agentes con el usuario y todo el equipo: ${team}. Hablas como ${labelOf(role)}.`
      : `Estás hablando con el usuario por el chat del panel de agentes. Hablas como ${labelOf(role)}.`,
    'Responde en español, breve y en tono de conversación: unas pocas frases o una lista corta, desde tu rol.',
    'No modifiques archivos ni ejecutes comandos que cambien nada, salvo que el usuario te lo pida claramente en su mensaje nuevo.',
    isGroup && !mustAnswer
      ? `Si desde tu rol no tienes nada útil que aportar a este mensaje, responde solo con la palabra ${PASS}.`
      : '',
    history.length > 0 ? `Conversación hasta ahora:\n\n${transcript(history)}` : '',
    `Mensaje nuevo del usuario:\n\n${text}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

const send = async ($: EngineInterface, channel: string, text: string) => {
  const said = text.trim()
  if (said === '') return
  const history = (await read($, chat)).filter(one => one.channel === channel)
  await update($, chat, list => [
    ...list,
    { id: crypto.randomUUID(), channel, from: ME, text: said },
  ])

  const { roles, isNamed } =
    channel === GROUP ? addressed(said) : { roles: [channel], isNamed: true }
  const waiting = roles.map(role => ({ role, id: crypto.randomUUID() }))
  await update($, chat, list => [
    ...list,
    ...waiting.map(({ role, id }) => ({ id, channel, from: role, text: '', isPending: true })),
  ])
  await Promise.all(
    waiting.map(async ({ role, id }) => {
      const started = await $.agent
        .spawn({
          subagentType: `${PREFIX}${role}`,
          description: `${CHAT_TASK}: ${short(said, 40)}`,
          name: `${CHAT_NAME}${id}`,
          prompt: chatPrompt(role, channel, history, said, isNamed),
        })
        .catch((error: unknown) => ({ deny: String(error), agentId: undefined }))
      if (started.deny === undefined) {
        if (started.agentId !== undefined) await linkChat($, id, started.agentId)
        return
      }
      await update($, chat, list =>
        list.map(one =>
          one.id === id ? { id, channel, from: role, text: `_No pude contestar: ${started.deny}._` } : one,
        ),
      )
    }),
  )
}

// Ties a waiting chat line to the agent that answers it.
const linkChat = ($: EngineInterface, id: string, agentId: string) =>
  update($, chat, list => list.map(one => (one.id === id ? { ...one, agentId } : one)))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const kept = await readModels($)
    await update($, modelsShown, () => kept)
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
    const models = TEAM.some(one => one.role === role) ? await readModels($) : {}
    const chosen = models[role] || models[ALL] || undefined
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
        isChat: e.description.startsWith(`${CHAT_TASK}: `),
      }
      await update($, runs, list => [...list, run].slice(-50))
    }
    if (e.name?.startsWith(CHAT_NAME)) await linkChat($, e.name.slice(CHAT_NAME.length), id)
    void $.ui.open({ id: PANE, title: TITLE })

    return started
  })

  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      await update($, runs, list =>
        list.map(one =>
          one.id === agentId ? { ...one, tools: one.tools + 1, lastTool: e.tool } : one,
        ),
      )
    }

    return next(e)
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
                status,
                durationMs: (one.durationMs ?? 0) + e.durationMs,
                report: e.answer || one.report,
              }
            : one,
        ),
      )

      const answer = e.answer.trim()
      await update($, chat, list =>
        list.flatMap(one => {
          if (one.agentId !== agentId || !one.isPending) return [one]
          if (answer === PASS || answer === `${PASS}.`) return []
          const text =
            status === 'entregado' ? answer || '_Sin respuesta._' : `_${STATUS_TEXT[status]}._`
          return [{ id: one.id, channel: one.channel, from: one.from, text }]
        }),
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
            <Input
              key={`entrada-${showing}`}
              placeholder={room}
              value=""
              submitLabel="enviar"
              autoFocus
              onSubmit={text => send($, showing, text)}
            />
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
      const pill = PILL[status ?? 'libre']
      const own = models[member.role] ?? ''
      const subtitle =
        status === 'trabajando' && last
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
            <Box flexDirection="row" justifyContent="space-between">
              <Button key={`chat-${member.role}`} plain onPress={() => update($, view, () => member.role)}>
                Abrir chat →
              </Button>
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
          </Box>
        </Box>
      )
    })

    const delivered = list.filter(one => one.status !== 'trabajando' && !one.isChat).reverse()
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
          {picker('modelo-todos', teamModel, MODELS, 'Modelo', value => setModel($, ALL, value))}
        </Box>
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
