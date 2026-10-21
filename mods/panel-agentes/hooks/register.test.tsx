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
    if (e.prompt.includes('agente Product Owner del') && e.prompt.includes('Gracias, queda claro')) return said('PASO')
    if (e.prompt.includes('agente QA del') && e.prompt.includes('confirma con el PO')) return said('@po Gracias, queda claro.')
    const role = /eres el agente ([^ ]+(?: [^ ]+)?) del/.exec(e.prompt)?.[1] ?? '?'
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
  expect(prompts[1]).toContain('Sus aportaciones:\n\nProduct Owner: Aporte de Product Owner.')
  expect(await shows(/Síntesis 2/)).toBe(true)
  expect(await shows(/Aporte de Product Owner/)).toBe(false)

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
  expect(prompts[13]).toContain('agente Product Owner del')

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

test('el Coordinador informa del avance sin lanzar nada y pasa las funciones nuevas a la sesión principal', async ($, on) => {
  const prompts: string[] = []
  const fills: string[] = []
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  let picked = 'TIPO: estado'
  let canFill = true
  let count = 0
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'test', agentId: `a${++count}` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: canFill }
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
      background: false,
      fork: false,
    })
  const finish = (agentId: string, answer: string) =>
    $.turn.complete({ answer, durationMs: 60000, isAborted: false, turnId: 'u', agentId, reason: 'answer' })

  await spawn('product-owner', 'Historias del login')
  await finish('a1', 'Tres historias listas para el login.')
  await spawn('backend-engineer', 'API del login')

  // Asking how it goes reads what the panel and the agent hold, and starts nothing.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'chat-coordinador' })
  await ui.input({ key: 'entrada-grupo-0', text: '¿Cómo va el login?' })
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('eres el Coordinador')
  expect(prompts[0]).toContain('Solo informas: no lanzas agentes')
  expect(prompts[0]).toContain('- Product Owner, tarea «Historias del login»: terminado, entregó su informe (1 min')
  expect(prompts[0]).toContain('Resumen de su informe: Tres historias listas para el login.')
  expect(prompts[0]).toContain('- Backend, tarea «API del login»: iniciado, trabaja en ello ahora')
  expect(prompts[0]).toContain('Lo último que escribió: «Llevo el endpoint de callback; falta la sesión.»')
  expect(prompts[0]).toContain('No consta ninguna entrega de QA posterior al desarrollo: nada está verificado.')
  expect(prompts[0]).toContain('verificado (QA lo probó después del desarrollo')
  expect(await ui.find({ type: 'Markdown', text: /Informe 1/ })).toBeDefined()
  expect(fills).toEqual([])
  expect(count).toBe(2)

  // A new function: the order waits in the main prompt box for the person's Enter.
  picked = 'TIPO: funcion'
  await ui.input({ key: 'entrada-grupo-1', text: 'Quiero exportar las reservas a PDF' })
  expect(fills.length).toBe(1)
  expect(fills[0]).toStartWith('/agent-control-center:coordinador Nueva función pedida desde el panel de agentes: «Quiero exportar las reservas a PDF».')
  expect(prompts.length).toBe(1)
  expect(await ui.find({ type: 'Markdown', text: /envíala con Enter/ })).toBeDefined()
  await ui.press({ key: 'volver-abajo' })
  expect(await ui.find({ type: 'Text', text: /orden aún no enviada/ })).toBeDefined()

  // Sent, the flow runs in the main session: development, then QA.
  // The person sends it with their own Enter.
  await $.prompt.submit({ text: fills[0] ?? '', wait: false, origin: { kind: 'composer' } })
  expect(await ui.find({ type: 'Text', text: /orden aún no enviada/ })).toBeUndefined()
  await spawn('backend-engineer', 'Exportar a PDF')
  await finish('a3', 'Endpoint de exportación hecho, con pruebas unitarias.')
  await spawn('qa-engineer', 'Probar la exportación')
  await finish('a4', 'Las 6 pruebas de exportación pasan.')
  await ui.press({ key: 'chat-coordinador' })
  picked = 'TIPO: estado'
  await ui.input({ key: 'entrada-grupo-2', text: '¿Cómo va esta tarea?' })
  expect(prompts.length).toBe(2)
  expect(prompts[1]).toContain('Última función pedida desde el panel: «Quiero exportar las reservas a PDF»')
  expect(prompts[1]).toContain('La orden llegó a la sesión principal.')
  expect(prompts[1]).toContain('Backend, tarea «Exportar a PDF»: terminado')
  expect(prompts[1]).toContain('QA entregó después del desarrollo')
  // Only what started since the request counts for it.
  expect(prompts[1]).not.toContain('Historias del login')

  // Without a prompt box to take the order, the Coordinador shows it to send by hand.
  canFill = false
  picked = 'TIPO: funcion'
  await ui.input({ key: 'entrada-grupo-3', text: 'Añade recordatorios por correo' })
  expect(await ui.find({ type: 'Markdown', text: /Envíala tú allí/ })).toBeDefined()
  expect(count).toBe(4)
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

