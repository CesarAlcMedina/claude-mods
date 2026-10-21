import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, RunStatus } from '../types'

const PANE = 'panel-agentes'
const TITLE = 'Agentes'
const PREFIX = 'agent-control-center:'

const runs = atom({ plugin: 'panel-agentes', key: 'runs' } as const, [])
const expanded = atom({ plugin: 'panel-agentes', key: 'expanded' } as const, null)

// The team in the order the coordinador skill hands work along.
const TEAM: { role: string; label: string }[] = [
  { role: 'product-owner', label: 'Product Owner' },
  { role: 'business-analyst', label: 'Analista de negocio' },
  { role: 'ux-ui-designer', label: 'Diseño UX/UI' },
  { role: 'software-engineer', label: 'Ingeniería' },
  { role: 'code-reviewer', label: 'Revisión de código' },
  { role: 'qa-engineer', label: 'QA' },
  { role: 'devops-engineer', label: 'DevOps' },
  { role: 'research-agent', label: 'Investigación' },
]

const roleOf = (subagentType: string) =>
  subagentType.startsWith(PREFIX) ? subagentType.slice(PREFIX.length) : subagentType

const labelOf = (role: string) => TEAM.find(one => one.role === role)?.label ?? role

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
      }
      await update($, runs, list => [...list, run].slice(-50))
    }
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
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = elements
    // The mobile app draws no picker yet: there the card's button walks the models.
    const Select = 'Select' in elements && e.surface !== 'mobile' ? elements.Select : undefined
    const list = await read($, runs)
    const open = await read($, expanded)
    const width = Math.max(20, e.props.bodyColumns)

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
        </Box>
      )
    })

    const done = list.filter(one => one.status !== 'trabajando').reverse()

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Equipo</Text>
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
