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
    subagentType: 'agent-control-center:product-analyst',
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
    expect(await ui.find({ type: 'Text', text: /Producto y negocio · 1 min 5 s/ })).toBeDefined()
    // Opening a delivery shows its facts; Ver conversación the whole report.
    await ui.press({ key: 'a1' })
    expect(await ui.find({ type: 'Text', text: /1 herramientas/ })).toBeDefined()
    // Opening it also shows what the agent did, in short.
    expect(await ui.find({ type: 'Text', text: /^RESUMEN$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Como usuario quiero entrar$/ })).toBeDefined()
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
    if (e.prompt.includes('eres el Coordinador')) {
      return { value: { isAnswered: true as const, text: 'Respuesta del Coordinador.', usage } }
    }
    const role = /eres el agente ([^ ]+(?: [^ ]+){0,2}) del/.exec(e.prompt)?.[1] ?? '?'
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
  expect(prompts[2]).toContain('agente Producto y negocio')
  expect(prompts[3]).toContain('agente Backend del')
  expect(prompts[4]).toContain('agente Frontend del')
  expect(prompts[2]).not.toContain('PASO')
  expect(prompts[2]).not.toContain('Lo que ya se respondió')
  expect(prompts[4]).toContain('Lo que ya se respondió a este mensaje:\n\nProducto y negocio: Respuesta de Producto y negocio.\n\nBackend: Respuesta de Backend.')

  // Naming nobody, the message goes to the Coordinador: it consults the two
  // at most a quick pick chooses, the second seeing the first, and answers once.
  await ui.input({ key: 'entrada-grupo-1', text: 'Hola equipo' })
  expect(picks.length).toBe(1)
  expect(picks[0]).toContain('Hola equipo')
  expect(prompts.length).toBe(8)
  expect(prompts[5]).toContain('agente Diseño UX/UI')
  expect(prompts[6]).toContain('agente QA')
  expect(prompts[5]).toContain('Aporta solo lo nuevo')
  expect(prompts[5]).not.toContain('PASO')
  expect(prompts[6]).toContain('responde solo con la palabra PASO')
  expect(prompts[6]).toContain('Diseño UX/UI: Respuesta de Diseño UX/UI.')
  expect(prompts[7]).toContain('eres el Coordinador')
  expect(await ui.find({ type: 'Markdown', text: /Respuesta del Coordinador/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /Respuesta de Diseño UX\/UI/ })).toBeUndefined()

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
      : e.prompt.includes('agente Producto y negocio del')
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

