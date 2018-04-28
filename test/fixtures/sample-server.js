const {Server} = require('hapi')
const Boom = require('boom')
const Joi = require('joi')
const crc32 = require('crc32')
const assert = require('assert')
const {Readable} = require('stream')
process.env.READABLE_STREAM = 'disable' // make sure we don't use readable-stream polyfill
const BufferList = require('bl')
const multistream = require('multistream')
const {checksumHeader, getLogger, enrichError} = require('mini-service-utils')

/**
 * List of exposed APIs
 */
exports.exposed = [{
  group: 'sample',
  id: 'ping',
  params: [],
  path: '/api/sample/ping',
  hasBufferInput: false,
  hasStreamInput: false
}, {
  group: 'sample',
  id: 'greeting',
  params: ['name'],
  path: '/api/sample/greeting',
  hasBufferInput: false,
  hasStreamInput: false
}, {
  group: 'sample',
  id: 'failing',
  params: [],
  path: '/api/sample/failing',
  hasBufferInput: false,
  hasStreamInput: false
}, {
  group: 'sample',
  id: 'getUndefined',
  params: [],
  path: '/api/sample/get-undefined',
  hasBufferInput: false,
  hasStreamInput: false
}, {
  group: 'sample',
  id: 'boomError',
  params: [],
  path: '/api/sample/boom-error',
  hasBufferInput: false,
  hasStreamInput: false
}, {
  group: 'sample',
  id: 'noChecksum',
  params: [],
  path: '/api/sample/no-checksum',
  hasBufferInput: false,
  hasStreamInput: false
}, {
  group: 'sample',
  id: 'withExoticParameters',
  params: ['param1', 'param2', 'other'],
  path: '/api/sample/with-exotic-parameters',
  hasBufferInput: false,
  hasStreamInput: false
}, {
  group: 'sample',
  id: 'bufferHandling',
  params: ['buffer'],
  path: '/api/sample/buffer-handling',
  hasBufferInput: true,
  hasStreamInput: false
}, {
  group: 'sample',
  id: 'streamHandling',
  params: ['stream'],
  path: '/api/sample/stream-handling',
  hasBufferInput: false,
  hasStreamInput: true
}, {
  // cannot happen with real mini-service
  group: 'sample-service',
  id: 'noGroup',
  params: [],
  path: '/api/sample-service/no-group',
  hasBufferInput: true,
  hasStreamInput: true
}]

/**
 * Start Hapi Http server that comply with mini-service conventions
 * It exposes apis from ./fixtures/samples
 *
 * @param {Object} opts - server options, including
 * @param {Number} [opts.port = 3000] - listening port
 * @param {Object} [opts.logger] - bunyan compatible logger
 * @param {Object} [opts.groupOpts] - api configuration
 * @returns {Promise} promise - resolve with the Hapi server as parameter
 */
exports.startServer = async opts => {
  const options = Object.assign({
    port: 3000,
    logger: getLogger()
  }, opts)

  const checksum = crc32(JSON.stringify(exports.exposed))

  const {port, logger, groupOpts} = options
  logger.debug({port}, 'Configure server')

  const server = new Server({
    port,
    routes: {
      validate: {
        failAction: (r, h, err) => { throw err }
      }
    }
  })

  server.route({
    method: 'GET',
    path: '/api/sample/ping',
    config: {validate: {}},
    handler: (req, h) => h.response({time: new Date()}).header(checksumHeader, checksum)
  })

  server.route({
    method: 'GET',
    path: '/api/sample-service/no-group',
    config: {validate: {}},
    handler: (req, h) => h.response({time: new Date()}).header(checksumHeader, checksum)
  })

  server.route({
    method: 'POST',
    path: '/api/sample/greeting',
    config: {
      validate: {
        payload: (values, validationOpts) => {
          const schema = Joi.object({name: Joi.string().required()}).unknown(false)
          const err = enrichError(schema.validate(values).error, 'greeting')
          if (err) {
            throw err
          }
          return values
        }
      }
    },
    handler: (req, h) =>
      h.response(`Hello ${req.payload.name}${groupOpts.greetings || ''} !`)
        .header(checksumHeader, checksum)
  })

  server.route({
    method: 'GET',
    path: '/api/sample/failing',
    config: {validate: {}},
    handler: (req, h) => {
      throw new Boom('something went really bad', {statusCode: 599})
    }
  })

  server.route({
    method: 'GET',
    path: '/api/sample/get-undefined',
    handler: (req, h) => h.response(undefined).header(checksumHeader, checksum)
  })

  server.route({
    method: 'GET',
    path: '/api/sample/boom-error',
    handler: () => {
      throw Boom.unauthorized('Custom authorization error')
    }
  })

  server.route({
    method: 'POST',
    path: '/api/sample/with-exotic-parameters',
    handler: ({payload: {param1: [a, b], param2: {c: {d}}, other, ...rest}}, h) => {
      return h.response([a, b, d, other, ...Object.keys(rest).map(k => rest[k])])
        .header(checksumHeader, checksum)
    }
  })

  server.route({
    method: 'GET',
    path: '/api/sample/no-checksum',
    config: {validate: {}},
    handler: () => null
  })

  server.route({
    method: 'GET',
    path: '/api/exposed',
    handler: () => ({
      name: 'sample-service',
      version: '1.0.0',
      apis: exports.exposed
    })
  })

  server.route({
    method: 'POST',
    path: '/api/sample/buffer-handling',
    options: {
      payload: {
        parse: false,
        output: 'data'
      }
    },
    handler: ({payload: buffer}, h) => {
      assert(Buffer.isBuffer(buffer))
      return h
        .response(Buffer.concat([buffer, new Uint8Array([3, 4])]))
        .header(checksumHeader, checksum)
    }
  })

  server.route({
    method: 'POST',
    path: '/api/sample/stream-handling',
    options: {
      payload: {
        parse: false,
        output: 'stream'
      }
    },
    handler: ({payload: stream}) => {
      assert(stream instanceof Readable)
      const prefix = new BufferList()
      prefix.append('here is a prefix -- ', 'utf8')
      const res = multistream([prefix, stream])
      res.headers = {[checksumHeader]: checksum}
      return res
    }
  })

  try {
    await server.start()
    logger.info(server.info, 'server started')
    return server
  } catch (err) {
    logger.error(err, 'failed to start server')
    throw err
  }
}
