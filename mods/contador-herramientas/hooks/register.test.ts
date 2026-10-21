import { expect, test } from 'claude-code/testing'

test('cuenta herramientas y /reiniciar lo pone a cero', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('command.register', () => ({ value: { command: 'reiniciar' } }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'pwd' })
  expect(statuses.at(-1)).toBe('🔧 2 herramientas')

  const r = await $.command.run({ command: 'reiniciar' } as never)
  expect(r.text).toBe('Contador de herramientas reiniciado.')
  expect(statuses.at(-1)).toBe('🔧 0 herramientas')
})