test('el Coordinador consulta solo a quien hace falta y contesta una vez', async ($, on) => {
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
  // Each role brings something of its own, but Reviewer passes once QA has
  // spoken, and the PO passes a thank-you from another agent.
  on('model.fork', (_, e) => {
    prompts.push(e.prompt)
    const said = (text: string) => ({ value: { isAnswered: true as const, text, usage } })
    if (e.prompt.includes('eres el Coordinador')) return said(`Síntesis ${prompts.length}.`)
    if (e.prompt.includes('agente Revisión de código del') && e.prompt.includes('QA: ')) return said('PASO')
    if (e.prompt.includes('agente Producto y negocio del') && e.prompt.includes('Gracias, queda claro')) return said('PASO')
    if (e.prompt.includes('agente QA del') && e.prompt.includes('confirma con el PO')) return said('@po Gracias, queda claro.')
    const role = /eres el agente ([^ ]+(?: [^ ]+){0,2}) del/.exec(e.prompt)?.[1] ?? '?'
    return said(`Aporte de ${role}.`)
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-coordinador' })
  const shows = async (pattern: RegExp) => (await ui.find({ type: 'Markdown', text: pattern })) !== undefined

  // A decision: the Coordinador asks one agent, and only it answers the person.
  picked = 'TIPO: otro\n@po: reconocer la decisión y decir el siguiente paso'
  await ui.input({ key: 'entrada-grupo-0', text: 'Decidido: el login va con Google.' })
  expect(picks[0]).toContain('Nunca una ronda de confirmaciones')
  expect(prompts.length).toBe(2)
  expect(prompts[0]).toContain('El Coordinador te consulta')
  expect(prompts[0]).toContain('reconocer la decisión y decir el siguiente paso.')
  expect(prompts[1]).toContain('Sus aportaciones:\n\nProducto y negocio: Aporte de Producto y negocio.')
  expect(await shows(/Síntesis 2/)).toBe(true)
  expect(await shows(/Aporte de Producto y negocio/)).toBe(false)

  // Two specialties with different parts: the second sees the first, and
  // the Coordinador gathers both.
  picked = 'TIPO: otro\n@backend: el contrato de la API\n@frontend: los estados de la pantalla'
  await ui.input({ key: 'entrada-grupo-1', text: '¿Qué falta para el login?' })
  expect(prompts.length).toBe(5)
  expect(prompts[3]).toContain('agente Frontend del')
  expect(prompts[3]).toContain('Backend: Aporte de Backend.')
  expect(prompts[4]).toContain('Backend: Aporte de Backend.\n\nFrontend: Aporte de Frontend.')

  // Two who would say the same: the second passes and is left out.
  picked = 'TIPO: otro\n@qa: riesgos del login\n@reviewer: riesgos del login'
  await ui.input({ key: 'entrada-grupo-2', text: '¿Qué riesgos ves?' })
  expect(prompts.length).toBe(8)
  expect(prompts[7]).toContain('Sus aportaciones:\n\nQA: Aporte de QA.\n\nCómo respondes')
  expect(prompts[7]).not.toContain('Revisión de código: ')

  // A direct mention still goes straight to that agent.
  await ui.input({ key: 'entrada-grupo-3', text: '@ux ¿cómo queda el botón?' })
  expect(prompts.length).toBe(9)
  expect(prompts[8]).toContain('agente Diseño UX/UI del')
  expect(prompts[8]).not.toContain('El Coordinador te consulta')
  expect(await shows(/Aporte de Diseño UX\/UI/)).toBe(true)

  // Agents still talk among themselves, and a settled exchange ends there.
  await ui.input({ key: 'entrada-grupo-4', text: '@qa confirma con el PO' })
  expect(prompts.length).toBe(11)
  expect(prompts[10]).toContain('la conversación puede terminar ahí')

  // Nothing asked: no one is consulted, and the chat says so quietly.
  picked = 'TIPO: otro\nNADIE'
  await ui.input({ key: 'entrada-grupo-5', text: 'Vale, gracias' })
  expect(prompts.length).toBe(11)
  expect(await ui.find({ type: 'Text', text: /Nadie tenía nada que añadir/ })).toBeDefined()

  // A question always gets an answer, and a failed pick is not "no one".
  await ui.input({ key: 'entrada-grupo-6', text: '¿Y ahora?' })
  expect(prompts.length).toBe(13)
  expect(prompts[11]).toContain('pedirle la aclaración que haga falta')
  picked = null
  await ui.input({ key: 'entrada-grupo-7', text: 'Revisad lo del login' })
  expect(prompts.length).toBe(15)
  expect(prompts[13]).toContain('agente Producto y negocio del')

  // Without tools, no one may claim to be editing or testing.
  expect(prompts[14]).toContain('Nunca digas que estás editando, probando')

  // In an agent's own chat, it knows what was decided in the group.
  await ui.press({ key: 'volver-abajo' })
  await ui.press({ key: 'chat-qa-engineer' })
  await ui.input({ key: 'entrada-qa-engineer-0', text: '¿Por dónde empiezas?' })
  expect(prompts[15]).toContain('Lo último del chat de grupo')
  expect(prompts[15]).toContain('Tú: Decidido: el login va con Google.')
  await ui.unmount()
})

test('el Coordinador informa del avance sin lanzar nada y lanza los encargos en la sesión, del recibido al resultado', async ($, on) => {
  const prompts: string[] = []
  const fills: string[] = []
  const submits: string[] = []
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  let picked = 'TIPO: estado'
  let canSubmit = true
  let count = 0
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'test', agentId: `a${++count}` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => {
    if (e.origin.kind === 'plugin') {
      if (!canSubmit) throw new Error('sin sesión')
      submits.push(e.text)
    }
    return { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  // What a working agent last wrote, read from its own conversation.
  on('session.messages', () => ({
    value: [{ role: 'assistant' as const, text: 'Llevo el endpoint de callback; falta la sesión.', toolUses: [] }],
  }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: picked, usage } }))
  on('model.fork', (_, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true as const, text: `Informe ${prompts.length}.`, usage } }
  })
  const spawn = (role: string, description: string) =>
    $.agent.spawn({
      tool_use_id: 't',
      prompt: 'Trabaja',
      description,
      subagentType: `agent-control-center:${role}`,
      provider: PROVIDER,
      parentModel: 'test',
      background: true,
      fork: false,
    })
  const finish = (agentId: string, answer: string) =>
    $.turn.complete({ answer, durationMs: 60000, isAborted: false, turnId: 'u', agentId, reason: 'answer' })
  // A turn of the main session, and its end.
  const mainTurn = async (turnId: string, answer: string) => {
    await $.turn.start({ text: '', turnId })
    return () => $.turn.complete({ answer, durationMs: 1000, isAborted: false, turnId, reason: 'answer' })
  }

  await spawn('product-analyst', 'Historias del login')
  await finish('a1', 'Tres historias listas para el login.')
  await spawn('backend-engineer', 'API del login')

  // Asking how it goes reads what the panel and the agent hold, and starts nothing.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const shows = async (pattern: RegExp) => (await ui.find({ type: 'Markdown', text: pattern })) !== undefined
  // What the panel does once the order is on its way runs on its own.
  const until = async (done: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 200 && !(await done()); i++) await ui.find({ key: 'caja' })
  }
  await ui.press({ key: 'chat-coordinador' })
  await ui.input({ key: 'entrada-grupo-0', text: '¿Cómo va el login?' })
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('eres el Coordinador')
  expect(prompts[0]).toContain('Solo informas: no lanzas agentes')
  expect(prompts[0]).toContain('- Producto y negocio, tarea «Historias del login»: terminado, entregó su informe (1 min')
  expect(prompts[0]).toContain('Resumen de su informe: Tres historias listas para el login.')
  expect(prompts[0]).toContain('- Backend, tarea «API del login»: iniciado, trabaja en ello ahora')
  expect(prompts[0]).toContain('Lo último que escribió: «Llevo el endpoint de callback; falta la sesión.»')
  expect(prompts[0]).toContain('No consta ninguna entrega de QA posterior al desarrollo: nada está verificado.')
  expect(prompts[0]).toContain('verificado (QA lo probó después del desarrollo')
  expect(await shows(/Informe 1/)).toBe(true)
  expect(submits).toEqual([])
  expect(count).toBe(2)

  // Work for one agent: received, and submitted to the main session by the
  // panel itself, with no trip to the main chat and no Enter.
  picked = 'TIPO: encargo\n@reviewer: revisar el login'
  await ui.input({ key: 'entrada-grupo-1', text: 'Revisa el código del login' })
  expect(await shows(/^Recibido\. Se lo encargo a Revisión de código\. Te aviso aquí cuando empiece de verdad/)).toBe(true)
  await until(() => submits.length === 1)
  expect(submits[0]).toContain('Encargo del usuario desde el panel de agentes (encargo ')
  expect(submits[0]).toContain('«Revisa el código del login»')
  expect(submits[0]).toContain('Agente: Revisión de código (agent-control-center:code-reviewer). Lánzalo ahora')
  expect(submits[0]).toContain('sin pedirle que lo repita ni que cambie de chat')
  expect(fills).toEqual([])
  expect(prompts.length).toBe(1)

  // Received is not started: no agent yet, and the Coordinador says so. Its
  // card waits on the agent still at work, from before.
  expect(await ui.find({ type: 'Text', text: /^Revisa el código del login · enviado, sin agentes todavía$/ })).toBeDefined()
  await ui.press({ key: 'volver-abajo' })
  expect(await ui.find({ type: 'Text', text: /^Coordinador · Agente principal$/ })).toBeDefined()
  expect((await ui.find({ key: 'tarjeta-coordinador' }))?.text).toContain('Esperando entregas')
  expect(await ui.find({ type: 'Text', text: /^Espera a Backend · «Revisa el código del login»$/ })).toBeDefined()
  await ui.press({ key: 'chat-coordinador' })
  picked = 'TIPO: estado'
  await ui.input({ key: 'entrada-grupo-2', text: '¿Ya empezó?' })
  expect(prompts[1]).toContain('Estado: la sesión principal lo recibió; todavía no ha empezado ningún agente.')
  expect(prompts[1]).toContain('Para él no ha empezado ningún agente.')
  expect(prompts[1]).not.toContain('Historias del login')

  // The main session launches the agent: now it has started, and says so.
  const firstEnds = await mainTurn('m1', 'Lancé a Revisión en segundo plano.')
  await $.tool.call({ tool: 'Agent', subagent_type: 'agent-control-center:code-reviewer', description: 'Revisar el login', prompt: 'x' } as never)
  await ui.press({ key: 'volver-abajo' })
  expect((await ui.find({ key: 'tarjeta-coordinador' }))?.text).toContain('Coordinando')
  expect(await ui.find({ type: 'Text', text: /^«Revisa el código del login» · lanza a Revisión de código$/ })).toBeDefined()
  await ui.press({ key: 'chat-coordinador' })
  await spawn('code-reviewer', 'Revisar el login')
  expect(await shows(/^Revisión de código ya está trabajando en «Revisar el login»\.$/)).toBe(true)
  // Its turn ends while the agent works: nothing to give yet.
  await firstEnds()
  expect(await shows(/Lancé a Revisión/)).toBe(false)
  picked = 'TIPO: estado'
  await ui.input({ key: 'entrada-grupo-3', text: '¿Cómo va?' })
  expect(prompts[2]).toContain('Estado: ejecución iniciada')
  expect(prompts[2]).toContain('- Revisión de código, tarea «Revisar el login»: iniciado')

  // The agent delivers in the chat it was asked in, and the main session's
  // next turn, on its hand-back, brings the result.
  await finish('a3', 'El login está bien.')
  expect(await shows(/^Terminé «Revisar el login»\.\n\nEl login está bien\.$/)).toBe(true)
  await $.prompt.submit({ text: '<agent-message from="a3">…</agent-message>', wait: false, origin: { kind: 'peer' } })
  const lastEnds = await mainTurn('m2', 'Revisión: el login está bien.')
  await lastEnds()
  expect(await shows(/^Revisión: el login está bien\.$/)).toBe(true)
  // The result is the Coordinador's delivery, kept with the agents' ones.
  await ui.press({ key: 'volver-abajo' })
  expect(await ui.find({ type: 'Text', text: /^Coordinador · \d/ })).toBeDefined()
  await ui.press({ key: 'entrega-coordinador' })
  expect(await ui.find({ type: 'Text', text: /^Revisión: el login está bien\.$/ })).toBeDefined()

  // Research is the Coordinador's own: it does it in the main session, an
  // old name of Investigación's included, and the panel follows what it
  // really does.
  await ui.press({ key: 'chat-coordinador' })
  picked = 'TIPO: encargo\n@research: investigar Acme y Globex'
  await ui.input({ key: 'entrada-grupo-4', text: 'Investiga estas empresas: Acme y Globex' })
  expect(await shows(/^Recibido\. Me encargo yo de investigarlo\./)).toBe(true)
  await until(() => submits.length === 2)
  expect(submits[1]).toContain('Es una investigación: hazla tú, el Coordinador, según «Investigación» de la skill agent-control-center:coordinador')
  expect(submits[1]).toContain('sin lanzar ningún subagente para ella')
  expect(submits[1]).not.toContain('research-agent')
  const research = await mainTurn('m9', 'Acme fabrica cohetes; Globex vende software. Guardado en `docs/investigaciones/2026-10-23-acme-globex.md`.')
  await $.tool.call({ tool: 'Read', file_path: '/p/docs/investigaciones/indice.md' } as never)
  expect(await shows(/^Estoy investigando «Investiga estas empresas: Acme y Globex»\.$/)).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^Coordinador lee indice\.md…$/ })).toBeDefined()
  await $.tool.call({ tool: 'WebSearch', query: 'Acme cohetes' } as never)
  await ui.press({ key: 'volver-abajo' })
  expect((await ui.find({ key: 'tarjeta-coordinador' }))?.text).toContain('Investigando')
  expect(await ui.find({ type: 'Text', text: /^«Investiga estas empresas: Acme y Globex» · busca en la web «Acme cohetes»$/ })).toBeDefined()
  await $.tool.call({ tool: 'Write', file_path: '/p/docs/investigaciones/2026-10-23-acme-globex.md', content: 'x' } as never)
  expect(await ui.find({ type: 'Text', text: /· guarda 2026-10-23-acme-globex\.md$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^3 herramientas$/ })).toBeDefined()
  await research()
  expect((await ui.find({ key: 'tarjeta-coordinador' }))?.text).toContain('Esperando entregas')
  expect(await ui.find({ type: 'Text', text: /^Última entrega \(2\)$/ })).toBeDefined()
  await ui.press({ key: 'chat-coordinador' })
  expect(await shows(/Guardado en `docs\/investigaciones\/2026-10-23-acme-globex\.md`/)).toBe(true)
  expect(await shows(/La sesión principal contestó sin lanzar/)).toBe(false)

  // A main session that answers without launching anyone says so.
  picked = 'TIPO: encargo'
  await ui.input({ key: 'entrada-grupo-5', text: 'Quiero exportar las reservas a PDF' })
  expect(await shows(/^Recibido\. Lo llevo al flujo del equipo\./)).toBe(true)
  await until(() => submits.length === 3)
  expect(submits[2]).toContain('No nombra agente: elige tú a quién lanzar y, si es una funcionalidad nueva, sigue el recorrido «Nueva función» de la skill agent-control-center:coordinador.')
  const alone = await mainTurn('m3', 'Necesito saber en qué formato.')
  await alone()
  expect(await shows(/^La sesión principal contestó sin lanzar a ningún agente:\n\nNecesito saber en qué formato\.$/)).toBe(true)

  // Something the person types in the main chat is theirs, not the panel's.
  picked = 'TIPO: encargo\n@qa: probar la exportación'
  await ui.input({ key: 'entrada-grupo-6', text: 'Prueba la exportación' })
  await until(() => submits.length === 4)
  await $.prompt.submit({ text: 'otra cosa', wait: false, origin: { kind: 'composer' } })
  await spawn('devops-engineer', 'Algo mío')
  expect(await shows(/DevOps ya está trabajando/)).toBe(false)

  // With no session to take it, the panel says it did not start.
  canSubmit = false
  picked = 'TIPO: encargo\n@qa: probar'
  await ui.input({ key: 'entrada-grupo-7', text: 'Añade recordatorios por correo' })
  await until(() => shows(/No pude enviar el encargo a la sesión principal, así que no ha empezado/))
  expect(await shows(/No pude enviar el encargo a la sesión principal, así que no ha empezado/)).toBe(true)
  expect(fills.at(-1)).toContain('«Añade recordatorios por correo»')
  await ui.unmount()
})

