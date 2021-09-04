# WSE

Client-centric WebSocket Protocol Expansion.

- Easy client management;
- Messaging protocol;
- Simple authorization handler;
- Custom Messaging Protocol Processor for real racers.
- Basic Challenge-response Auth handlers.

## Installation

```bash
npm install wse -s
```

## Basic Usage

```JavaScript
// server
import { WseServer } from 'wse'

// auth handler
function identify ({ payload, resolve, meta }) {
  if (payload === SECRET) {
    const user_id = 'any user id here'
    resolve(user_id, { hey: 'welcome back!' })
  } else {
    resolve(false)
  }
}

const server = new WseServer({ port: 4200, identify })

server.broadcast('broad-message', { paylog: 'hey there!' })

server.channel.on('test-message', (client, dat) => {
  console.log('we got test-message from', client.id, dat)

  client.send('welcome-here', { payload: 42 })
})

```

```JavaScript
// client
import { WseClient } from 'wse'

const client = new WseClient({ url: 'ws://lcoalhost:4200' })

await client.connect(SECRET)

client.when.ready(() => {
  client.send('test-message', { a: 1, b: 2 })
})

client.channel.on('welcome-here', (dat) => {
  console.log('got it', dat)
})
```

> API Docs is in progress now.
> For more examples see: https://github.com/vovchisko/wse/tree/master/tests

### Opt-in for performance

There are 2 optional modules that can be installed along side with the `ws` module. These modules are binary addons which
improve certain operations.

```npm install --save-optional bufferutil```: Allows to efficiently perform operations such as masking and unmasking the data
payload of the WebSocket frames.

```npm install --save-optional utf-8-validate```: Allows to efficiently check if a message contains valid UTF-8.

Read More: https://www.npmjs.com/package/ws#opt-in-for-performance



