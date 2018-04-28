/**
 * Local implementation, running mini-service in the same process as mini-client.
 *
 * Dependencies:
 * - joi@13
 *
 * @module transports/local
 */
const {
  arrayToObj,
  enrichError,
  extractGroups,
  extractValidate,
  getParamNames,
  isApi
} = require('mini-service-utils')
const {Readable} = require('stream')
const {computeGroup} = require('../utils')

/**
 * Group of exposed API
 * @typedef {Object} APIGroup
 * @property {String} name    - group friendly name (a valid JavaScript identifier)
 * @property {Function} init  - async initialization function that takes options as parameter and
 *                              resolves with exposed APIs (an object of async functions)
 */

/**
 * Local transport options
 * @typedef {Object} LocalOptions
 * @property {String} name              - service name
 * @property {String} version           - service version
 * @property {Function} [init]          - async initialization function that takes options as parameter and
 *                                        resolves with exposed APIs (an object of async functions).
 *                                        Takes precedence over `groups` as a simpler alternative of API group.
 *                                        The LocalOptions object itself will be used as options for this single API group.
 * @property {Array<APIGroup>} [groups] - exposed APIs groups, in case `init` isn't provided
 * @property {Object} [groupOpts]       - per-group configuration.
 *                                        Might contain a properties named after group.
 *                                        Only used when `init` isn't provided)
 * @property {Bunyan} logger            - logger used for reporting
 */

/**
 * Register given APIs using into the given context (local client)
 *
 * All API groups will be initialized first (order matters) using the given options
 * APIs could be exposed:
 * - directly using `opts.name` & `opts.init`
 * - with groups using `opts.groups` and opts.groupOpts`
 *
 * Mutate mini-client instance to add functions and groups, besides giving value to
 * `version` and `exposed` properties.
 *
 * @async
 * @static
 * @function expose
 * @param {Client} client             - mini-client instance in which exposed api will be registered
 * @param {LocalOptions} opts         - mini-client options for local transport
 */
module.exports = async (client, opts) => {
  const joi = require('joi')

  const {name, version, logger} = opts
  // required name & version
  if (!name || !version) {
    throw new Error('Local client needs "name" and "version" options')
  }
  client.version = `${name}@${version}`
  // update exposed API list
  client.exposed = {
    name,
    version,
    apis: []
  }
  const {groups, groupOpts} = extractGroups(opts)
  for (const {name: group, init} of groups) {
    // supports both synchronous and asynchronous init
    const apis = await init(Object.assign({logger}, groupOpts[group]))
    if (!isApi(apis)) continue

    for (const id in apis) {
      const {
        hasStreamInput = false,
        hasBufferInput = false
      } = apis[id]

      // no payload parsing if explicitely disabled. No validation either.
      const serializeAndValidate = !hasStreamInput && !hasBufferInput

      const validate = extractValidate(id, apis, groupOpts[group])
      // extrat param names for validation
      const params = getParamNames(apis[id])
      let schema = null

      if (serializeAndValidate && validate) {
        // use hash instead of array for more understandable error messages
        schema = joi.object(arrayToObj(validate, params)).unknown(false)
      }

      // enrich context with a dedicated function
      computeGroup(client, group, opts)[id] = async (...args) => {
        // adds input validation
        if (schema) {
          const error = enrichError(schema.validate(arrayToObj(args, params)).error, id)
          if (error) {
            throw error
          }
        }
        try {
          // supports both synchronous and asynchronous api
          const result = await (serializeAndValidate
            ? apis[id](...JSON.parse(JSON.stringify(args)))
            : apis[id](args[0]))
          if (result !== undefined && !Buffer.isBuffer(result) && !(result instanceof Readable)) {
            // forces input/output serialization and deserialization to have consistent
            // result with remote client
            return JSON.parse(JSON.stringify(result))
          }
          return result
        } catch (exc) {
          // bubble any synchronous problem (not being async, serialization issue...)
          exc.message = `Error while calling API ${id}: ${exc.message}`
          throw exc
        }
      }
      client.exposed.apis.push({
        group,
        id,
        params,
        hasBufferInput,
        hasStreamInput
      })
      logger.debug(`API ${id} from ${group} loaded`)
    }
  }
}
