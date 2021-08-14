import { execute } from 'test-a-bit'

import { create_pair, VALID_SECRET } from './_helpers.js'

execute('server > client: ignored message', async (success, fail) => {
  const { server, client } = create_pair()

  client.ignored.on((c, dat) => {
    dat.value === 42 && c === 'test'
        ? success('correctly fired about ignored msg')
        : fail('invalid data on ignored message')
  })

  server.joined.on((client) => {
    client.send('test', { value: 42 })
  })

  server.init()

  await client.connect(VALID_SECRET, { client_meta: 1 })
})
