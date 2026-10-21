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
