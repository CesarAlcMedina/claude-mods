export type RunStatus = 'trabajando' | 'entregado' | 'fallo' | 'interrumpido'

export type AgentRun = {
  id: string
  role: string
  task: string
  status: RunStatus
  tools: number
  model?: string
  lastTool?: string
  durationMs?: number
  report?: string
}

/** One line of a chat: a role's own channel, or `grupo` for the team's. */
export type ChatMessage = {
  id: string
  channel: string
  /** `tu` for the person, else the role that wrote it. */
  from: string
  text: string
  /** True while the answer is on its way. */
  isPending?: boolean
}

/** Which cards the team tabs show. */
export type TeamFilter = 'todos' | 'en-curso' | 'completados' | 'disponibles'

declare module 'claude-code' {
  interface PluginState {
    'panel-agentes': {
      runs: AgentRun[]
      /** The delivery whose summary is shown. */
      expanded: string | null
      /** The delivery whose whole report is shown. */
      full: string | null
      chat: ChatMessage[]
      /** What the pane shows: '' the team, a role its chat, `grupo` the group's. */
      view: string
      filter: TeamFilter
      /** The card whose ⋯ menu is open. */
      menu: string | null
      /** Every delivery under Entregas recientes, not only the last three. */
      showAll: boolean
      /** The models chosen, as `$.store` keeps them, for drawing. */
      models: Record<string, string>
    }
  }
}
