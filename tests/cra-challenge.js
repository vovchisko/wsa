import { execute } from 'test-a-bit'

import { VALID_SECRET, WS_TEST_PORT } from './_helpers.js'
import { WseClient, WseServer }       from '../node.js'

execute('cra-challenge connect and ready', async (success, fail) => {
  const options = {}

  function identify ({ payload, resolve, meta, challenge }) {
    if (payload === VALID_SECRET) {
      const user_id = meta.user_id || 'USR-1'
      if (challenge.response !== 3) fail('failed challenge')
      resolve(user_id, { hey: 'some additional data for the client' })
    } else {
      resolve(false)
    }
  }

  const server = new WseServer({ port: WS_TEST_PORT, identify, ...options })
  const client = new WseClient({ url: `ws://localhost:${ WS_TEST_PORT }`, ...options })

  if (!process.send) client.logger = (args) => console.log('CLIENT::', ...args)
  if (!process.send) server.logger = (args) => console.log('SERVER::', ...args)

  server.useChallenge((payload, meta, challenge) => {
    challenge({ a: 1, b: 2 })
  })

  client.challenge((challenge, solve) => {
    solve(challenge.a + challenge.b)
  })

  client.when.ready(() => {
    success('welcome message received')
  })

  await client.connect(VALID_SECRET, { user_id: 1 })
})




