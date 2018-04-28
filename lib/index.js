/**
 * Mini-client entry point
 * @module mini-client
 */
const {getLogger} = require('mini-service-utils')

const reserved = ['then', 'catch', 'finally']

/**
 * Generic client to a local or remote µService built with mini-service.
 * @class
 */
class Client {
  /**
   * Builds a client with a given transports.
   * - when `opts.remote` is provided, instanciate {@see transports/http|http} transport
   * - otherwise, instanciate {@see transports/local|local} transport
   *
   * @param {(LocalOptions|HttpOptions)} opts - client options as defined per transport
   */
  constructor (opts = {}) {
    /**
     * When initialized, stores list of exposed API
     * @type {Array<Object>}
     */
    this.exposed = []
    /**
     * Wired service's version, `unknown` until client is initialized
     * @type {String}
     */
    this.version = 'unknown'
    /**
     * Stores options passed to constructor
     * @type {(LocalOptions|HttpOptions)}
     */
    this.options = Object.assign({
      logger: getLogger({name: 'mini-client'})
    }, opts)
    const {logger, remote} = this.options

    const register = require(`./transports/${remote ? 'http' : 'local'}`)

    const getFunction = (target, groupOrName, name = null) => (...args) => {
      logger.debug({groupOrName, name}, `during ${groupOrName + (name ? `.${name}` : '')}, fetch exposed apis`)
      return register(target, this.options)
        .then(() => {
          // delete trap to boost performance: next calls will directly search into 'this'
          delete traps.get
          logger.debug('client ready')
          // now, invoke the API with initial arguments, but only group exists
          if (!(groupOrName in target)) {
            throw new TypeError(name
              ? `Cannot read property '${name}' of undefined`
              : `${groupOrName} is not a function`
            )
          }
          let method = target[groupOrName]
          // and if property is defined in group
          if (name) {
            if (!(name in method)) {
              throw new TypeError(`${groupOrName}.${name} is not a function`)
            }
            method = method[name]
          }
          return method(...args)
        })
    }

    const traps = {
      get (target, propKey) {
        // version and init are the only prop callable while proxy is still active
        if (['version', 'init', 'options'].includes(propKey)) {
          return target[propKey]
        }
        // reserved keyword that aren't defined must be undefined (thenable false-positive)
        if (reserved.includes(propKey)) {
          return undefined
        }
        // creates a function that will get exposed API from remote server
        return new Proxy(() => { /* eslint-disable-line no-empty */ }, {
          get (_1, subPropKey) {
            // reserved keyword that aren't defined must be undefined (thenable false-positive)
            if (reserved.includes(subPropKey)) {
              return undefined
            }
            return getFunction(target, propKey, subPropKey)
          },
          apply (_1, _2, args) {
            return getFunction(target, propKey)(...args)
          }
        })
      }
    }
    return new Proxy(this, traps)
  }

  /**
   * Explicitly force client initialization by registering exposed APIs as method.
   * Automatically updates API list and signatures, even if the instance is already initialized.
   * @async
   */
  async init () {
    if (this.version === 'unknown') {
      try {
        await this.explicitInit()
      } catch (err) {
        // ignore expected error, otherwise let it bubble
        if (!(err instanceof TypeError) || !/explicitInit is not a function/.test(err.message)) {
          throw err
        }
      }
    } else {
      // force registration once more if already initialized
      const register = require(`./transports/${this.options.remote ? 'http' : 'local'}`)
      await register(this, this.options)
    }
  }
}

/**
 * Creates a client that exposes remote or local µService's APIs.
 *
 * @static
 * @function getClient
 * @param {(LocalOptions|HttpOptions)} opts - options, see {@link #mini-client.Client|Client constructor}
 * @returns {Client} a client to use µService functionnalities
 */
module.exports = (...args) => new Client(...args)