test('un encargo en el chat de un agente, o con @ en el grupo, llega al Coordinador y se lanza', async ($, on) => {
  const prompts: string[] = []
  const submits: string[] = []
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  let count = 0
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'test', agentId: `a${++count}` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => {
    if (e.origin.kind === 'plugin') submits.push(e.text)
    return { text: e.text }
  })
  let picked = 'TIPO: otro\n@po: opinar'
  on('model.complete', () => ({ value: { isAnswered: true as const, text: picked, usage } }))
  on('model.fork', (_, e) => {
    prompts.push(e.prompt)
    const said = (text: string) => ({ value: { isAnswered: true as const, text, usage } })
    if (e.prompt.includes('eres el Coordinador')) return said('Lo investigo yo.\nENCARGO: @research compara los precios de Acme y Globex y consulta a @qa qué probar')
    if (e.prompt.includes('agente QA del')) return said('Se lo paso al Coordinador para que me lance.\nENCARGO: Prueba el login con tres usuarios')
    if (e.prompt.includes('agente Backend del')) return said('Eso lo investiga el Coordinador.\nENCARGO: @coordinador investiga la librería pdfkit')
    return said('Opinión del PO.')
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const shows = async (pattern: RegExp) => (await ui.find({ type: 'Markdown', text: pattern })) !== undefined
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) await ui.find({ key: 'caja' })
  }

  // In its own chat: QA hands the work on, and its line is not shown as is.
  await ui.press({ key: 'chat-qa-engineer' })
  await ui.input({ key: 'entrada-qa-engineer-0', text: 'Prueba el login' })
  expect(prompts[0]).toContain('añade al final una línea que empiece por «ENCARGO:»')
  expect(prompts[0]).toContain('la línea es «ENCARGO: @coordinador la investigación»')
  expect(prompts[0]).toContain('Nunca le digas al usuario que vaya al chat principal')
  expect(prompts[0]).not.toContain('chat principal;')
  expect(await shows(/^Se lo paso al Coordinador para que me lance\.\n\n_Se lo pasé al Coordinador como encargo: «Prueba el login con tres usuarios»_$/)).toBe(true)
  expect(await shows(/^Recibido\. Se lo encargo a QA\./)).toBe(true)
  await until(() => submits.length === 1)
  expect(submits[0]).toContain('«Prueba el login con tres usuarios»')
  expect(submits[0]).toContain('Agente: QA (agent-control-center:qa-engineer)')
  await $.prompt.submit({ text: submits[0] ?? '', wait: false, origin: { kind: 'plugin', name: 'panel-agentes' } })
  await $.agent.spawn({
    tool_use_id: 't',
    prompt: 'Prueba',
    description: 'Probar el login',
    subagentType: 'agent-control-center:qa-engineer',
    provider: PROVIDER,
    parentModel: 'test',
    background: false,
    fork: false,
  })
  // It started, and hears so in its own chat.
  expect(await shows(/^QA ya está trabajando en «Probar el login»\.$/)).toBe(true)

  // Research asked of a specialist in its chat goes to the Coordinador.
  await ui.press({ key: 'volver-abajo' })
  await ui.press({ key: 'chat-backend-engineer' })
  await ui.input({ key: 'entrada-backend-engineer-0', text: 'Investiga pdfkit' })
  expect(await shows(/_Se lo pasé al Coordinador como encargo: «investiga la librería pdfkit»_/)).toBe(true)
  expect(await shows(/^Recibido\. Me encargo yo de investigarlo\./)).toBe(true)
  await until(() => submits.length === 2)
  expect(submits.at(-1)).toContain('Es una investigación: hazla tú, el Coordinador')
  expect(submits.at(-1)).not.toContain('backend-engineer)')

  // Investigación named by an old name in the group reaches the Coordinador,
  // who does it himself.
  await ui.press({ key: 'volver-abajo' })
  await ui.press({ key: 'chat-grupo' })
  picked = 'TIPO: encargo'
  await ui.input({ key: 'entrada-grupo-0', text: '@research investiga pdfkit' })
  expect(await shows(/^Recibido\. Me encargo yo de investigarlo\./)).toBe(true)
  await until(() => submits.length === 3)
  expect(submits.at(-1)).toContain('«@research investiga pdfkit»')
  expect(submits.at(-1)).toContain('Es una investigación: hazla tú, el Coordinador')
  expect(submits.at(-1)).not.toContain('research-agent')
  // The work under way shows above the conversation.
  expect(await ui.find({ key: 'ver-pendiente' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^@research investiga pdfkit$/ })).toBeDefined()
  // The turn the order starts says which request it is, even with no
  // prompt.submit of it seen: the Coordinador's research ends it and is its
  // delivery.
  await $.prompt.submit({ text: 'otra cosa', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: submits.at(-1) ?? '', turnId: 'r1' })
  await $.tool.call({ tool: 'WebSearch', query: 'pdfkit license' } as never)
  expect(await shows(/^Estoy investigando «investiga pdfkit»\.$/)).toBe(true)
  await $.turn.complete({ answer: 'pdfkit es MIT. Guardado en docs/investigaciones/2026-10-23-pdfkit.md.', durationMs: 1000, isAborted: false, turnId: 'r1', reason: 'answer' })
  expect(await shows(/^pdfkit es MIT\. Guardado en docs\/investigaciones\/2026-10-23-pdfkit\.md\.$/)).toBe(true)
  await ui.press({ key: 'volver' })
  expect((await ui.find({ key: 'tarjeta-coordinador' }))?.text).toContain('Última entrega')
  await ui.press({ key: 'chat-grupo' })

  // Taken for a question, the Coordinador still sees work in it and takes it.
  picked = 'TIPO: otro\n@po: opinar'
  await ui.input({ key: 'entrada-grupo-1', text: '¿Me miras los precios de Acme y Globex?' })
  expect(await shows(/^Lo investigo yo\.\n\nRecibido\. Me encargo yo de investigarlo\./)).toBe(true)
  await until(() => submits.length === 4)
  expect(submits.at(-1)).toContain('«compara los precios de Acme y Globex y consulta a @qa qué probar»')
  // Only the alias that opens the line does the work.
  expect(submits.at(-1)).not.toContain('qa-engineer)')
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
  await spawn('product-analyst')
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
  await ui.press({ key: 'menu-product-analyst' })
  await ui.press({ key: 'pausa-product-analyst' })
  expect(await spawn('product-analyst')).toMatchObject({ deny: expect.stringContaining('Producto y negocio') })
  expect(await spawn('qa-engineer')).toMatchObject({ agentId: 'a4' })
  await ui.press({ key: 'pausa-product-analyst' })
  expect(await spawn('product-analyst')).toMatchObject({ agentId: 'a5' })
  await ui.unmount()
})

