const request = require('request-promise-native')
const crc32 = require('crc32')
const joi = require('joi')
const {
  arrayToObj,
  checksumHeader,
  enrichError,
  extractGroups,
  extractValidate,
  getParamNames,
  isApi
} = require('mini-service-utils')

/**
 * Internal API registration functions
 * @module register
 */

/**
 * Created operation should be regrouped according to their own group
 *
 * Registering operations could occur:
 * - on root context when operation belongs to group named afer the service
 * - on group subobject when operation belongs to a different group
 *
 * @private
 * @param {Object} context       root context in which operations will be created
 * @param {String} group        group name currently processed
 * @param {Object} exposed      options describing local/remote service
 * @param {String} exposed.name of current service
 * @returns {Object} in which operations could be registered as functions
 */
const computeGroup = (context, group, exposed) => {
  // use group if it's not the service name
  if (group !== exposed.name) {
    // creates group if not present yet
    if (!(group in context)) {
      context[group] = {}
    }
    return context[group]
  }
  return context
}

/**
 * Checksum validation: fail if not compatible
 *
 * Extract actual checksum from Http response header, and compare it to expected
 * If they differ:
 * - mark existing exposed API as deprecated. They will trigger an error
 * - fetch new exposed API, and creates new groups and function
 * - invoke the current API to fullfill invoked API
 *
 * @async
 * @private
 * @param {Response} response           Http response
 * @param {String} checksum             expected checksum
 * @param {Object} client               client object containing exposed API
 * @param {Object} client.exposed         descriptor of remote APIs, fetched during registration
 * @param {String} client.internalVersion client version, including remote server name and version
 * @param {Object} client.options         client options, including
 * @param {String} client.options.remote    remote server url
 * @param {Object} client.options.logger    logger used
 * @param {String} group                of currently invoked API
 * @param {String} id                   of currently invoked API
 * @param {Array<Any>} args             of currently invoked API
 * @returns requested API results
 * @throws {Error} when requested API isn't supported any more
 */
const checkCompatibility = async (response, checksum, client, group, id, args) => {
  const {options: {remote, logger}, exposed, internalVersion: previousVersion} = client
  const actualChecksum = response.headers[checksumHeader]
  // no checksum found
  if (!actualChecksum) {
    throw new Error(`Couldn't find checksum for API ${id} of ${group}`)
  }
  // checksum validation: fail if not compatible
  if (actualChecksum === checksum) {
    return response.body
  }
  logger.info('Remote server change detected')
  // server has changed, marks existing methods as deprecated
  exposed.apis.forEach(({group, id}) => {
    computeGroup(client, group, exposed)[id] = async () => {
      throw new Error(`Remote server isn't compatible with current client (expects ${previousVersion})`)
    }
    logger.debug(`API ${id} from ${group} deprecated`)
  })
  // then register once more
  await exports.registerFromServer(client, remote, logger)
  // now invokes the current API once more.
  return computeGroup(client, group, client.exposed)[id](...args)
}

/**
 * Ask a given server for APIs to register into the given context (remote client)
 *
 * @async
 * @param {Object} client   in which exposed api will be registered
 * @param {Number} client.options.timeout   timeout (in ms) to wait for response before aborting request
 * @param {String} url      remote server that exposes the APIs
 * @param {Bunyan} logger   logger used to report init
 */
exports.registerFromServer = async (client, url, logger) => {
  const {timeout} = client.options
  logger.info(`Fetch exposed API from ${url}`)
  const exposed = await request({
    method: 'GET',
    uri: `${url}/api/exposed`,
    json: true,
    timeout
  })
  // update client version
  client.internalVersion = `${exposed.name}@${exposed.version}`
  client.exposed = exposed
  const checksum = crc32(JSON.stringify(exposed.apis))
  // add one method to client per exposed api
  exposed.apis.forEach(({group, path, id, params}) => {
    logger.debug(`API ${id} from ${group} loaded (${client.internalVersion})`)
    const method = params.length ? 'POST' : 'GET'
    computeGroup(client, group, exposed)[id] = async (...args) => {
      try {
        const response = await request({
          method,
          uri: `${url}${path}`,
          body: arrayToObj(args, params),
          json: true,
          resolveWithFullResponse: true,
          timeout
        })
        const result = await checkCompatibility(response, checksum, client, group, id, args, timeout)
        logger.debug({api: {group, id}}, 'api sucessfully invoked')
        return result
      } catch (err) {
        if (err.statusCode === 400 && err.error) {
          throw new Error(err.error.message)
        }
        throw err
      }
    }
  })
}

/**
 * Register given APIs using into the given context (local client)
 *
 * All API groups will be initialized first (order matters) using the given options
 * APIs could be exposed:
 * - directly using `opts.name` & `opts.init`
 * - with groups using `opts.groups` and opts.groupOpts`
 *
 * @async
 * @param {Object} context  in which exposed api will be registered
 * @param {Object} opts     parameters used to declare APIs and APIs groups
 * @param {String} opts.name            service name
 * @param {String} opts.version         service version
 * @param {Function} [opts.init]        async initialization function that takes options as parameter and
 * resolves with exposed APIs (an object of async functions).
 * Takes precedence over `opts.groups` as a simpler alternative of API group.
 * The `opts` object itself will be used as options for this single API group.
 * @param {Array<Object>} [opts.groups] exposed APIs groups, an array containing for each group:
 * @param {String} opts.groups.name       group friendly name (a valid JavaScript identifier)
 * @param {Function} opts.groups.init     async initialization function that takes options as parameter and
 * resolves with exposed APIs (an object of async functions).
 * @param {Object} [opts.groupOpts]     per-group configuration. might contain a properties named after group
 * @param {Bunyan} logger   logger used to report init
 */
exports.registerLocal = async (context, opts, logger) => {
  const {groups, groupOpts} = extractGroups(opts)
  for (const {name: group, init} of groups) {
    // supports both synchronous and asynchronous init
    const apis = await init(Object.assign({logger}, groupOpts[group]))
    if (!isApi(apis)) continue

    for (const id in apis) {
      const validate = extractValidate(id, apis, groupOpts[group])
      // extrat param names for validation
      const params = getParamNames(apis[id])
      let schema = null

      if (validate) {
        // use hash instead of array for more understandable error messages
        schema = joi.object(arrayToObj(validate, params)).unknown(false)
      }

      // enrich context with a dedicated function
      computeGroup(context, group, opts)[id] = async (...args) => {
        // adds input validation
        if (schema) {
          const error = enrichError(schema.validate(arrayToObj(args, params)).error, id)
          if (error) {
            throw error
          }
        }
        try {
          // supports both synchronous and asynchronous api
          const result = await apis[id](...JSON.parse(JSON.stringify(args)))
          if (result !== undefined) {
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
      logger.debug(`API ${id} from ${group} loaded`)
    }
  }
}
