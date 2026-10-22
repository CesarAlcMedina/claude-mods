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
  /** Stopped by a pause, to pick up where it left off once resumed. */
  isPaused?: true
  /** Its work was handed back to the main session to go on with. */
  isResumed?: true
  /** When it started, to tell which request of the panel's it answers. */
  startedAt?: number
  /** When the panel last noted in a chat what it was doing. */
  notedAt?: number
}

/** The agents a session works with, chosen under «Configurar equipo». */
export type SessionTeam = {
  /** Who gets consulted in the chats and launched for new work. */
  roles: string[]
  /** Taken off while working: they finish what they have, and take nothing new. */
  leaving: string[]
  /** When each role was brought in after the team was first chosen. */
  joined: Record<string, number>
  /** False until the person chooses: then every role takes part, as before. */
  isChosen: boolean
  /** The team as the main session was last told it. */
  told?: string
}

/** «Configurar equipo» while it is open: the roles ticked so far. */
export type TeamSetup = {
  draft: string[]
  /** Roles being taken off with work in progress, asked about first. */
  busy?: string[]
}

/** An offer to bring roles that are not in the team in, and pass them a message. */
export type TeamOffer = {
  channel: string
  roles: string[]
  /** The message they get once in; none for a plain proposal. */
  messageId?: string
  /** The work they get once in, handed to the main session for them. */
  task?: string
}

/**
 * Where a piece of work asked in the panel stands: taken by the panel,
 * entered in the main session, an agent launched for it, its result given,
 * answered with no agent, stopped before its result, or never sent.
 */
export type RequestStatus = 'recibido' | 'enviado' | 'iniciado' | 'terminado' | 'sin-agentes' | 'detenido' | 'no-enviado'

/** Work the Coordinador handed to the main session from the panel. */
export type PanelRequest = {
  id: string
  goal: string
  at: number
  /** Seen entering the main session as a prompt. */
  isSent?: true
  status?: RequestStatus
  /** The chat it was asked in, where its progress and result are posted. */
  channel?: string
  /** The roles named to do it; none leaves the choice to the main session. */
  roles?: string[]
  /** The agents launched for it. */
  runIds?: string[]
  /** The main session's turns spent on it. */
  turnIds?: string[]
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

/** The plan's five-hour limit, as the API last reported it. */
export type PlanUsage = {
  /** 0 to 100, past 100 once exceeded. */
  percent: number
  /** When the window resets, in milliseconds since the epoch. */
  resetsAt?: number
  /** When the panel last saw this reading. */
  seenAt: number
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
      /** The request the main session is working on, while it does. */
      driving: string | null
      /** A line for the person above the team, such as an order left to send. */
      notice: string | null
      /** This session's team. */
      team: SessionTeam
      setup: TeamSetup | null
      offer: TeamOffer | null
      usage: PlanUsage | null
      /** Moves on a timer, to keep the countdown current. */
      tick: number
    }
  }
}
