import EE        from 'eventemitter3'
import WebSocket from 'ws'
import Sig       from 'a-signal'

import WseJSON    from './protocol.js'
import WSE_REASON from './reason.js'

const CLIENT_STRANGER = 'CLIENT_STRANGER'
const CLIENT_VALIDATING = 'CLIENT_VALIDATING'
const CLIENT_CHALLENGED = 'CLIENT_CHALLENGED'
const CLIENT_VALID = 'CLIENT_VALID'

const _payload = Symbol('_payload')
const _meta = Symbol('_meta')
const _challenge_quest = Symbol('_challenge_quest')
const _challenge_response = Symbol('_challenge_response')
const _client_id = Symbol('_client_id')
const _valid_stat = Symbol('_valid_stat')
const _id = Symbol('id')

function conn_id_gen () {
  return Math.random()
             .toString(36)
             .substring(2, 15) + Math.random()
             .toString(36)
             .substring(2, 15)
}

export default class WseServer {
  /**
   * Manage identify connections.
   *
   * @callback WseServer.identify
   * @param {String} params.payload JWT or any other type of secret
   * @param {Object} params.meta optional data from the client
   * @param {Function} params.identify call it with user ID or any other identifier. falsy argument will reject connection.
   * @param {Object} params.challenge challenge quest and client response on it
   * @param {*} params.challenge.quest given task
   * @param {*} params.challenge.response received user response
   */

  /**
   * WseServer class.
   *
   * @param {Object} options see https://github.com/websockets/ws/#readme.
   * @param {Function|WseServer.identify} options.identify Will be called for each new connection.
   * @param {Number} options.cpu_limit How many connections allowed per user
   * @param {Object} [options.protocol=WseJSON] Overrides `wse_protocol` implementation. Use with caution.
   *
   * and classic ws params...
   * @param {Number} [options.backlog=511] The maximum length of the queue of pending connections
   * @param {Boolean} [options.clientTracking=true] Specifies whether or not to track clients
   * @param {Function} [options.handleProtocols] A hook to handle protocols
   * @param {String} [options.host] The hostname where to bind the server
   * @param {Number} [options.maxPayload=104857600] The maximum allowed message size
   * @param {Boolean} [options.noServer=false] Enable no server mode
   * @param {String} [options.path] Accept only connections matching this path
   * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable permessage-deflate
   * @param {Number} [options.port] The port where to bind the server
   * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S server to use
   * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or not to skip UTF-8 validation for text and close messages
   * @param {Function} [options.verifyClient] A hook to reject connections
   * @param {Function} [callback] A listener for the `listening` event
   */
  constructor ({
    protocol = WseJSON,
    identify,
    cpu_limit = 1,
    init = true,
    ...options
  }) {
    if (!identify) throw new Error('identify handler is missing!')

    this.clients = new Map(/* { ID: WseClient } */)
    this.protocol = new protocol()
    this.options = options
    this.server = null
    this.identify = identify
    this.cpu_limit = cpu_limit

    this.ignored = new Sig()
    this.joined = new Sig()
    this.left = new Sig()
    this.connected = new Sig()
    this.disconnected = new Sig()
    this.error = new Sig()
    this.challenger = null
    this.channel = new EE()

    this.logger = null

    if (init) this.init()
  }


  use_challenge (challenger) {
    if (typeof challenger === 'function') {
      this.challenger = challenger
    } else {
      throw new Error('challenger argument is not a function!')
    }
  }

  handle_connection (conn, req) {
    if (conn.protocol !== this.protocol.name) {
      return conn.close(1000, WSE_REASON.PROTOCOL_ERR)
    }

    this.log('handle_connection', conn.protocol)

    conn[_client_id] = null
    conn[_valid_stat] = CLIENT_STRANGER
    conn[_meta] = {}
    conn[_id] = '' // todo: uuid?

    // RESOLVING IPV4 REMOTE ADDR
    conn.remote_addr = req.headers['x-forwarded-for'] || req.connection.remoteAddress
    if (conn.remote_addr.substr(0, 7) === '::ffff:') conn.remote_addr = conn.remote_addr.substr(7)

    // todo: should be able to override by meta
    conn.pub_host = conn.remote_addr
  }

  handle_valid_message (conn, msg) {
    this.log(conn[_client_id], 'handle_valid_message', msg)
    const client = this.clients.get(conn[_client_id])
    this.channel.emit(msg.c, client, msg.dat, conn[_id]) || this.ignored.emit(client, msg.c, msg.dat, conn[_id])
  }

  handle_stranger_message (conn, msg) {
    this.log('handle_stranger_message', msg)

    if (conn[_valid_stat] === CLIENT_STRANGER) {
      if (msg.c === this.protocol.hi) {
        conn[_valid_stat] = CLIENT_VALIDATING
        conn[_payload] = msg.dat.payload

        Object.assign(conn[_meta], msg.dat.meta || {})

        if (typeof this.challenger === 'function') {
          this.challenger(conn[_payload], conn[_meta], (quest) => {
            conn[_challenge_quest] = quest
            conn.send(this.protocol.pack('challenge', quest))
            conn[_valid_stat] = CLIENT_CHALLENGED
          })
          return
        }
      } else {
        conn.close(1000, WSE_REASON.PROTOCOL_ERR)
        return
      }
    }

    if (conn[_valid_stat] === CLIENT_CHALLENGED) {
      if (msg.c === this.protocol.challenge) {
        conn[_challenge_response] = msg.dat
        this.log('challenge response', msg.dat)
      } else {
        conn.close(1000, WSE_REASON.PROTOCOL_ERR)
      }
    }

    const identify = (client_id, welcome_payload) => {
      this.identify_connection(conn, client_id, welcome_payload, msg)
    }

    this.identify({
      payload: conn[_payload],
      meta: conn[_meta],
      identify,
      challenge: typeof this.challenger === 'function'
          ? { quest: conn[_challenge_quest], response: conn[_challenge_response] }
          : null,
      id: conn[_id],
    })
  }

