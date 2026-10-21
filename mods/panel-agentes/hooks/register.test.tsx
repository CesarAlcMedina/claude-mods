import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'panel-agentes',
  component: 'Pane',
  requestId: 'panel-agentes',
  props: {
    title: 'Agentes',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const PROVIDER = { plugin: 'agent-control-center', tier: 'user' } as const

test('el panel muestra quién trabaja y qué entregó, en cada superficie', async ($, on) => {
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'test', agentId: 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'Define las historias',
    description: 'Historias del login',
    subagentType: 'agent-control-center:product-owner',
    provider: PROVIDER,
    parentModel: 'test',
    background: false,
    fork: false,
  })
  // A call from inside the subagent's loop carries its id.
  const fromAgent = { tool: 'Read', file_path: '/a.md', agentId: 'a1' } as const
  await $.tool.call(fromAgent)

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Historias del login · Read/ }))?.text).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Ningún agente/ })).toBeDefined()
    await ui.unmount()
  }

  await $.turn.complete({
    answer: '## Historias\n- Como usuario quiero entrar',
    durationMs: 65000,
    isAborted: false,
    turnId: 'u1',
    agentId: 'a1',
    reason: 'answer',
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /1m 5s · 1 herramientas/ })).toBeDefined()
    await ui.press({ key: 'a1' })
    expect(await ui.find({ type: 'Markdown' })).toBeDefined()
    await ui.press({ key: 'a1' })
    await ui.unmount()
  }
})

test('el modelo elegido en la tarjeta se usa al lanzar el agente', async ($, on) => {
  const asked: (string | undefined)[] = []
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', (_, e) => {
    asked.push(e.model)
    return { model: e.model ?? 'claude-sonnet-5-5', agentId: `a${asked.length}` }
  })

  const spawn = () =>
    $.agent.spawn({
      tool_use_id: 't',
      prompt: 'Revisa',
      description: 'Revisión',
      subagentType: 'agent-control-center:code-reviewer',
      provider: PROVIDER,
      parentModel: 'test',
      background: false,
      fork: false,
    })

  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await desk.select({ key: 'modelo-code-reviewer', value: 'opus' })
  await desk.unmount()
  await spawn()

  // Mobile has no Select: the card's button walks the models instead.
  const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await phone.find({ type: 'Button', text: /Modelo: Opus/ })).toBeDefined()
  await phone.press({ key: 'modelo-code-reviewer' })
  expect(await phone.find({ type: 'Button', text: /Modelo: Predeterminado/ })).toBeDefined()
  await phone.unmount()
  await spawn()

  expect(asked).toEqual(['opus', undefined])
})

// The kit answers a spawn the plugin makes itself without an agent id (one a
// test hook "starts" is no started agent), so the answer arriving is not
// exercised here: what is sent, to whom, and the waiting line are.
test('el chat con un agente y el de grupo', async ($, on) => {
  const prompts: { type: string; prompt: string }[] = []
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', (_, e) => {
    // A spawn the plugin makes reaches the bottom as the Agent tool's input.
    const raw = e as unknown as { subagent_type?: string }
    prompts.push({ type: e.subagentType ?? raw.subagent_type ?? '', prompt: e.prompt })
    return { model: 'test', agentId: `c${prompts.length}` }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-qa-engineer' })
  await ui.input({ key: 'entrada-qa-engineer', text: '¿Qué probarías primero?' })
  expect(prompts[0]?.type).toBe('agent-control-center:qa-engineer')
  expect(prompts[0]?.prompt).toContain('¿Qué probarías primero?')
  expect(await ui.find({ type: 'Markdown', text: /Qué probarías/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /escribiendo/ })).toBeDefined()

  // A second message carries the conversation so far.
  await ui.input({ key: 'entrada-qa-engineer', text: '¿Y después?' })
  expect(prompts[1]?.prompt).toContain('Tú: ¿Qué probarías primero?')

  await ui.press({ key: 'volver' })
  await ui.press({ key: 'chat-grupo' })

  // Naming someone asks only them, and they must answer.
  await ui.input({ key: 'entrada-grupo', text: '@po @dev ¿empezamos?' })
  expect(prompts.slice(2).map(p => p.type)).toEqual([
    'agent-control-center:product-owner',
    'agent-control-center:software-engineer',
  ])
  expect(prompts[2]?.prompt).not.toContain('PASO')

  // Naming nobody asks all eight, each free to stay quiet.
  await ui.input({ key: 'entrada-grupo', text: 'Hola equipo' })
  expect(prompts.length).toBe(12)
  expect(prompts[4]?.prompt).toContain('PASO')
  expect(prompts[4]?.prompt).toContain('chat de grupo')

  // The chat on mobile is read only.
  await ui.unmount()
  const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await phone.find({ type: 'Text', text: /Para escribir/ })).toBeDefined()
  await phone.unmount()
})
