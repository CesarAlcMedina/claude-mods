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
    expect(await ui.find({ type: 'Text', text: /Product Owner · 1 min 5 s/ })).toBeDefined()
    // Opening a delivery shows its facts; Ver conversación the whole report.
    await ui.press({ key: 'a1' })
    expect(await ui.find({ type: 'Text', text: /1 herramientas/ })).toBeDefined()
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
  // The pick of who answers a message that names no one.
  const picks: string[] = []
  on('model.complete', (_, e) => {
    picks.push(e.prompt)
    return { value: { isAnswered: true as const, text: '@ux, @qa, @dev', usage } }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-qa-engineer' })
  await ui.input({ key: 'entrada-qa-engineer-0', text: '¿Qué estás haciendo?' })
  expect(prompts[0]).toContain('eres el agente QA del')
  expect(prompts[0]).toContain('Breve por defecto')
  expect(prompts[0]).toContain('no tienes herramientas')
  expect(prompts[0]).toContain('¿Qué estás haciendo?')
  expect(await ui.find({ type: 'Markdown', text: /Respuesta de QA/ })).toBeDefined()

  // A second message carries the chat so far, and the field starts empty.
  expect((await ui.find({ key: 'entrada-qa-engineer-1' }))?.props).toMatchObject({ value: '' })
  await ui.input({ key: 'entrada-qa-engineer-1', text: '¿Y después?' })
  expect(prompts[1]).toContain('Tú: ¿Qué estás haciendo?')
  expect(prompts[1]).toContain('QA: Respuesta de QA.')

  // The way back is under the field too, not only at the top.
  await ui.press({ key: 'volver-abajo' })
  expect(await ui.find({ key: 'chat-grupo' })).toBeDefined()
  await ui.press({ key: 'chat-grupo' })

  // Naming someone asks only them, and they must answer; @dev is both
  // engineers. They answer in turn, each seeing what the others said.
  await ui.input({ key: 'entrada-grupo-0', text: '@po @dev ¿empezamos?' })
  expect(prompts.length).toBe(5)
  expect(prompts[2]).toContain('agente Product Owner')
  expect(prompts[3]).toContain('agente Backend del')
  expect(prompts[4]).toContain('agente Frontend del')
  expect(prompts[2]).not.toContain('PASO')
  expect(prompts[2]).not.toContain('Lo que ya se respondió')
  expect(prompts[4]).toContain('Lo que ya se respondió a este mensaje:\n\nProduct Owner: Respuesta de Product Owner.\n\nBackend: Respuesta de Backend.')

  // Naming nobody, a quick pick chooses who answers: two at most, and the
  // second may pass once it sees the first.
  await ui.input({ key: 'entrada-grupo-1', text: 'Hola equipo' })
  expect(picks.length).toBe(1)
  expect(picks[0]).toContain('Hola equipo')
  expect(prompts.length).toBe(7)
  expect(prompts[5]).toContain('agente Diseño UX/UI')
  expect(prompts[6]).toContain('agente QA')
  expect(prompts[5]).toContain('Aporta solo lo nuevo')
  expect(prompts[5]).not.toContain('PASO')
  expect(prompts[6]).toContain('responde solo con la palabra PASO')
  expect(prompts[6]).toContain('Diseño UX/UI: Respuesta de Diseño UX/UI.')
  expect(await ui.find({ type: 'Markdown', text: /Respuesta de Diseño UX\/UI/ })).toBeDefined()

  // Emptying the chat clears its lines.
  await ui.press({ key: 'vaciar' })
  expect(await ui.find({ type: 'Markdown', text: /Respuesta de/ })).toBeUndefined()

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
  expect(prompts[1]).toContain('la conversación puede terminar ahí')

  await ui.press({ key: 'volver' })
  await ui.press({ key: 'chat-grupo' })
  expect(await ui.find({ type: 'Markdown', text: /^@po ¿qué priorizamos\?$/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /Primero el bloque 2/ })).toBeDefined()

  // Agents who keep naming each other stop after a few hops and answers:
  // QA asks both engineers (@dev); Backend asks QA back, who answers once
  // more, and then Frontend answers, having seen all of it.
  await ui.input({ key: 'entrada-grupo-0', text: '@qa ¿cómo vas?' })
  expect(prompts.length).toBe(6)
  expect(prompts[3]).toContain('agente Backend del')
  expect(prompts[3]).toContain('Mensaje nuevo del agente QA')
  expect(prompts[4]).toContain('agente QA del')
  expect(prompts[4]).toContain('No nombres a otros agentes')
  expect(prompts[5]).toContain('agente Frontend del')
  expect(prompts[5]).toContain('Backend: @qa Casi, ¿y tú?')
  await ui.unmount()
})