test('al reanudar, el trabajo que cortó la pausa sigue donde se quedó', async ($, on) => {
  const fills: string[] = []
  const submits: string[] = []
  let canSubmit = true
  let count = 0
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', (_, e) => ({ model: 'test', agentId: e.resume?.agentId ?? `a${++count}` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => {
    if (!canSubmit) throw new Error('sin sesión')
    submits.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  const base = {
    tool_use_id: 't',
    prompt: 'Trabaja',
    subagentType: 'agent-control-center:qa-engineer',
    provider: PROVIDER,
    parentModel: 'test',
    background: false,
    fork: false,
  } as const
  const toolOf = (agentId: string) => {
    const fromAgent = { tool: 'Read', file_path: '/a.md', agentId } as const
    return $.tool.call(fromAgent)
  }

  await $.agent.spawn({ ...base, description: 'Validar bloque 2' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) await ui.find({ key: 'tarjeta-coordinador' })
  }

  // Paused, QA is told to stop and say where it left off.
  await ui.press({ key: 'pausa-todos' })
  expect(await toolOf('a1')).toMatchObject({ deny: expect.stringContaining('dónde lo dejaste') })
  await $.turn.complete({ answer: 'Validé los casos 1 a 4; faltan del 5 al 9.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a1', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: /El equipo está en pausa/ })).toBeDefined()

  // Resumed, its work goes back to the main session to go on from there,
  // sent by the panel itself.
  await ui.press({ key: 'pausa-todos' })
  await until(() => submits.length === 1)
  expect(submits[0]).toContain('Reanuda el trabajo que quedó en pausa')
  expect(submits[0]).toContain('QA (agente a1), tarea «Validar bloque 2». Dónde lo dejó: Validé los casos 1 a 4; faltan del 5 al 9.')
  expect(fills).toEqual([])
  expect(await ui.find({ type: 'Markdown', text: /Reanudando: QA sigue donde lo dejó/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Listo para seguir/ })).toBeDefined()

  // The same agent goes on: its tools work again, and the notice goes.
  await $.agent.spawn({ ...base, description: 'Validar bloque 2', resume: { agentId: 'a1' } })
  expect(await toolOf('a1')).toMatchObject({ result: {} })
  expect(await ui.find({ type: 'Markdown', text: /Reanudando/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Listo para seguir/ })).toBeUndefined()

  // A role paused on its own resumes the same way; with no session to take
  // the order, it waits in the prompt box instead.
  canSubmit = false
  await ui.press({ key: 'menu-qa-engineer' })
  await ui.press({ key: 'pausa-qa-engineer' })
  await $.turn.complete({ answer: 'Casos 5 y 6 hechos.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a1', reason: 'answer' })
  await ui.press({ key: 'pausa-qa-engineer' })
  await until(() => fills.length === 1)
  expect(fills[0]).toContain('Casos 5 y 6 hechos.')
  for (let i = 0; i < 200 && (await ui.find({ type: 'Markdown', text: /te dejé la orden en la caja/ })) === undefined; i++) {
    // the fallback runs in its own dispatch
  }
  expect(await ui.find({ type: 'Markdown', text: /te dejé la orden en la caja del chat principal/ })).toBeDefined()
  // With nothing cut short, no order.
  await ui.press({ key: 'pausa-qa-engineer' })
  await ui.press({ key: 'pausa-qa-engineer' })
  expect(fills.length).toBe(1)
  expect(submits.length).toBe(1)
  await ui.unmount()
})

test('las tarjetas caben en un panel estrecho', async ($, on) => {
  mock.store(on)
  const at = async (bodyColumns: number) => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns } })
    const card = await ui.find({ key: 'tarjeta-qa-engineer' })
    await ui.unmount()
    return card?.props
  }
  // Narrow: one card a row, the whole width.
  expect(await at(60)).toMatchObject({ width: 60 })
  // Wide: two a row, each wide enough for its name beside its status.
  expect(await at(80)).toMatchObject({ width: 39 })
})

test('configurar equipo: elegir, cancelar, quitar, incorporar, ocupados, vacío y reabrir', async ($, on) => {
  const contexts: (readonly string[] | undefined)[] = []
  let count = 0
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', (_, e) => ({ model: 'test', agentId: e.resume?.agentId ?? `a${++count}` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => {
    contexts.push(e.context)
    return { text: e.text }
  })
  const spawn = (role: string, resume?: string) =>
    $.agent.spawn({
      tool_use_id: 't',
      prompt: 'Trabaja',
      description: `Tarea de ${role}`,
      subagentType: `agent-control-center:${role}`,
      provider: PROVIDER,
      parentModel: 'test',
      background: false,
      fork: false,
      ...(resume ? { resume: { agentId: resume } } : {}),
    })
  const submit = () => $.prompt.submit({ text: 'sigue', wait: false, origin: { kind: 'composer' } })
  const toggle = async (ui: { press: (target: { key: string }) => Promise<unknown> }, roles: string[]) => {
    for (const role of roles) await ui.press({ key: `casilla-${role}` })
  }
  const OTHERS = ['ux-ui-designer', 'backend-engineer', 'frontend-engineer', 'code-reviewer', 'devops-engineer']

  // With no team chosen, everyone takes part, as before.
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /el Coordinador y los 7 especialistas \(sin configurar\)/ })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-coordinador' })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-research-agent' })).toBeUndefined()
  expect(await ui.find({ key: 'tarjeta-devops-engineer' })).toBeDefined()
  await submit()
  expect(contexts.at(-1)).toBeUndefined()

  // Cancelling leaves the team as it was.
  await ui.press({ key: 'configurar-equipo' })
  expect(await ui.find({ type: 'Text', text: /7 de 7 especialistas seleccionados/ })).toBeDefined()
  // The Coordinador is in every team, with no box of its own; Investigación is gone.
  expect(await ui.find({ type: 'Text', text: /El Coordinador participa siempre/ })).toBeDefined()
  expect(await ui.find({ key: 'casilla-coordinador' })).toBeUndefined()
  expect(await ui.find({ key: 'casilla-research-agent' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /reglas de negocio y criterios de aceptación verificables/ })).toBeDefined()
  await toggle(ui, OTHERS)
  expect(await ui.find({ type: 'Text', text: /2 de 7 especialistas seleccionados/ })).toBeDefined()
  await ui.press({ key: 'cancelar-equipo' })
  expect(await ui.find({ type: 'Text', text: /sin configurar/ })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-devops-engineer' })).toBeDefined()

  // A subset: only Producto y negocio and QA, as cards and for new work.
  await ui.press({ key: 'configurar-equipo' })
  await toggle(ui, OTHERS)
  await ui.press({ key: 'confirmar-equipo' })
  expect(await ui.find({ type: 'Text', text: /el Coordinador y 2 de 7 especialistas/ })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-qa-engineer' })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-devops-engineer' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Todos/ })).toBeDefined()
  expect(await spawn('devops-engineer')).toMatchObject({ deny: expect.stringContaining('DevOps no está en el equipo de esta sesión') })
  expect(await spawn('qa-engineer')).toMatchObject({ agentId: 'a1' })
  // The main session hears of the team once, with its next prompt.
  await submit()
  expect(contexts.at(-1)?.join(' ')).toContain('Equipo activo de esta sesión, elegido por el usuario en el panel de agentes: Producto y negocio y QA.')
  await submit()
  expect(contexts.at(-1)).toBeUndefined()

  // Reopening the panel keeps the team.
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /el Coordinador y 2 de 7 especialistas/ })).toBeDefined()

  // Taking off a working agent asks first, and never cuts its task.
  await ui.press({ key: 'configurar-equipo' })
  expect(await ui.find({ type: 'Text', text: /QA · trabajando/ })).toBeDefined()
  await toggle(ui, ['qa-engineer'])
  await ui.press({ key: 'confirmar-equipo' })
  expect(await ui.find({ type: 'Text', text: /QA está trabajando ahora y su tarea no se cancela/ })).toBeDefined()
  await ui.press({ key: 'retirar-al-terminar' })
  expect(await ui.find({ type: 'Text', text: /Se retira al terminar/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /el Coordinador y 1 de 7 especialistas/ })).toBeDefined()
  const fromQa = { tool: 'Read', file_path: '/a.md', agentId: 'a1' } as const
  expect(await $.tool.call(fromQa)).toMatchObject({ result: {} })
  expect(await spawn('qa-engineer')).toMatchObject({ deny: expect.stringContaining('QA no está en el equipo') })
  await submit()
  expect(contexts.at(-1)?.join(' ')).toContain('QA sale del equipo: termina lo que tiene y no le des trabajo nuevo.')
  await $.turn.complete({ answer: 'Plan listo.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a1', reason: 'answer' })
  expect(await ui.find({ key: 'tarjeta-qa-engineer' })).toBeUndefined()
  // Its delivery stays.
  expect(await ui.find({ type: 'Text', text: /Tarea de qa-engineer/ })).toBeDefined()

  // Bringing one in; or keeping a working one.
  await spawn('product-analyst')
  await ui.press({ key: 'configurar-equipo' })
  await toggle(ui, ['devops-engineer', 'product-analyst'])
  await ui.press({ key: 'confirmar-equipo' })
  await ui.press({ key: 'mantener-ocupados' })
  expect(await ui.find({ type: 'Text', text: /el Coordinador y 2 de 7 especialistas/ })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-product-analyst' })).toBeDefined()
  expect(await spawn('devops-engineer')).toMatchObject({ agentId: 'a3' })
  await submit()
  expect(contexts.at(-1)?.join(' ')).toContain('DevOps se acaba de incorporar')
  await ui.press({ key: 'chat-grupo' })
  expect(await ui.find({ type: 'Text', text: /Equipo de esta sesión: Producto y negocio y QA\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /QA sale del equipo al terminar su tarea\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /QA terminó su tarea y salió del equipo\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /DevOps se incorporó al equipo\./ })).toBeDefined()
  await ui.press({ key: 'volver' })

  // An empty team: nobody gets work, and the panel offers to configure.
  await ui.press({ key: 'configurar-equipo' })
  await toggle(ui, ['product-analyst', 'devops-engineer'])
  await ui.press({ key: 'confirmar-equipo' })
  await ui.press({ key: 'retirar-al-terminar' })
  await $.turn.complete({ answer: 'Hecho.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a2', reason: 'answer' })
  await $.turn.complete({ answer: 'Hecho.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a3', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: /No hay especialistas en el equipo de esta sesión/ })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-coordinador' })).toBeDefined()
  expect(await spawn('product-analyst')).toMatchObject({ deny: expect.stringContaining('ahora no hay ningún agente') })
  // A resumed agent finishes what it had, team or not.
  expect(await spawn('devops-engineer', 'a3')).toMatchObject({ agentId: 'a3' })
  await ui.press({ key: 'configurar-equipo-vacio' })
  expect(await ui.find({ type: 'Text', text: /0 de 7 especialistas seleccionados/ })).toBeDefined()
  await ui.press({ key: 'cancelar-equipo' })
  await ui.unmount()
})

