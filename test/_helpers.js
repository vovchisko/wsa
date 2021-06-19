import { WseClient, WseServer } from '../node.js'

let USER_ID_COUNTER = 100

export const VALID_SECRET = 'valid-secret'
export const INVALID_SECRET = 'invalid-secret'
export const WS_TEST_PORT = 64000

// auth procedure is all up to you,
// the only required is pass user_id to resolve()
// let's say we expect this ID from user
export function on_auth (payload, authorize, meta) {
  if (payload === VALID_SECRET) {
    // if client looks valid - assign id to it using resolution function.
    // only after this you'll get message events.
    authorize('USR-' + ++USER_ID_COUNTER, { hey: 'some additional data for the client' })
  } else {
    // user will be disconnected instantly
    // no events fired on the server side
    authorize(false)
  }
}

export function create_pair () {
  const server = new WseServer({ port: WS_TEST_PORT }, on_auth)
  const client = new WseClient(`ws://localhost:${ WS_TEST_PORT }`, {})

  if (!process.send) {
    server.logger = (args) => console.log('SERVER::', ...args)
    client.logger = (args) => console.log('CLIENT::', ...args)
  }

  return { server, client }
}

export function create_clients_swarm (clients = 2) {
  // todo: this will create a client-s swarm
  return { server: null, clients: []}
}

export function wait (delay) {
  return new Promise(function (resolve) {
    setTimeout(resolve, delay)
  })
}
