import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const PANE = 'contador'
const count = atom({ plugin: 'contador-herramientas', key: 'count' } as const, 0)

const label = (n: number) => `🔧 ${n} herramienta${n === 1 ? '' : 's'}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'reiniciar',
      description: 'Pone a cero el contador de herramientas',
    })
    await $.command.register({
      name: 'contador',
      description: 'Abre el panel del contador de herramientas',
    })
    await $.tool.register({
      name: 'diagnostico',
      description: 'Dice en qué superficies se dibuja el mod contador-herramientas y si su panel está abierto',
      isDeferred: false,
    })
    $.ui.status(label(await read($, count)))
    void $.ui.open({ id: PANE, title: 'Contador' })

    return next(e)
  })

  on('command.run', { command: 'reiniciar' }, async $ => {
    await update($, count, () => 0)
    $.ui.status(label(0))

    return { text: 'Contador de herramientas reiniciado.' }
  })

  on('command.run', { command: 'contador' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Contador' })

    return { text: label(await read($, count)) }
  })

  on('tool.call', { tool: /^mcp__contador-herramientas__diagnostico$/ }, async $ => {
    const surfaces = await $.session.surfaces()
    const opened = await $.ui.open({ id: PANE, title: 'Contador' })

    return { result: JSON.stringify({ surfaces, opened, count: await read($, count) }) }
  })

  on('tool.call', async ($, e, next) => {
    const n = await update($, count, c => c + 1)
    $.ui.status(label(n))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text dimColor>{label(await read($, count))}</Text>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text bold>{label(await read($, count))}</Text>
        <Button key="reset" label="Reiniciar" onPress={() => update($, count, () => 0)} />
      </Box>
    )
  })
}