test('solo el equipo participa en los chats, y a un agente fuera se le ofrece incorporarse antes de escribirle', async ($, on) => {
  const prompts: string[] = []
  const picks: string[] = []
  const submits: string[] = []
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  let picked = ''
  let qaSays = 'Respuesta de QA.'
  let count = 0
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'test', agentId: `a${++count}` }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => {
    if (e.origin.kind === 'plugin') submits.push(e.text)
    return { text: e.text }
  })
  on('model.complete', (_, e) => {
    picks.push(e.prompt)
    return { value: { isAnswered: true as const, text: picked, usage } }
  })
  on('model.fork', (_, e) => {
    prompts.push(e.prompt)
    if (e.prompt.includes('eres el Coordinador')) return { value: { isAnswered: true as const, text: 'Respuesta del Coordinador.', usage } }
    if (e.prompt.includes('agente QA del')) return { value: { isAnswered: true as const, text: qaSays, usage } }
    const role = /eres el agente ([^ ]+(?: [^ ]+){0,2}) del/.exec(e.prompt)?.[1] ?? '?'
    return { value: { isAnswered: true as const, text: `Respuesta de ${role}.`, usage } }
  })
  const asked = (label: string) => prompts.filter(one => one.includes(`eres el agente ${label} del`))
  const coordinator = () => prompts.filter(one => one.includes('eres el Coordinador')).at(-1) ?? ''

  // The PO delivered before the team was chosen.
  await $.agent.spawn({
    tool_use_id: 't',
    prompt: 'Trabaja',
    description: 'Historias del login',
    subagentType: 'agent-control-center:product-analyst',
    provider: PROVIDER,
    parentModel: 'test',
    background: false,
    fork: false,
  })
  await $.turn.complete({ answer: 'Tres historias listas.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a1', reason: 'answer' })

  // The team: PO and QA.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'configurar-equipo' })
  for (const role of ['ux-ui-designer', 'backend-engineer', 'frontend-engineer', 'code-reviewer', 'devops-engineer']) {
    await ui.press({ key: `casilla-${role}` })
  }
  await ui.press({ key: 'confirmar-equipo' })
  await ui.press({ key: 'chat-grupo' })

  // The pick sees only the team; one it names out of it is proposed, not consulted.
  picked = 'TIPO: otro\n@qa: riesgos de la prueba\n@devops: el pipeline'
  await ui.input({ key: 'entrada-grupo-0', text: '¿Qué riesgos ves para sacar el login?' })
  expect(picks.at(-1)).toContain('@qa: QA')
  // The Coordinador is always there to pick, for research.
  expect(picks.at(-1)).toContain('@coordinador: Coordinador, la sesión principal')
  expect(picks.at(-1)).toContain('Una investigación (buscar información, consultar documentación o fuentes, comparar opciones, redactar un informe) es siempre del Coordinador')
  expect(picks.at(-1)).not.toContain('@ux: Diseño UX/UI')
  expect(picks.at(-1)).toContain('Fuera del equipo de esta sesión')
  expect(picks.at(-1)).toContain('@devops (DevOps)')
  expect(asked('QA').length).toBe(1)
  expect(asked('QA')[0]).toContain('Producto y negocio (@producto), QA (@qa)')
  expect(asked('QA')[0]).not.toContain('DevOps (@devops)')
  expect(asked('DevOps').length).toBe(0)
  expect(coordinator()).toContain('Equipo activo de esta sesión, elegido por el usuario: Producto y negocio y QA.')
  expect(coordinator()).toContain('haría falta DevOps, que no está en el equipo activo')
  expect(await ui.find({ type: 'Text', text: /DevOps no está en el equipo de esta sesión/ })).toBeDefined()
  await ui.press({ key: 'no-incorporar' })
  expect(await ui.find({ type: 'Text', text: /DevOps sigue fuera del equipo\./ })).toBeDefined()
  expect(await ui.find({ key: 'incorporar' })).toBeUndefined()

  // Research is never a missing specialty: the Coordinador does it.
  picked = 'TIPO: otro\n@po: el valor\nFUERA: @research'
  await ui.input({ key: 'entrada-grupo-1', text: '¿Qué librería de PDF usamos?' })
  expect(coordinator()).not.toContain('haría falta')
  expect(await ui.find({ type: 'Text', text: /Investigación no está en el equipo/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Coordinador no está en el equipo/ })).toBeUndefined()

  // A pick that fails falls to the PO, in the team.
  picked = ''
  await ui.input({ key: 'entrada-grupo-2', text: '¿Y el plazo?' })
  expect(asked('Producto y negocio').length).toBe(2)

  // Naming one out of the team: offered first, then it gets the message, with the session's context.
  const before = prompts.length
  await ui.input({ key: 'entrada-grupo-3', text: '@devops ¿cómo desplegamos esto?' })
  expect(prompts.length).toBe(before)
  expect(await ui.find({ type: 'Text', text: /DevOps no está en el equipo de esta sesión\. ¿Lo incorporo y le paso el mensaje\?/ })).toBeDefined()
  await ui.press({ key: 'incorporar' })
  expect(asked('DevOps').length).toBe(1)
  expect(asked('DevOps')[0]).toContain('@devops ¿cómo desplegamos esto?')
  expect(asked('DevOps')[0]).toContain('Te incorporaste al equipo con la sesión ya empezada')
  expect(asked('DevOps')[0]).toContain('- Producto y negocio, tarea «Historias del login»: Tres historias listas.')
  expect(await ui.find({ type: 'Markdown', text: /Respuesta de DevOps/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /DevOps se incorporó al equipo\./ })).toBeDefined()

  // An agent naming one out of the team: offered, not asked.
  qaSays = '@ux ¿el botón de Google va arriba?'
  await ui.input({ key: 'entrada-grupo-4', text: '@qa ¿qué pruebas primero?' })
  expect(asked('Diseño UX/UI').length).toBe(0)
  expect(await ui.find({ type: 'Text', text: /Diseño UX\/UI no está en el equipo de esta sesión\. ¿Lo incorporo y le paso el mensaje\?/ })).toBeDefined()
  await ui.press({ key: 'no-incorporar' })

  // From its own chat, a line for the group naming one out of the team: the same.
  qaSays = 'Lo consulto.\nAL GRUPO: @reviewer ¿revisaste el callback?'
  await ui.press({ key: 'volver' })
  await ui.press({ key: 'chat-qa-engineer' })
  await ui.input({ key: 'entrada-qa-engineer-0', text: 'Pregúntale a revisión' })
  expect(asked('Revisión de código').length).toBe(0)
  await ui.press({ key: 'volver' })
  await ui.press({ key: 'chat-grupo' })
  expect(await ui.find({ type: 'Text', text: /Revisión de código no está en el equipo/ })).toBeDefined()

  const until = async (done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) await ui.find({ key: 'caja' })
  }

  // A new function goes to the main session with the team named.
  picked = 'TIPO: funcion'
  await ui.input({ key: 'entrada-grupo-5', text: 'Quiero exportar a PDF' })
  await until(() => submits.length === 1)
  expect(submits.at(-1)).toContain('Equipo activo de esta sesión: Producto y negocio, QA y DevOps. Usa solo esos agentes')
  expect(await ui.find({ type: 'Markdown', text: /Lo llevo al flujo con el equipo de esta sesión \(Producto y negocio, QA y DevOps\)/ })).toBeDefined()

  // Work only one out of the team can do: offered first, then launched.
  picked = 'TIPO: encargo\n@reviewer: revisar el exportador'
  await ui.input({ key: 'entrada-grupo-6', text: 'Revisa el exportador' })
  expect(submits.length).toBe(1)
  expect(await ui.find({ type: 'Markdown', text: /Esto le toca a Revisión de código, que no está en el equipo de esta sesión/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /¿Lo incorporo y le paso el encargo\?/ })).toBeDefined()
  await ui.press({ key: 'incorporar' })
  await until(() => submits.length === 2)
  expect(submits.at(-1)).toContain('«Revisa el exportador»')
  expect(submits.at(-1)).toContain('Agente: Revisión de código (agent-control-center:code-reviewer)')

  // With no one in the team, the Coordinador answers alone and hands nothing on.
  await ui.press({ key: 'volver' })
  await ui.press({ key: 'configurar-equipo' })
  for (const role of ['product-analyst', 'qa-engineer', 'devops-engineer', 'code-reviewer']) await ui.press({ key: `casilla-${role}` })
  await ui.press({ key: 'confirmar-equipo' })
  await ui.press({ key: 'chat-grupo' })
  const consulted = prompts.filter(one => one.includes('eres el agente')).length
  picked = 'NADIE'
  await ui.input({ key: 'entrada-grupo-7', text: '¿Quién puede ayudarme?' })
  expect(prompts.filter(one => one.includes('eres el agente')).length).toBe(consulted)
  expect(coordinator()).toContain('no consultaste a ningún agente')
  expect(coordinator()).toContain('Configurar equipo')
  picked = 'TIPO: funcion'
  const handed = submits.length
  await ui.input({ key: 'entrada-grupo-8', text: 'Quiero exportar a Excel' })
  expect(submits.length).toBe(handed)
  expect(await ui.find({ type: 'Markdown', text: /No hay ningún agente en el equipo de esta sesión/ })).toBeDefined()
  // Research still goes: the Coordinador needs no specialist for it.
  picked = 'TIPO: encargo\n@coordinador: investigar formatos de Excel'
  await ui.input({ key: 'entrada-grupo-9', text: 'Investiga formatos de Excel' })
  await until(() => submits.length === handed + 1)
  expect(submits.at(-1)).toContain('Es una investigación: hazla tú, el Coordinador')
  await ui.unmount()
})

