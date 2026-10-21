export type RunStatus = 'trabajando' | 'entregado' | 'fallo' | 'interrumpido'

export type AgentRun = {
  id: string
  role: string
  task: string
  status: RunStatus
  tools: number
  lastTool?: string
  durationMs?: number
  report?: string
}

declare module 'claude-code' {
  interface PluginState {
    'panel-agentes': { runs: AgentRun[]; expanded: string | null }
  }
}
