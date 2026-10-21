import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, ChatMessage, RunStatus } from '../types'

const PANE = 'panel-agentes'
const TITLE = 'Agentes'
const PREFIX = 'agent-control-center:'
const GROUP = 'grupo'
const ME = 'tu'

const runs = atom({ plugin: 'panel-agentes', key: 'runs' } as const, [])
const expanded = atom({ plugin: 'panel-agentes', key: 'expanded' } as const, null)
const chat = atom({ plugin: 'panel-agentes', key: 'chat' } as const, [])
const view = atom({ plugin: 'panel-agentes', key: 'view' } as const, '')

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
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

const short = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

// The model each role runs on, chosen in the panel and kept across sessions.
// An empty choice leaves the model to the agent's own definition.
const MODELS_KEY = 'modelos'
const MODELS: { value: string; label: string }[] = [
  { value: '', label: 'Predeterminado' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
]

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
}

const STATUS_TEXT: Record<RunStatus, string> = {
  trabajando: 'Trabajando',
  entregado: 'Entregó',
  fallo: 'Falló',
  interrumpido: 'Interrumpido',
}

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
    const chosen = TEAM.some(one => one.role === role) ? (await readModels($))[role] : undefined
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
    // The mobile app draws no picker or field yet: there the card's button
    // walks the models, and the chat is read only.
    const Select = 'Select' in elements && e.surface !== 'mobile' ? elements.Select : undefined
    const Input = 'Input' in elements && e.surface !== 'mobile' ? elements.Input : undefined
    const width = Math.max(20, e.props.bodyColumns)
    const showing = await read($, view)

    if (showing !== '') {
      const isGroup = showing === GROUP
      const messages = (await read($, chat)).filter(one => one.channel === showing).slice(-40)
      const room = isGroup
        ? 'Escribe a todos, o nombra a alguien con @ (@po, @qa, @dev…)'
        : `Escribe a ${labelOf(showing)}`
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={2}>
            <Button key="volver" plain onPress={() => update($, view, () => '')}>
              ← Equipo
            </Button>
            <Text bold>{isGroup ? 'Chat de grupo' : `Chat con ${labelOf(showing)}`}</Text>
          </Box>
          {messages.length === 0 && <Text dimColor>Todavía no hay mensajes.</Text>}
          {messages.map(one => (
            <Box key={`mensaje-${one.id}`} flexDirection="column">
              <Text bold color={one.from === ME ? 'suggestion' : 'claude'}>
                {labelOf(one.from)}
              </Text>
              {one.isPending ? (
                <Text dimColor>escribiendo…</Text>
              ) : (
                <Markdown text={one.text} />
              )}
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
    const models = await readModels($)
    // Two cards a row where the pane is wide enough, one otherwise.
    const perRow = width >= 56 ? 2 : 1
    const cardWidth = Math.floor((width - (perRow - 1)) / perRow)

    const team = TEAM.map(member => {
      const mine = list.filter(one => one.role === member.role)
      const last = mine[mine.length - 1]
      const status = last?.status
      const model = models[member.role] ?? ''
      const pick = (value: string) => setModel($, member.role, value)
      const nextModel = () => {
        const at = MODELS.findIndex(one => one.value === model)
        return pick(MODELS[(at + 1) % MODELS.length]?.value ?? '')
      }
      const detail =
        status === 'trabajando' && last
          ? `${short(last.task, cardWidth - 4)}${last.lastTool ? ` · ${last.lastTool}` : ''}`
          : status && last
            ? `${STATUS_TEXT[status]}${last.durationMs !== undefined ? ` · ${duration(last.durationMs)}` : ''}`
            : 'Libre'
      return (
        <Box
          key={`tarjeta-${member.role}`}
          flexDirection="column"
          width={cardWidth}
          borderStyle="round"
          borderColor={status ? COLOR[status] : 'inactive'}
          paddingX={1}
        >
          <Text wrap="truncate-end">
            <Text color={status ? COLOR[status] : 'inactive'}>{status ? ICON[status] : '○'}</Text>{' '}
            <Text bold>{member.label}</Text>
            {mine.length > 1 && <Text dimColor> ×{mine.length}</Text>}
          </Text>
          <Text dimColor wrap="truncate-end">
            {detail}
          </Text>
          {Select ? (
            <Select
              key={`modelo-${member.role}`}
              label="Modelo"
              options={MODELS}
              value={model}
              onSelect={value => pick(value)}
            />
          ) : (
            <Button key={`modelo-${member.role}`} plain onPress={nextModel}>
              Modelo: {modelLabel(model)} <Text dimColor>▸</Text>
            </Button>
          )}
          <Button key={`chat-${member.role}`} plain onPress={() => update($, view, () => member.role)}>
            Chat <Text dimColor>▸</Text>
          </Button>
        </Box>
      )
    })

    const done = list.filter(one => one.status !== 'trabajando' && !one.isChat).reverse()

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>Equipo</Text>
            <Button key="chat-grupo" plain onPress={() => update($, view, () => GROUP)}>
              Chat de grupo <Text dimColor>▸</Text>
            </Button>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {team}
          </Box>
        </Box>
        <Box flexDirection="column">
          <Text bold>Entregas</Text>
          {done.length === 0 && (
            <Text dimColor>Ningún agente ha entregado todavía.</Text>
          )}
          {done.map(run => {
            const isOpen = open === run.id
            const facts = [
              run.model ? modelLabel(run.model) : '',
              duration(run.durationMs),
              `${run.tools} herramientas`,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <Box key={`entrega-${run.id}`} flexDirection="column">
                <Button
                  key={run.id}
                  plain
                  onPress={() => update($, expanded, now => (now === run.id ? null : run.id))}
                >
                  <Text color={COLOR[run.status]}>{ICON[run.status]}</Text> {labelOf(run.role)}{' '}
                  <Text dimColor>
                    {facts} {isOpen ? '▾' : '▸'}
                  </Text>
                </Button>
                <Text dimColor wrap="truncate-end">
                  {'  '}
                  {short(run.task, width - 2)}
                </Text>
                {isOpen && (
                  <Markdown text={run.report || '_Sin informe._'} />
                )}
              </Box>
            )
          })}
        </Box>
        {list.length > 0 && (
          <Button
            key="limpiar"
            dimColor
            onPress={async () => {
              await update($, runs, () => [])
              await update($, expanded, () => null)
            }}
          >
            Limpiar
          </Button>
        )}
      </Box>
    )
  })
}