test('la barra del límite de 5 h: sin datos, 0 %, intermedio, límite, desactualizada y vencida', async ($, on) => {
  const HOUR = 3_600_000
  const START = Date.parse('2026-10-21T12:00:00Z')
  let now = START
  let usage: { kind: string; percentUsed: number; resetsAt?: string }[] = []
  const periods: (() => void)[] = []
  const at = (ms: number) => new Date(ms).toISOString()
  const context = { window: 200000 }
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.now', () => ({ value: now }))
  on('session.usage', () => ({ value: { startedAt: START, context, rateLimits: usage } }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  // The countdown's timer: each period waits until the test lets it pass.
  on('clock.every', () => new Promise(resolve => periods.push(() => resolve({ value: undefined }))))
  const measure = (rateLimits: typeof usage) => $.session.measure({ context, rateLimits, changed: ['rateLimits'] })

  // No reading yet: nothing made up, and the weekly window is never shown.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // One period of the timer, then the pane once it redrew with what it brings.
  const tickOnce = async (shows: RegExp) => {
    periods.shift()?.()
    for (let i = 0; i < 200 && (await ui.find({ type: 'Text', text: shows })) === undefined; i++) {
      // the tick runs in its own dispatch
    }
  }
  expect(await ui.find({ type: 'Text', text: /^Límite de sesión · 5 h$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Uso no disponible$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^—$/ })).toBeDefined()
  await measure([{ kind: 'seven_day', percentUsed: 80, resetsAt: at(START + 72 * HOUR) }])
  expect(await ui.find({ type: 'Text', text: /^Uso no disponible$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /80/ })).toBeUndefined()

  // 0 % is a real reading.
  await measure([{ kind: 'five_hour', percentUsed: 0, resetsAt: at(START + 2 * HOUR) }])
  expect(await ui.find({ type: 'Text', text: /^0 %$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Se restablece en 2 h$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^░{36}$/ })).toBeDefined()

  // Partway: 37.5 % of 36 cells.
  await measure([
    { kind: 'five_hour', percentUsed: 37.5, resetsAt: at(START + 2 * HOUR) },
    { kind: 'seven_day', percentUsed: 80, resetsAt: at(START + 72 * HOUR) },
  ])
  expect(await ui.find({ type: 'Text', text: /^37,5 %$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^█{14}$/ })).toBeDefined()

  // The countdown moves on its timer, with no new reading and no model call.
  now = START + 10 * 60_000
  await tickOnce(/^Se restablece en 1 h 50 min$/)
  expect(await ui.find({ type: 'Text', text: /^Se restablece en 1 h 50 min$/ })).toBeDefined()

  // The limit reached.
  await measure([{ kind: 'five_hour', percentUsed: 100, resetsAt: at(START + 2 * HOUR) }])
  expect(await ui.find({ type: 'Text', text: /^100 %$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Límite alcanzado · Se restablece en 1 h 50 min$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^█{36}$/ })).toBeDefined()

  // No new reading for a while: it says how old it is. The timer's reread
  // finds the same figures, which does not make them fresh.
  usage = [{ kind: 'five_hour', percentUsed: 100, resetsAt: at(START + 2 * HOUR) }]
  now = START + 40 * 60_000
  await tickOnce(/^Límite alcanzado · Se restablece en 1 h 20 min · datos de hace 30 min$/)
  expect(await ui.find({ type: 'Text', text: /^Límite alcanzado · Se restablece en 1 h 20 min · datos de hace 30 min$/ })).toBeDefined()

  // Past the reset time: no 0 % until new data says so.
  now = START + 2 * HOUR + 60_000
  await tickOnce(/^La ventana ya se restableció: esperando datos nuevos$/)
  expect(await ui.find({ type: 'Text', text: /^La ventana ya se restableció: esperando datos nuevos$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^—$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^0 %$/ })).toBeUndefined()

  // The timer's reread brings the new window.
  usage = [{ kind: 'five_hour', percentUsed: 3, resetsAt: at(START + 7 * HOUR) }]
  await tickOnce(/^3 %$/)
  expect(await ui.find({ type: 'Text', text: /^3 %$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Se restablece en 4 h 59 min$/ })).toBeDefined()

  // Each chat has it in its «Sesión» chip, the whole bar a press away, and the team below it still works.
  await ui.press({ key: 'chat-grupo' })
  expect(await ui.find({ key: 'limite-sesion' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /^Sesión 3 % ▾$/ })).toBeDefined()
  await ui.press({ key: 'sesion' })
  expect(await ui.find({ key: 'limite-sesion' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^3 %$/ })).toBeDefined()
  await ui.press({ key: 'volver' })
  expect(await ui.find({ key: 'tarjeta-coordinador' })).toBeDefined()
  await ui.unmount()

  // Every surface draws it.
  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const other = await $.ui.mount({ ...PANE, surface })
    expect(await other.find({ type: 'Text', text: /^Límite de sesión · 5 h$/ })).toBeDefined()
    await other.unmount()
  }
})

test('los agentes publican avances y se consultan entre ellos en el chat', async ($, on) => {
  const prompts: string[] = []
  const submits: string[] = []
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'test', agentId: 'a1' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_, e) => {
    if (e.origin.kind === 'plugin') submits.push(e.text)
    return { text: e.text }
  })
  on('model.complete', () => ({ value: { isAnswered: true as const, text: 'TIPO: encargo\n@qa: probar en los navegadores', usage } }))
  on('model.fork', (_, e) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true as const, text: 'Chrome y Firefox, los dos.', usage } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const shows = async (pattern: RegExp) => (await ui.find({ type: 'Markdown', text: pattern })) !== undefined
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) await ui.find({ key: 'caja' })
  }
  const tool = (input: Record<string, string>) => $.tool.call(input as never) as Promise<{ result?: unknown }>

  await ui.press({ key: 'chat-grupo' })
  await ui.input({ key: 'entrada-grupo-0', text: 'Prueba la web en los navegadores de los clientes' })
  await until(() => submits.length === 1)
  // The order asks for progress and for consulting with the panel's tools.
  expect(submits[0]).toContain('pídele que publique sus avances con mcp__panel-agentes__avance')
  expect(submits[0]).toContain('que lo haga él con esa herramienta: no lances tú al otro')
  // Research is checked first, then saved and indexed in the project.
  expect(submits[0]).toContain('Las investigaciones son tuyas (ya no hay agente Investigación)')
  expect(submits[0]).toContain('mira si docs/investigaciones/indice.md del proyecto ya tiene un informe vigente')
  expect(submits[0]).toContain('guarda el informe y actualiza el índice según «Investigaciones del proyecto»')
  await $.turn.start({ text: '', turnId: 'm1' })
  // The Coordinador tells each step of the flow.
  expect(await tool({ tool: 'mcp__panel-agentes__avance', texto: 'Coordinador: Lanzo a QA para probar los navegadores.' })).toMatchObject({ result: 'Publicado en el panel.' })
  expect(await shows(/^Lanzo a QA para probar los navegadores\.$/)).toBe(true)
  await $.agent.spawn({
    tool_use_id: 't',
    prompt: 'Prueba',
    description: 'Navegadores de los clientes',
    subagentType: 'agent-control-center:qa-engineer',
    provider: PROVIDER,
    parentModel: 'test',
    background: true,
    fork: false,
  })

  // What it does shows on its own, a quiet line at most every 20 s.
  await $.tool.call({ tool: 'WebSearch', query: 'navegadores más usados 2026', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'WebFetch', url: 'https://example.com/a', prompt: 'x', agentId: 'a1' } as never)
  expect(await ui.find({ type: 'Text', text: /^QA busca en la web «navegadores más usados 2026»…$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /lee example\.com/ })).toBeUndefined()

  // The agent at work posts its progress in the chat it was asked in.
  expect(await tool({ tool: 'mcp__panel-agentes__avance', texto: 'Reviso las analíticas del último mes.', agentId: 'a1' })).toMatchObject({ result: 'Publicado en el panel.' })
  expect(await shows(/^Reviso las analíticas del último mes\.$/)).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^QA$/ })).toBeDefined()

  // It asks Producto y negocio in the group chat; it answers there, and the agent gets it.
  const asked = await tool({ tool: 'mcp__panel-agentes__consultar', agente: 'producto', pregunta: '¿En qué navegadores probamos?', agentId: 'a1' })
  expect(asked).toMatchObject({ result: 'Producto y negocio contesta: Chrome y Firefox, los dos.' })
  expect(prompts.at(-1)).toContain('eres el agente Producto y negocio del')
  expect(prompts.at(-1)).toContain('Mensaje nuevo del agente QA')
  expect(prompts.at(-1)).toContain('@producto ¿En qué navegadores probamos?')
  expect(await shows(/^@producto ¿En qué navegadores probamos\?$/)).toBe(true)
  expect(await shows(/^Chrome y Firefox, los dos\.$/)).toBe(true)

  // Research asked of Investigación, by an old name, goes to the Coordinador.
  const research = await tool({ tool: 'mcp__panel-agentes__consultar', agente: 'research', pregunta: '¿Hay datos de navegadores?', agentId: 'a1' })
  expect(research).toMatchObject({ result: 'Coordinador contesta: Chrome y Firefox, los dos.' })
  expect(prompts.at(-1)).toContain('eres el agente Coordinador del Agent Control Center, que se ocupa de dirigir al equipo y hacer él mismo las investigaciones')
  expect(await shows(/^@coordinador ¿Hay datos de navegadores\?$/)).toBe(true)

  // Someone unknown, itself, or the Coordinador asking for research: told so, nothing posted.
  expect(await tool({ tool: 'mcp__panel-agentes__consultar', agente: 'marketing', pregunta: '¿Y tú?', agentId: 'a1' })).toMatchObject({ result: expect.stringContaining('No conozco a «marketing»') })
  expect(await tool({ tool: 'mcp__panel-agentes__consultar', agente: 'qa', pregunta: '¿Y tú?', agentId: 'a1' })).toMatchObject({ result: 'No puedes consultarte a ti mismo.' })
  expect(await tool({ tool: 'mcp__panel-agentes__consultar', agente: 'investigacion', pregunta: '¿Lo miras?' })).toMatchObject({ result: expect.stringContaining('Eres el Coordinador: las investigaciones las haces tú') })
  expect(prompts.length).toBe(2)
  await ui.unmount()
})