test('al reanudar, el trabajo que cortó la pausa sigue donde se quedó', async ($, on) => {
  const fills: string[] = []
  let count = 0
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', (_, e) => ({ model: 'test', agentId: e.resume?.agentId ?? `a${++count}` }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
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

  // Paused, QA is told to stop and say where it left off.
  await ui.press({ key: 'pausa-todos' })
  expect(await toolOf('a1')).toMatchObject({ deny: expect.stringContaining('dónde lo dejaste') })
  await $.turn.complete({ answer: 'Validé los casos 1 a 4; faltan del 5 al 9.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a1', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: /El equipo está en pausa/ })).toBeDefined()

  // Resumed, its work goes back to the main session to go on from there.
  await ui.press({ key: 'pausa-todos' })
  expect(fills.length).toBe(1)
  expect(fills[0]).toContain('Reanuda el trabajo que quedó en pausa')
  expect(fills[0]).toContain('QA (agente a1), tarea «Validar bloque 2». Dónde lo dejó: Validé los casos 1 a 4; faltan del 5 al 9.')
  expect(await ui.find({ type: 'Markdown', text: /te dejé la orden en la caja del chat principal/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Listo para seguir/ })).toBeDefined()

  // Sent, the same agent goes on: its tools work again, and the notice goes.
  await $.agent.spawn({ ...base, description: 'Validar bloque 2', resume: { agentId: 'a1' } })
  expect(await toolOf('a1')).toMatchObject({ result: {} })
  expect(await ui.find({ type: 'Markdown', text: /te dejé la orden/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Listo para seguir/ })).toBeUndefined()

  // A role paused on its own resumes the same way; with nothing cut short, no order.
  await ui.press({ key: 'menu-qa-engineer' })
  await ui.press({ key: 'pausa-qa-engineer' })
  await $.turn.complete({ answer: 'Casos 5 y 6 hechos.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a1', reason: 'answer' })
  await ui.press({ key: 'pausa-qa-engineer' })
  expect(fills.length).toBe(2)
  expect(fills[1]).toContain('Casos 5 y 6 hechos.')
  await ui.press({ key: 'pausa-qa-engineer' })
  await ui.press({ key: 'pausa-qa-engineer' })
  expect(fills.length).toBe(2)
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
  const OTHERS = ['ux-ui-designer', 'backend-engineer', 'frontend-engineer', 'code-reviewer', 'devops-engineer', 'research-agent']

  // With no team chosen, everyone takes part, as before.
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /los 9 agentes \(sin configurar\)/ })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-devops-engineer' })).toBeDefined()
  await submit()
  expect(contexts.at(-1)).toBeUndefined()

  // Cancelling leaves the team as it was.
  await ui.press({ key: 'configurar-equipo' })
  expect(await ui.find({ type: 'Text', text: /9 de 9 seleccionados/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Requisitos funcionales/ })).toBeDefined()
  await toggle(ui, OTHERS)
  expect(await ui.find({ type: 'Text', text: /3 de 9 seleccionados/ })).toBeDefined()
  await ui.press({ key: 'cancelar-equipo' })
  expect(await ui.find({ type: 'Text', text: /sin configurar/ })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-devops-engineer' })).toBeDefined()

  // A subset: only PO, BA and QA, as cards and for new work.
  await ui.press({ key: 'configurar-equipo' })
  await toggle(ui, OTHERS)
  await ui.press({ key: 'confirmar-equipo' })
  expect(await ui.find({ type: 'Text', text: /3 de 9 agentes/ })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-qa-engineer' })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-devops-engineer' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Todos/ })).toBeDefined()
  expect(await spawn('devops-engineer')).toMatchObject({ deny: expect.stringContaining('DevOps no está en el equipo de esta sesión') })
  expect(await spawn('qa-engineer')).toMatchObject({ agentId: 'a1' })
  // The main session hears of the team once, with its next prompt.
  await submit()
  expect(contexts.at(-1)?.join(' ')).toContain('Equipo activo de esta sesión, elegido por el usuario en el panel de agentes: Product Owner, Analista de negocio y QA.')
  await submit()
  expect(contexts.at(-1)).toBeUndefined()

  // Reopening the panel keeps the team.
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /3 de 9 agentes/ })).toBeDefined()

  // Taking off a working agent asks first, and never cuts its task.
  await ui.press({ key: 'configurar-equipo' })
  expect(await ui.find({ type: 'Text', text: /QA · trabajando/ })).toBeDefined()
  await toggle(ui, ['qa-engineer'])
  await ui.press({ key: 'confirmar-equipo' })
  expect(await ui.find({ type: 'Text', text: /QA está trabajando ahora y su tarea no se cancela/ })).toBeDefined()
  await ui.press({ key: 'retirar-al-terminar' })
  expect(await ui.find({ type: 'Text', text: /Se retira al terminar/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 de 9 agentes/ })).toBeDefined()
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
  await spawn('product-owner')
  await ui.press({ key: 'configurar-equipo' })
  await toggle(ui, ['devops-engineer', 'product-owner'])
  await ui.press({ key: 'confirmar-equipo' })
  await ui.press({ key: 'mantener-ocupados' })
  expect(await ui.find({ type: 'Text', text: /3 de 9 agentes/ })).toBeDefined()
  expect(await ui.find({ key: 'tarjeta-product-owner' })).toBeDefined()
  expect(await spawn('devops-engineer')).toMatchObject({ agentId: 'a3' })
  await submit()
  expect(contexts.at(-1)?.join(' ')).toContain('DevOps se acaba de incorporar')
  await ui.press({ key: 'chat-grupo' })
  expect(await ui.find({ type: 'Text', text: /Equipo de esta sesión: Product Owner, Analista de negocio y QA\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /QA sale del equipo al terminar su tarea\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /QA terminó su tarea y salió del equipo\./ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /DevOps se incorporó al equipo\./ })).toBeDefined()
  await ui.press({ key: 'volver' })

  // An empty team: nobody gets work, and the panel offers to configure.
  await ui.press({ key: 'configurar-equipo' })
  await toggle(ui, ['product-owner', 'business-analyst', 'devops-engineer'])
  await ui.press({ key: 'confirmar-equipo' })
  await ui.press({ key: 'retirar-al-terminar' })
  await $.turn.complete({ answer: 'Hecho.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a2', reason: 'answer' })
  await $.turn.complete({ answer: 'Hecho.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a3', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: /No hay agentes en el equipo de esta sesión/ })).toBeDefined()
  expect(await spawn('product-owner')).toMatchObject({ deny: expect.stringContaining('ahora no hay ningún agente') })
  // A resumed agent finishes what it had, team or not.
  expect(await spawn('devops-engineer', 'a3')).toMatchObject({ agentId: 'a3' })
  await ui.press({ key: 'configurar-equipo-vacio' })
  expect(await ui.find({ type: 'Text', text: /0 de 9 seleccionados/ })).toBeDefined()
  await ui.press({ key: 'cancelar-equipo' })
  await ui.unmount()
})

