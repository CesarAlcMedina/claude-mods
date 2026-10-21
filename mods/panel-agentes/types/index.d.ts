export type RunStatus = 'trabajando' | 'entregado' | 'fallo' | 'interrumpido'

export type AgentRun = {
  id: string
  role: string
  task: string
  status: RunStatus
  tools: number
  model?: string
  /** The effort its model steps were sent with, when the panel chose one. */
  effort?: string
  lastTool?: string
  durationMs?: number
  report?: string
  /** Stopped from the panel: its tool calls are refused until it ends. */
  isHalted?: true
  /** When it started, to tell which request of the panel's it answers. */
  startedAt?: number
}

/** A new function the Coordinador handed to the main session. */
export type PanelRequest = {
  id: string
  goal: string
  at: number
  /** Seen entering the main session as a prompt. */
  isSent?: true
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
  /** The panel's own quiet line, such as no one having anything to add. */
  isNote?: true
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
      /** The efforts chosen, as `$.store` keeps them, for drawing. */
      efforts: Record<string, string>
      /** The roles on pause, `*` for the whole team. */
      paused: string[]
      /** The open chat shows its earlier messages too, not only the last ones. */
      earlier: boolean
      requests: PanelRequest[]
    }
  }
}