test('el chat del equipo: cabecera, avatares, atajos y una tarea nueva', async ($, on) => {
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: 'TIPO: otro\n@po: opinar', usage } }))
  on('model.fork', (_, e) => {
    const text = e.prompt.includes('eres el Coordinador') ? '¡Hola! Aquí estoy.' : 'Opinión del PO.'
    return { value: { isAnswered: true as const, text, usage } }
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-grupo' })

  // The head: who answers and whether they are free, and the session in a chip.
  expect(await ui.find({ type: 'Text', text: /^Chat del equipo$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Coordinador disponible$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /^Sesión — ▾$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^CONVERSACIÓN CON EL EQUIPO$/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /¿Qué quieres que trabajemos hoy\?/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^↪ Responde el Coordinador · usa @ para elegir un agente$/ })).toBeDefined()
  expect((await ui.find({ key: 'entrada-grupo-0' }))?.props).toMatchObject({ placeholder: 'Cuéntame qué necesitas…' })

  // The person's message in their own bubble, the answers beside each speaker's mark.
  await ui.input({ key: 'entrada-grupo-0', text: 'Hola, ¿qué tal?' })
  expect(await ui.find({ type: 'Text', text: /^Hola, ¿qué tal\?$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Tú$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Coordinador$/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /Aquí estoy/ })).toBeDefined()

  // Under the last answer, quick asks; «Nueva tarea» starts the field with it.
  expect(await ui.find({ key: 'atajo-pendiente' })).toBeDefined()
  await ui.press({ key: 'atajo-tarea' })
  expect((await ui.find({ key: 'entrada-grupo-1-tarea' }))?.props).toMatchObject({ value: 'Nueva tarea: ' })
  await ui.input({ key: 'entrada-grupo-1-tarea', text: 'Nueva tarea: probar el login' })
  expect((await ui.find({ key: 'entrada-grupo-2' }))?.props).toMatchObject({ value: '' })
  await ui.unmount()

  // The terminal draws no pictures: each mark is the role's glyph.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  if (await term.find({ key: 'chat-grupo' })) await term.press({ key: 'chat-grupo' })
  expect(await term.find({ type: 'Text', text: /^🧭$/ })).toBeDefined()
  await term.unmount()
})

