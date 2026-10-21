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
  /** Started from the panel's chat: shown on its card, not under Entregas. */
  isChat?: boolean
}

/** One line of a chat: a role's own channel, or `grupo` for the team's. */
export type ChatMessage = {
  id: string
  channel: string
  /** `tu` for the person, else the role that wrote it. */
  from: string
  text: string
  /** The agent answering it. */
  agentId?: string
  /** True while the answer is on its way. */
  isPending?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'panel-agentes': {
      runs: AgentRun[]
      expanded: string | null
      chat: ChatMessage[]
      /** What the pane shows: '' the team, a role its chat, `grupo` the group's. */
      view: string
    }
  }
}