test('solo el equipo participa en los chats, y a un agente fuera se le ofrece incorporarse antes de escribirle', async ($, on) => {
  const prompts: string[] = []
  const picks: string[] = []
  const fills: string[] = []
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  let picked = ''
  let qaSays = 'Respuesta de QA.'
  let count = 0
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'test', agentId: `a${++count}` }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  on('model.complete', (_, e) => {
    picks.push(e.prompt)
    return { value: { isAnswered: true as const, text: picked, usage } }
  })
  on('model.fork', (_, e) => {
    prompts.push(e.prompt)
    if (e.prompt.includes('eres el Coordinador')) return { value: { isAnswered: true as const, text: 'Respuesta del Coordinador.', usage } }
    if (e.prompt.includes('agente QA del')) return { value: { isAnswered: true as const, text: qaSays, usage } }
    const role = /eres el agente ([^ ]+(?: [^ ]+)?) del/.exec(e.prompt)?.[1] ?? '?'
    return { value: { isAnswered: true as const, text: `Respuesta de ${role}.`, usage } }
  })
  const asked = (label: string) => prompts.filter(one => one.includes(`eres el agente ${label} del`))
  const coordinator = () => prompts.filter(one => one.includes('eres el Coordinador')).at(-1) ?? ''

  // The PO delivered before the team was chosen.
  await $.agent.spawn({
    tool_use_id: 't',
    prompt: 'Trabaja',
    description: 'Historias del login',
    subagentType: 'agent-control-center:product-owner',
    provider: PROVIDER,
    parentModel: 'test',
    background: false,
    fork: false,
  })
  await $.turn.complete({ answer: 'Tres historias listas.', durationMs: 1000, isAborted: false, turnId: 'u', agentId: 'a1', reason: 'answer' })

  // The team: PO and QA.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'configurar-equipo' })
  for (const role of ['business-analyst', 'ux-ui-designer', 'backend-engineer', 'frontend-engineer', 'code-reviewer', 'devops-engineer', 'research-agent']) {
    await ui.press({ key: `casilla-${role}` })
  }
  await ui.press({ key: 'confirmar-equipo' })
  await ui.press({ key: 'chat-grupo' })

  // The pick sees only the team; one it names out of it is proposed, not consulted.
  picked = 'TIPO: otro\n@qa: riesgos de la prueba\n@devops: el pipeline'
  await ui.input({ key: 'entrada-grupo-0', text: '¿Qué riesgos ves para sacar el login?' })
  expect(picks.at(-1)).toContain('@qa: QA')
  expect(picks.at(-1)).not.toContain('@ux: Diseño UX/UI')
  expect(picks.at(-1)).toContain('Fuera del equipo de esta sesión')
  expect(picks.at(-1)).toContain('@devops (DevOps)')
  expect(asked('QA').length).toBe(1)
  expect(asked('QA')[0]).toContain('Product Owner (@po), QA (@qa)')
  expect(asked('QA')[0]).not.toContain('DevOps (@devops)')
  expect(asked('DevOps').length).toBe(0)
  expect(coordinator()).toContain('Equipo activo de esta sesión, elegido por el usuario: Product Owner y QA.')
  expect(coordinator()).toContain('haría falta DevOps, que no está en el equipo activo')
  expect(await ui.find({ type: 'Text', text: /DevOps no está en el equipo de esta sesión/ })).toBeDefined()
  await ui.press({ key: 'no-incorporar' })
  expect(await ui.find({ type: 'Text', text: /DevOps sigue fuera del equipo\./ })).toBeDefined()
  expect(await ui.find({ key: 'incorporar' })).toBeUndefined()

  // A missing specialty the pick flags on its own line.
  picked = 'TIPO: otro\n@po: el valor\nFUERA: @research'
  await ui.input({ key: 'entrada-grupo-1', text: '¿Qué librería de PDF usamos?' })
  expect(coordinator()).toContain('haría falta Investigación')
  expect(await ui.find({ type: 'Text', text: /Investigación no está en el equipo/ })).toBeDefined()

  // A pick that fails falls to the PO, in the team.
  picked = ''
  await ui.input({ key: 'entrada-grupo-2', text: '¿Y el plazo?' })
  expect(asked('Product Owner').length).toBe(2)

  // Naming one out of the team: offered first, then it gets the message, with the session's context.
  const before = prompts.length
  await ui.input({ key: 'entrada-grupo-3', text: '@devops ¿cómo desplegamos esto?' })
  expect(prompts.length).toBe(before)
  expect(await ui.find({ type: 'Text', text: /DevOps no está en el equipo de esta sesión\. ¿Lo incorporo y le paso el mensaje\?/ })).toBeDefined()
  await ui.press({ key: 'incorporar' })
  expect(asked('DevOps').length).toBe(1)
  expect(asked('DevOps')[0]).toContain('@devops ¿cómo desplegamos esto?')
  expect(asked('DevOps')[0]).toContain('Te incorporaste al equipo con la sesión ya empezada')
  expect(asked('DevOps')[0]).toContain('- Product Owner, tarea «Historias del login»: Tres historias listas.')
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

  // A new function goes to the main session with the team named.
  picked = 'TIPO: funcion'
  await ui.input({ key: 'entrada-grupo-5', text: 'Quiero exportar a PDF' })
  expect(fills.at(-1)).toContain('Equipo activo de esta sesión: Product Owner, QA y DevOps. Usa solo esos agentes')
  expect(await ui.find({ type: 'Markdown', text: /empiezo con el equipo de esta sesión \(Product Owner, QA y DevOps\)/ })).toBeDefined()

  // With no one in the team, the Coordinador answers alone and hands nothing on.
  await ui.press({ key: 'volver' })
  await ui.press({ key: 'configurar-equipo' })
  for (const role of ['product-owner', 'qa-engineer', 'devops-engineer']) await ui.press({ key: `casilla-${role}` })
  await ui.press({ key: 'confirmar-equipo' })
  await ui.press({ key: 'chat-grupo' })
  const consulted = prompts.filter(one => one.includes('eres el agente')).length
  picked = 'NADIE'
  await ui.input({ key: 'entrada-grupo-6', text: '¿Quién puede ayudarme?' })
  expect(prompts.filter(one => one.includes('eres el agente')).length).toBe(consulted)
  expect(coordinator()).toContain('no consultaste a ningún agente')
  expect(coordinator()).toContain('Configurar equipo')
  picked = 'TIPO: funcion'
  const handed = fills.length
  await ui.input({ key: 'entrada-grupo-7', text: 'Quiero exportar a Excel' })
  expect(fills.length).toBe(handed)
  expect(await ui.find({ type: 'Markdown', text: /No hay ningún agente en el equipo de esta sesión/ })).toBeDefined()
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

  // The bar heads each chat too, and the team below it still works.
  await ui.press({ key: 'chat-grupo' })
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