test('Producto y negocio une al PO y al BA sin perder el equipo, los chats ni el trabajo en curso', async ($, on) => {
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const prompts: string[] = []
  const submits: string[] = []
  const models: (string | undefined)[] = []
  const contexts: (readonly string[] | undefined)[] = []
  let count = 0
  let picked = 'TIPO: otro\n@po: contestar'
  mock.store(on, { modelos: { 'product-owner': 'opus', 'business-analyst': 'haiku', 'qa-engineer': 'sonnet' } })
  // What the panel kept before the merge, under the two old roles, read
  // until the panel first writes each value.
  const seeds = new Map<string, unknown>(
    Object.entries({
      team: { roles: ['business-analyst', 'product-owner', 'qa-engineer'], leaving: [], joined: { 'business-analyst': 5 }, isChosen: true, told: 'business-analyst,product-owner,qa-engineer|' },
      chat: [
        { id: 'm1', channel: 'product-owner', from: 'tu', text: '¿Qué priorizamos?' },
        { id: 'm2', channel: 'product-owner', from: 'product-owner', text: 'Primero el login.' },
        { id: 'm3', channel: 'business-analyst', from: 'business-analyst', text: 'Faltan los criterios del login.' },
      ],
      runs: [{ id: 'a0', role: 'business-analyst', task: 'Criterios del login', status: 'trabajando', tools: 0, startedAt: 1 }],
    }),
  )
  let team: { roles: string[]; joined: Record<string, number> } | undefined
  on('state.get', (_, e, next) => (seeds.has(e.key) ? { value: { value: seeds.get(e.key), version: 0 } } : next(e)))
  on('state.set', (_, e, next) => {
    seeds.delete(e.key)
    if (e.key === 'team') team = e.value as typeof team
    return next(e)
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: undefined as never, rateLimits: [] } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { name: e.name } as never }))
  on('clock.every', () => new Promise(() => undefined))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', (_, e) => {
    models.push(e.model)
    return { model: 'test', agentId: `a${++count}` }
  })
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => {
    if (e.origin.kind === 'plugin') submits.push(e.text)
    else contexts.push(e.context)
    return { text: e.text }
  })
  on('model.complete', () => ({ value: { isAnswered: true as const, text: picked, usage } }))
  on('model.fork', (_, e) => {
    prompts.push(e.prompt)
    const text = e.prompt.includes('eres el Coordinador') ? 'Hecho.' : 'Respuesta de Producto y negocio.'
    return { value: { isAnswered: true as const, text, usage } }
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

  // On start, the team holds Producto y negocio once, and the work under way goes on as its.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(team?.roles).toEqual(['product-analyst', 'qa-engineer'])
  expect(team?.joined).toEqual({ 'product-analyst': 5 })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'tarjeta-product-analyst' })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-product-owner' })).toBeUndefined()
  expect(await ui.find({ key: 'tarjeta-business-analyst' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Equipo de esta sesión: el Coordinador y 2 de 7 especialistas/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Criterios del login/ })).toBeDefined()
  await $.turn.complete({ answer: 'Criterios listos.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a0', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: /Producto y negocio · 1 s/ })).toBeDefined()

  // The main session hears the team under its new name, with no one new in it.
  await $.prompt.submit({ text: 'sigue', wait: false, origin: { kind: 'composer' } })
  expect(contexts.at(-1)?.join(' ')).toContain('Equipo activo de esta sesión, elegido por el usuario en el panel de agentes: Producto y negocio y QA.')
  expect(contexts.at(-1)?.join(' ')).not.toContain('se acaba de incorporar')
  // The model chosen for the PO is now the one of Producto y negocio.
  await spawn('product-analyst')
  expect(models.at(-1)).toBe('opus')
  // A leftover launch under an old name counts as the new role.
  await spawn('business-analyst')
  expect(await ui.find({ type: 'Text', text: /Tarea de business-analyst/ })).toBeDefined()

  // Its chat holds both old chats, each message with who wrote it.
  await ui.press({ key: 'chat-product-analyst' })
  expect(await ui.find({ type: 'Text', text: /^¿Qué priorizamos\?$/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /^Primero el login\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /^Faltan los criterios del login\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Product Owner$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Analista de negocio$/ })).toBeDefined()
  await ui.press({ key: 'volver' })

  // The old names reach it once, however many are used.
  await ui.press({ key: 'chat-grupo' })
  const before = prompts.length
  await ui.input({ key: 'entrada-grupo-0', text: '@po @ba @analista ¿qué falta para el login?' })
  const asked = prompts.slice(before)
  expect(asked.length).toBe(1)
  expect(asked[0]).toContain('eres el agente Producto y negocio del')
  // Picked twice under old names, it is consulted once.
  await ui.input({ key: 'entrada-grupo-1', text: '¿Está claro el alcance?' })
  picked = 'TIPO: otro\n@po: el alcance\n@ba: los criterios'
  const beforePick = prompts.length
  await ui.input({ key: 'entrada-grupo-2', text: '¿Y las reglas de negocio?' })
  expect(prompts.slice(beforePick).filter(one => one.includes('eres el agente Producto y negocio del')).length).toBe(1)
  // Work for both old names is one assignment.
  picked = 'TIPO: encargo\n@po: definir el login\n@ba: criterios del login'
  await ui.input({ key: 'entrada-grupo-3', text: 'Definid el login con sus criterios' })
  for (let i = 0; i < 200 && submits.length === 0; i++) await ui.find({ key: 'caja' })
  expect(submits.at(-1)?.match(/agent-control-center:product-analyst/g)?.length).toBe(1)
  expect(submits.at(-1)).not.toContain('product-owner')
  expect(submits.at(-1)).not.toContain('business-analyst')

  // Another agent consulting an old name reaches Producto y negocio.
  await spawn('qa-engineer')
  const reply = (await $.tool.call({ tool: 'mcp__panel-agentes__consultar', agente: 'ba', pregunta: '¿Qué navegadores entran?', agentId: `a${count}` } as never)) as {
    result?: unknown
  }
  expect(String(reply.result)).toContain('Producto y negocio contesta')
  await ui.unmount()
})

test('Investigación pasa al Coordinador: su historial queda, su trabajo en curso termina y no recibe trabajo nuevo', async ($, on) => {
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  let team: { roles: string[] } | undefined
  mock.store(on)
  // What the panel kept while Investigación was a specialist, read until the
  // panel first writes each value.
  const seeds = new Map<string, unknown>(
    Object.entries({
      team: { roles: ['qa-engineer', 'research-agent'], leaving: [], joined: { 'research-agent': 5 }, isChosen: true, told: 'qa-engineer,research-agent|' },
      paused: ['research-agent'],
      chat: [
        { id: 'm1', channel: 'research-agent', from: 'tu', text: '¿Qué librería de PDF?' },
        { id: 'm2', channel: 'research-agent', from: 'research-agent', text: 'pdfmake, por su tabla.' },
      ],
      runs: [{ id: 'a0', role: 'research-agent', task: 'Comparar librerías de PDF', status: 'trabajando', tools: 0, startedAt: 1 }],
    }),
  )
  on('state.get', (_, e, next) => (seeds.has(e.key) ? { value: { value: seeds.get(e.key), version: 0 } } : next(e)))
  on('state.set', (_, e, next) => {
    seeds.delete(e.key)
    if (e.key === 'team') team = e.value as typeof team
    return next(e)
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: undefined as never, rateLimits: [] } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { name: e.name } as never }))
  on('clock.every', () => new Promise(() => undefined))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'test', agentId: 'a0' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: 'TIPO: otro', usage } }))
  const spawn = (resume?: string) =>
    $.agent.spawn({
      tool_use_id: 't',
      prompt: 'Investiga',
      description: 'Otra investigación',
      subagentType: 'agent-control-center:research-agent',
      provider: PROVIDER,
      parentModel: 'test',
      background: false,
      fork: false,
      ...(resume ? { resume: { agentId: resume } } : {}),
    })

  // On start it leaves the team; its work under way keeps going.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(team?.roles).toEqual(['qa-engineer'])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const coordinator = async () => (await ui.find({ key: 'tarjeta-coordinador' }))?.text ?? ''
  expect(await ui.find({ key: 'tarjeta-research-agent' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /el Coordinador y 1 de 7 especialistas/ })).toBeDefined()
  expect(await coordinator()).toContain('Esperando entregas')
  expect(await ui.find({ type: 'Text', text: /^Espera a Investigación$/ })).toBeDefined()

  // Its chat stays, read only, and sends to the group.
  await ui.press({ key: 'historial-research-agent' })
  expect(await ui.find({ type: 'Markdown', text: /^pdfmake, por su tabla\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Ya no es especialista: el Coordinador hace las investigaciones$/ })).toBeDefined()
  expect(await ui.find({ key: 'entrada-research-agent-1' })).toBeUndefined()
  expect(await ui.find({ key: 'atajo-estado' })).toBeUndefined()
  await ui.press({ key: 'ir-al-grupo' })
  expect(await ui.find({ type: 'Text', text: /^Chat del equipo$/ })).toBeDefined()
  await ui.press({ key: 'volver' })

  // No new work for it; the one at work goes on and delivers.
  expect(await spawn()).toMatchObject({ deny: expect.stringContaining('Investigación ya no es un especialista del Agent Control Center: las investigaciones las haces tú, el Coordinador') })
  expect(await spawn('a0')).toMatchObject({ agentId: 'a0' })
  await $.turn.complete({ answer: 'pdfmake.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a0', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: /^Investigación · 1 s$/ })).toBeDefined()
  expect(await coordinator()).toContain('Disponible')

  // The Coordinador's own research shows on its card from what it does.
  await $.prompt.submit({ text: 'Investiga cómo firmar los PDF', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'Investiga cómo firmar los PDF', turnId: 'm1' })
  expect(await coordinator()).toContain('Atendiendo')
  await $.tool.call({ tool: 'WebFetch', url: 'https://pdfmake.github.io/docs', prompt: 'x' } as never)
  expect(await coordinator()).toContain('Investigando')
  expect(await ui.find({ type: 'Text', text: /^«Investiga cómo firmar los PDF» · lee pdfmake\.github\.io$/ })).toBeDefined()
  await $.turn.complete({ answer: 'Hecho.', durationMs: 1000, isAborted: false, turnId: 'm1', reason: 'answer' })
  expect(await coordinator()).toContain('Disponible')
  expect(await ui.find({ type: 'Text', text: /^Último: «Investiga cómo firmar los PDF»$/ })).toBeDefined()
  await ui.unmount()
})
