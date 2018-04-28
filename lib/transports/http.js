/**
 * Http implementation wired to an Http server.
 *
 * Dependencies:
 * - got@8
 * - crc32@0.2
 * - boom@7
 * - bl@1
 *
 * @module transports/http
 */
const {arrayToObj} = require('mini-service-utils')
const {computeGroup, makeCompatibilityChecker} = require('../utils')

/**
 * Parse response body as JSON according to content type header
 * @private
 * @param {Object} response - Got response object
 * @returns {*} response body, potentially parsed
 */
const parseIfNeeded = (response, body) =>
  response.headers['content-type'].includes('application/json')
    ? JSON.parse(body)
    : body

/**
 * Http transport options
 * @typedef {Object} HttpOptions
 * @property {String} remote            - http(s) uri to distant service.
 * @property {String} [timeout = 20000] - HTTP request timeout (ms). Default to a 20 seconds
 * @property {Bunyan} logger            - logger used for reporting
 */

/**
 * Fetch Service descriptor from remote service, and register exposed API into the given instance.
 *
 * Mutate mini-client instance to add functions and groups, besides giving value to
 * `version` and `exposed` properties.
 *
 * @async
 * @static
 * @function expose
 * @param {Client} client     - mini-client instance in which exposed api will be registered
 * @param {HttpOptions} opts  - mini-client options for http transport
 */
module.exports = async (client, {remote, logger}) => {
  const got = require('got')
  const crc32 = require('crc32')
  const BufferList = require('bl')
  const Boom = require('boom')

  // default HTTP timeout
  const {timeout = 20e3} = client.options
  logger.info(`Fetch exposed API from ${remote}`)
  const {body: exposed} = await got(`${remote}/api/exposed`, {
    json: true,
    timeout
  })
  // update client version
  client.version = `${exposed.name}@${exposed.version}`
  client.exposed = exposed
  const checksum = crc32(JSON.stringify(exposed.apis))
  // add one method to client per exposed api
  exposed.apis.forEach(({group, path, id, params, hasStreamInput = false, hasBufferInput = false}) => {
    const serialize = !hasBufferInput && !hasStreamInput
    logger.debug(`API ${id} from ${group} loaded (${client.internalVersion})`)
    const method = params.length ? 'post' : 'get'
    computeGroup(client, group, exposed)[id] = async (...args) => {
      try {
        const response = await new Promise((resolve, reject) => {
          const output = new BufferList()
          let response
          let err
          got.stream(`${remote}${path}`, {
            method,
            body: serialize ? JSON.stringify(arrayToObj(args, params)) : args[0],
            headers: {
              'content-type': serialize ? 'application/json' : 'application/octet-stream'
            },
            timeout
          })
            .on('response', r => { response = r })
            .on('error', e => { err = e })
            .pipe(output)
            .on('finish', () => {
              if (response) {
                if (response.headers['content-type'] === 'application/octet-stream') {
                  // keep buffer if required
                  response.body = output.slice()
                } else if (response.headers['transfer-encoding'] === 'chunked') {
                  // send raw buffer if needed
                  response.body = output
                } else if (+response.headers['content-length'] !== 0) {
                  // extract data from writable stream, and parse if needed
                  response.body = parseIfNeeded(response, output.toString())
                }
              }
              if (err) {
                err.body = parseIfNeeded(err, output.toString())
                return reject(err)
              }
              resolve(response)
            })
        })
        logger.debug({api: {group, id}}, 'api sucessfully invoked')
        return await checkCompatibility(response, checksum, client, group, id, args, timeout)
      } catch (err) {
        if (err.body) {
          throw new Boom(err.body.message, Object.assign({statusCode: err.statusCode}, err.body))
        }
        throw err
      }
    }
  })
}

const checkCompatibility = makeCompatibilityChecker(module.exports)