  identify_connection (conn, client_id, welcome_payload, msg) {
    if (!client_id) {
      conn.close(1000, WSE_REASON.NOT_AUTHORIZED)
      return
    }

    this.log(client_id, 'resolved', msg.dat.payload, welcome_payload)

    conn[_client_id] = client_id
    conn[_id] = conn_id_gen()
    conn[_valid_stat] = CLIENT_VALID

    let client = this.clients.get(conn[_client_id])

    if (client) {
      client._conn_add(conn)
      client.send(this.protocol.welcome, welcome_payload, conn[_id])
      this.connected.emit(conn)
    } else {
      const client = new WseClient(this, conn)
      this.clients.set(client.id, client)
      client.send(this.protocol.welcome, welcome_payload)
      this.connected.emit(conn)
      this.joined.emit(client, msg.dat.meta || {})
    }
  }

  init () {
    this.server = new WebSocket.Server(this.options)
    this.server.on('connection', (conn, req) => {
      this.handle_connection(conn, req)

      conn.on('message', (message) => {
        if (conn[_valid_stat] === CLIENT_VALIDATING) return

        let msg = ''
        try {
          msg = this.protocol.unpack(message)
        } catch (err) {
          this.error.emit(err, (`${ conn[_client_id] }#${ conn[_id] }` || 'stranger') + ' sent broken message')
          if (conn[_client_id] && this.clients.has(conn[_client_id])) {
            this.clients.get(conn[_client_id])._conn_drop(conn[_id], WSE_REASON.PROTOCOL_ERR)
          } else {
            conn.removeAllListeners()
            conn.close(1000, WSE_REASON.PROTOCOL_ERR)
          }
          return
        }

        switch (conn[_valid_stat]) {
          case CLIENT_VALID:
            return this.handle_valid_message(conn, msg)
          case CLIENT_STRANGER:
          case CLIENT_CHALLENGED:
            return this.handle_stranger_message(conn, msg)
        }
      })

      conn.on('close', (code, reason) => {
        if (conn[_client_id] && this.clients.has(conn[_client_id])) {
          this.log(`${ conn[_client_id] }#${ conn[_id] }`, 'disconnected', code, reason)
          const client = this.clients.get(conn[_client_id])
          client._conn_drop(conn[_id])
        } else {
          this.log(`stranger disconnected`, code, reason)
          this.disconnected.emit(conn, code, reason)
        }
      })

      conn.onerror = (e) => this.error.emit(conn, e.code)
    })
  }

  log () {
    if (this.logger) this.logger(arguments)
  }

  broadcast (c, dat) {
    this.clients.forEach((client) => {
      client.send(c, dat)
    })
  }

  drop_client (id, reason = WSE_REASON.NO_REASON) {
    if (!this.clients.has(id)) return

    this.log(id, 'dropped', reason)

    const client = this.clients.get(id)

    if (client.conns.size) client.drop()
    this.left.emit(client, 1000, reason)

    this.clients.delete(client.id)
  }

  send_to (client_id, c, dat, conn_id) {
    const client = this.clients.get(client_id)
    if (client) client.send(c, dat, conn_id)
  }
}


class WseClient {
  /**
   * @param {WseServer} server - wsm instance
   * @param {WebSocket} conn - ws connection
   * @param {object} meta - object with user-defined data
   */
  constructor (server, conn, meta = {}) {
    this.id = conn[_client_id]
    this.conns = new Map()
    this.srv = server
    this.meta = conn[_meta]
    this.payload = conn[_payload]

    this._conn_add(conn)
  }

  _conn_add (conn) {
    this.conns.set(conn[_id], conn)
    if (this.srv.cpu_limit < this.conns.size) {
      const key_to_delete = this.conns[Symbol.iterator]().next().value[0]
      this._conn_drop(key_to_delete, WSE_REASON.OTHER_CLIENT_CONNECTED)
    }
    return this
  }

  _conn_drop (id, reason = WSE_REASON.NO_REASON) {
    const conn = this.conns.get(id)

    if (!conn) throw new Error('No such connection on this client')

    conn.removeAllListeners()

    if (conn.readyState === WebSocket.CONNECTING || conn.readyState === WebSocket.OPEN) {
      conn.close(1000, reason)
    }

    this.conns.delete(id)

    this.srv.disconnected.emit(conn, 1000, reason)

    if (this.conns.size === 0) {
      this.srv.drop_client(this.id, reason)
    }

    this.srv.log(`dropped ${ this.id }#${ id }`)
  }

  /**
   * Send a message to the client
   * @param {string} c - message id
   * @param {string|number|object} dat - payload
   * @param {string} conn_id id of specific connection to send. omit to send on al the connections of this client
   * @returns {boolean} - true if connection was opened, false - if not.
   */
  send (c, dat, conn_id = '') {
    if (conn_id) {
      const conn = this.conns.get(conn_id)
      if (conn.readyState === WebSocket.OPEN) {
        conn.send(this.srv.protocol.pack(c, dat))
      }
    } else {
      this.srv.log(`send to ${ this.id }`, c, dat)
      this.conns.forEach(conn => {
        if (conn.readyState === WebSocket.OPEN) {
          conn.send(this.srv.protocol.pack(c, dat))
        }
      })
    }
  }

  drop (reason = WSE_REASON.NO_REASON) {
    this.conns.forEach((val, key) => this._conn_drop(key, reason))
  }
}


