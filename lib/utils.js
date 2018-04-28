/**
 * Internal API registration functions
 * @module utils
 */
const {checksumHeader} = require('mini-service-utils')

/**
 * Bunyan compatible logger
 * @typedef {Object} Bunyan
 * @see {@link https://github.com/trentm/node-bunyan#log-method-api|Bunyan API}
 */

/**
 * Created operation should be regrouped according to their own group
 *
 * Registering operations could occur:
 * - on root context when operation belongs to group named afer the service
 * - on group subobject when operation belongs to a different group
 *
 * @param {Object} context    - root context in which operations will be created
 * @param {String} group      - group name currently processed
 * @param {Object} exposed    - options describing local/remote service
 * @param {String} exposed.name - of current service
 * @returns {Object} in which operations could be registered as functions
 */
exports.computeGroup = (context, group, exposed) => {
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
 * Generates checksum validation function for a given transport.
 *
 * @param {Function} register - register function for a given transport
 * @returns {compatibilityCheck} function to check compatibility
 */
exports.makeCompatibilityChecker = register =>
  /**
   * Checksum validation: fail if not compatible
   *
   * Extract actual checksum from Http response header, and compare it to expected
   * If they differ:
   * - mark existing exposed API as deprecated. They will trigger an error
   * - fetch new exposed API, and creates new groups and function
   * - invoke the current API to fullfill invoked API
   *
   * @name compatibilityCheck
   * @function
   * @async
   * @param {Response} response         - Http response
   * @param {String} checksum           - expected checksum
   * @param {Client} client             - client object containing exposed API
   * @param {String} group              - of currently invoked API
   * @param {String} id                 - of currently invoked API
   * @param {Array} args           - of currently invoked API
   * @returns requested API results
   * @throws {Error} when requested API isn't supported any more
   */
  async (response, checksum, client, group, id, args) => {
    const {options, exposed, version: previousVersion} = client
    const actualChecksum = response.headers[checksumHeader]
    // no checksum found
    if (!actualChecksum) {
      throw new Error(`Couldn't find checksum for API ${id} of ${group}`)
    }
    // checksum validation: fail if not compatible
    if (actualChecksum === checksum) {
      return response.body
    }
    options.logger.info('Remote server change detected')
    // server has changed, marks existing methods as deprecated
    exposed.apis.forEach(({group, id}) => {
      exports.computeGroup(client, group, exposed)[id] = async () => {
        throw new Error(`Remote server isn't compatible with current client (expects ${previousVersion})`)
      }
      options.logger.debug(`API ${id} from ${group} deprecated`)
    })
    // then register once more
    await register(client, options)
    // now invokes the current API once more.
    return exports.computeGroup(client, group, client.exposed)[id](...args)
  }