test('menos ecos: quién contesta, en qué orden y cuándo callan', async ($, on) => {
  const prompts: string[] = []
  const picks: string[] = []
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  let picked: string | null = ''
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', (_, e) => {
    picks.push(e.prompt)
    return picked === null
      ? { value: { isAnswered: false as const, reason: 'aborted' as const, usage } }
      : { value: { isAnswered: true as const, text: picked, usage } }
  })
  // Each role says something of its own, but Reviewer passes once QA has
  // spoken, and the PO passes a thank-you from another agent.
  on('model.fork', (_, e) => {
    prompts.push(e.prompt)
    const said = (text: string) => ({ value: { isAnswered: true as const, text, usage } })
    if (e.prompt.includes('agente Revisión de código del') && e.prompt.includes('QA: ')) return said('PASO')
    if (e.prompt.includes('agente Product Owner del') && e.prompt.includes('Gracias, queda claro')) return said('PASO')
    if (e.prompt.includes('agente QA del') && e.prompt.includes('confirma con el PO')) return said('@po Gracias, queda claro.')
    const role = /eres el agente ([^ ]+(?: [^ ]+)?) del/.exec(e.prompt)?.[1] ?? '?'
    return said(`Aporte de ${role}.`)
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-grupo' })
  const lines = async (pattern: RegExp) => (await ui.find({ type: 'Markdown', text: pattern })) !== undefined

  // A decision: one agent acknowledges it, with what it is asked to bring.
  picked = '@po: reconocer la decisión y decir el siguiente paso'
  await ui.input({ key: 'entrada-grupo-0', text: 'Decidido: el login va con Google.' })
  expect(picks[0]).toContain('Nunca una ronda de confirmaciones')
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('Lo que se espera de ti en este mensaje (una aportación de chat, no un entregable): reconocer la decisión y decir el siguiente paso.')
  expect(prompts[0]).toContain('Ante una decisión del usuario')

  // Two specialties with different parts: both answer, the second after the first.
  picked = '@backend: el contrato de la API\n@frontend: los estados de la pantalla'
  await ui.input({ key: 'entrada-grupo-1', text: '¿Qué falta para el login?' })
  expect(prompts.length).toBe(3)
  expect(prompts[1]).toContain('agente Backend del')
  expect(prompts[2]).toContain('agente Frontend del')
  expect(prompts[2]).toContain('Lo que se espera de ti en este mensaje (una aportación de chat, no un entregable): los estados de la pantalla.')
  expect(prompts[2]).toContain('Backend: Aporte de Backend.')
  expect(await lines(/Aporte de Frontend/)).toBe(true)

  // Two who would say the same: the second sees the first and passes.
  picked = '@qa: riesgos del login\n@reviewer: riesgos del login'
  await ui.input({ key: 'entrada-grupo-2', text: '¿Qué riesgos ves?' })
  expect(prompts.length).toBe(5)
  expect(prompts[4]).toContain('agente Revisión de código del')
  expect(await lines(/Aporte de QA/)).toBe(true)
  expect(await lines(/^PASO$/)).toBe(false)

  // A direct mention: only that agent, and it must answer.
  await ui.input({ key: 'entrada-grupo-3', text: '@ux ¿cómo queda el botón?' })
  expect(prompts.length).toBe(6)
  expect(prompts[5]).toContain('agente Diseño UX/UI del')
  expect(prompts[5]).not.toContain('PASO')

  // An exchange already settled: QA thanks the PO, and the PO lets it end.
  await ui.input({ key: 'entrada-grupo-4', text: '@qa confirma con el PO' })
  expect(prompts.length).toBe(8)
  expect(prompts[7]).toContain('la conversación puede terminar ahí')
  expect(await lines(/Gracias, queda claro/)).toBe(true)

  // Nothing asked: no one answers, and the chat says so quietly.
  picked = 'NADIE'
  await ui.input({ key: 'entrada-grupo-5', text: 'Vale, gracias' })
  expect(prompts.length).toBe(8)
  expect(await ui.find({ type: 'Text', text: /Nadie tenía nada que añadir/ })).toBeDefined()

  // A question always gets someone, even when the pick says no one.
  await ui.input({ key: 'entrada-grupo-6', text: '¿Y ahora?' })
  expect(prompts.length).toBe(9)
  expect(prompts[8]).toContain('agente Product Owner del')
  expect(prompts[8]).toContain('pedirle la aclaración que haga falta')

  // A failed pick is not "no one": the PO answers.
  picked = null
  await ui.input({ key: 'entrada-grupo-7', text: 'Revisad lo del login' })
  expect(prompts.length).toBe(10)
  expect(prompts[9]).toContain('agente Product Owner del')

  // The pick reads further back than the last few lines.
  expect(picks.at(-1)).toContain('Decidido: el login va con Google.')

  // Without tools, no agent may claim to be editing or testing.
  expect(prompts[9]).toContain('Nunca digas que estás editando, probando')
  expect(prompts[9]).toContain('sugiere pedírselo a Claude')

  // In an agent's own chat, it knows what was decided in the group.
  await ui.press({ key: 'volver-abajo' })
  await ui.press({ key: 'chat-qa-engineer' })
  await ui.input({ key: 'entrada-qa-engineer-0', text: '¿Por dónde empiezas?' })
  expect(prompts[10]).toContain('Lo último del chat de grupo')
  expect(prompts[10]).toContain('Tú: Decidido: el login va con Google.')
  await ui.unmount()
})

test('en una charla larga, lo que dijo el usuario se recuerda más tiempo', async ($, on) => {
  const prompts: string[] = []
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.fork', (_, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true as const, text: `Respuesta ${prompts.length}: ${'x'.repeat(3000)}`, usage } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-qa-engineer' })
  for (const [n, text] of ['Decidido: sin contraseña.', 'Segunda', 'Tercera', 'Cuarta', 'Quinta'].entries()) {
    await ui.input({ key: `entrada-qa-engineer-${n}`, text })
  }
  // The oldest answers are dropped, the person's first decision is not.
  expect(prompts[4]).toContain('Tú: Decidido: sin contraseña.')
  expect(prompts[4]).not.toContain('Respuesta 1:')
  expect(prompts[4]).toContain('Respuesta 4:')
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
