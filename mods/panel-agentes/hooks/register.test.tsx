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
    expect(await ui.find({ type: 'Text', text: /1 min 5 s · 1 herramientas/ })).toBeDefined()
    await ui.press({ key: 'a1' })
    expect(await ui.find({ type: 'Text', text: /Como usuario quiero entrar/ })).toBeDefined()
    await ui.press({ key: 'completo-a1' })
    expect(await ui.find({ type: 'Markdown', text: /Historias/ })).toBeDefined()
    await ui.press({ key: 'completo-a1' })
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
  await desk.press({ key: 'menu-code-reviewer' })
  await desk.select({ key: 'modelo-code-reviewer', value: 'opus' })
  await desk.unmount()
  await spawn()

  // Mobile has no Select: the card's button walks the models instead.
  const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await phone.find({ type: 'Button', text: /Modelo: Opus/ })).toBeDefined()
  await phone.press({ key: 'modelo-code-reviewer' })
  expect(await phone.find({ type: 'Button', text: /Modelo: Como el equipo/ })).toBeDefined()
  await phone.unmount()
  await spawn()

  expect(asked).toEqual(['opus', undefined])
})

test('el chat con un agente y el de grupo', async ($, on) => {
  const prompts: string[] = []
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // The model answers as the role named in the prompt; the analyst passes.
  on('model.fork', (_, e) => {
    prompts.push(e.prompt)
    if (e.prompt.includes('agente Analista de negocio') && e.prompt.includes('PASO')) {
      return { value: { isAnswered: true as const, text: 'PASO', usage } }
    }
    const role = /eres el agente ([^ ]+(?: [^ ]+)?) del/.exec(e.prompt)?.[1] ?? '?'
    return { value: { isAnswered: true as const, text: `Respuesta de ${role}.`, usage } }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-qa-engineer' })
  await ui.input({ key: 'entrada-qa-engineer-0', text: '¿Qué estás haciendo?' })
  expect(prompts[0]).toContain('eres el agente QA del')
  expect(prompts[0]).toContain('de una a tres frases cortas')
  expect(prompts[0]).toContain('¿Qué estás haciendo?')
  expect(await ui.find({ type: 'Markdown', text: /Respuesta de QA/ })).toBeDefined()

  // A second message carries the chat so far, and the field starts empty.
  expect((await ui.find({ key: 'entrada-qa-engineer-2' }))?.props).toMatchObject({ value: '' })
  await ui.input({ key: 'entrada-qa-engineer-2', text: '¿Y después?' })
  expect(prompts[1]).toContain('Tú: ¿Qué estás haciendo?')
  expect(prompts[1]).toContain('QA: Respuesta de QA.')

  await ui.press({ key: 'volver' })
  await ui.press({ key: 'chat-grupo' })

  // Naming someone asks only them, and they must answer.
  await ui.input({ key: 'entrada-grupo-0', text: '@po @dev ¿empezamos?' })
  expect(prompts.length).toBe(4)
  expect(prompts[2]).toContain('agente Product Owner')
  expect(prompts[3]).toContain('agente Ingeniería')
  expect(prompts[2]).not.toContain('PASO')

  // Naming nobody asks all eight; one with nothing to add stays quiet.
  await ui.input({ key: 'entrada-grupo-3', text: 'Hola equipo' })
  expect(prompts.length).toBe(12)
  expect(prompts[4]).toContain('chat de grupo')
  expect(prompts[4]).toContain('una o dos frases cortas')
  expect(await ui.find({ type: 'Markdown', text: /PASO/ })).toBeUndefined()
  expect(await ui.find({ type: 'Markdown', text: /Respuesta de Diseño UX\/UI/ })).toBeDefined()

  // The chat on mobile is read only.
  await ui.unmount()
  const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await phone.find({ type: 'Text', text: /Para escribir/ })).toBeDefined()
  await phone.unmount()
})

test('sin conversación que bifurcar, contesta el modelo elegido', async ($, on) => {
  const asked: string[] = []
  mock.store(on, { modelos: { 'qa-engineer': 'haiku' } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.fork', () => ({ value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }))
  on('model.complete', (_, e) => {
    asked.push(e.model)
    return {
      value: {
        isAnswered: true as const,
        text: 'Hola desde QA.',
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-qa-engineer' })
  await ui.input({ key: 'entrada-qa-engineer-0', text: 'Hola' })
  expect(asked).toEqual(['haiku'])
  expect(await ui.find({ type: 'Markdown', text: /Hola desde QA/ })).toBeDefined()
  await ui.unmount()
})

test('los agentes se escriben en el chat de grupo', async ($, on) => {
  const prompts: string[] = []
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.fork', (_, e) => {
    prompts.push(e.prompt)
    const text = e.prompt.includes('agente Diseño UX/UI del')
      ? 'Claro, le pregunto.\nAL GRUPO: @po ¿qué priorizamos?'
      : e.prompt.includes('agente Product Owner del')
        ? 'Primero el bloque 2.'
        : e.prompt.includes('agente QA del')
          ? '@dev ¿ya está?'
          : '@qa Casi, ¿y tú?'
    return { value: { isAnswered: true as const, text, usage } }
  })

  // Asked in its own chat, the designer writes to the PO in the group.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-ux-ui-designer' })
  await ui.input({ key: 'entrada-ux-ui-designer-0', text: 'Habla con el PO' })
  expect(prompts[0]).toContain('«AL GRUPO:»')
  expect(await ui.find({ type: 'Markdown', text: /Le escribí al chat de grupo: «@po ¿qué priorizamos\?»/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /^AL GRUPO/ })).toBeUndefined()
  expect(prompts.length).toBe(2)
  expect(prompts[1]).toContain('Mensaje nuevo del agente Diseño UX/UI')
  expect(prompts[1]).not.toContain('PASO')

  await ui.press({ key: 'volver' })
  await ui.press({ key: 'chat-grupo' })
  expect(await ui.find({ type: 'Markdown', text: /^@po ¿qué priorizamos\?$/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /Primero el bloque 2/ })).toBeDefined()

  // Agents who keep naming each other stop after a few hops.
  await ui.input({ key: 'entrada-grupo-2', text: '@qa ¿cómo vas?' })
  expect(prompts.length).toBe(6)
  expect(prompts[3]).toContain('Mensaje nuevo del agente QA')
  expect(prompts[5]).toContain('No nombres a otros agentes')
  await ui.unmount()
})

test('el esfuerzo elegido, y parar o pausar a los agentes', async ($, on) => {
  const sent: (string | number | undefined)[] = []
  let count = 0
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `a${++count}` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.step', async function* (_, e) {
    sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })

  const spawn = (role: string) =>
    $.agent.spawn({
      tool_use_id: 't',
      prompt: 'Trabaja',
      description: `Tarea de ${role}`,
      subagentType: `agent-control-center:${role}`,
      provider: PROVIDER,
      parentModel: 'test',
      background: false,
      fork: false,
    })
  const step = async (agentId: string | undefined, effort?: 'medium') => {
    for await (const _ of $.turn.step({ turnId: 'u', index: 0, model: 'm', effort, messageCount: 1, agentId })) {
      // nothing streams from the mock
    }
  }
  const toolOf = (agentId: string) => {
    // A call from inside the subagent's loop carries its id.
    const fromAgent = { tool: 'Read', file_path: '/a.md', agentId } as const
    return $.tool.call(fromAgent)
  }

  // The team works on low, QA on high; a model without effort gets none.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'esfuerzo-todos', value: 'low' })
  await ui.press({ key: 'menu-qa-engineer' })
  await ui.select({ key: 'esfuerzo-qa-engineer', value: 'high' })
  await spawn('qa-engineer')
  await spawn('product-owner')
  await step('a1', 'medium')
  await step('a2', 'medium')
  await step('a1')
  await step(undefined, 'medium')
  expect(sent).toEqual(['high', 'low', undefined, 'medium'])

  // Stopping one refuses its tools; the other keeps going.
  await ui.press({ key: 'parar-qa-engineer' })
  expect(await ui.find({ type: 'Text', text: /Parando…/ })).toBeDefined()
  expect(await toolOf('a1')).toMatchObject({ deny: expect.stringContaining('paró a este agente') })
  expect(await toolOf('a2')).toMatchObject({ result: {} })
  await $.turn.complete({ answer: 'Llevo la mitad.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a1', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: /Interrumpido/ })).toBeDefined()

  // Stopping all stops the PO too.
  await ui.press({ key: 'parar-todos' })
  expect(await toolOf('a2')).toMatchObject({ deny: expect.stringContaining('paró a este agente') })

  // On pause, the team gets no new agents until resumed.
  await ui.press({ key: 'pausa-todos' })
  expect(await ui.find({ type: 'Text', text: /El equipo está en pausa/ })).toBeDefined()
  expect(await spawn('qa-engineer')).toMatchObject({ deny: expect.stringContaining('en pausa') })
  await ui.press({ key: 'pausa-todos' })
  expect(await spawn('qa-engineer')).toMatchObject({ agentId: 'a3' })

  // One role on pause: only it is refused.
  await ui.press({ key: 'menu-product-owner' })
  await ui.press({ key: 'pausa-product-owner' })
  expect(await spawn('product-owner')).toMatchObject({ deny: expect.stringContaining('Product Owner') })
  expect(await spawn('qa-engineer')).toMatchObject({ agentId: 'a4' })
  await ui.press({ key: 'pausa-product-owner' })
  expect(await spawn('product-owner')).toMatchObject({ agentId: 'a5' })
  await ui.unmount()
})

test('las tarjetas caben en un panel estrecho', async ($, on) => {
  mock.store(on)
  const at = async (bodyColumns: number) => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns } })
    const card = await ui.find({ key: 'tarjeta-business-analyst' })
    await ui.unmount()
    return card?.props
  }
  // Narrow: one card a row, the whole width.
  expect(await at(60)).toMatchObject({ width: 60 })
  // Wide: two a row, each wide enough for its name beside its status.
  expect(await at(80)).toMatchObject({ width: 39 })
})
