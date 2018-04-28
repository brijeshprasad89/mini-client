const Joi = require('joi')
const {unauthorized} = require('boom')

/**
 * List of exposed APIs
 */
exports.exposed = [{
  group: 'synchronous',
  id: 'greeting',
  params: ['name'],
  hasBufferInput: false,
  hasStreamInput: false
}, {
  group: 'synchronous',
  id: 'getUndefined',
  params: [],
  hasBufferInput: false,
  hasStreamInput: false
}, {
  group: 'synchronous',
  id: 'boomError',
  params: [],
  hasBufferInput: false,
  hasStreamInput: false
}, {
  group: 'synchronous',
  id: 'withExoticParameters',
  params: ['param1', 'param2', 'other'],
  hasBufferInput: false,
  hasStreamInput: false
}]

/**
 * Initialize service and returns an object containing APIs functions
 * @param {Object} opts service opts
 * @returns {Object} containing exposed APIs
 */
exports.init = (opts = {}) => {
  const apis = {
    /**
     * Kindly say hello, and demonstrate how to validate input parameters
     * @param {String} name person to greet
     * @returns {String} greeting string message
     */
    greeting (name) {
      return `Hello ${name}${opts.greetings || ''} !`
    },

    /**
     * API that returns undefined
     */
    getUndefined () {
      return undefined
    },

    /**
     * API that generates a 401 Boom error
     * @throws {Error} Unauthorized Boom error with custom message
     */
    boomError () {
      throw unauthorized('Custom authorization error')
    },

    /**
     * API with exotic signature including
     * - destructured parameters
     * - default values
     * - rest parameters
     * @param {Array} param1  - array of anything
     * @param {Object} param2 - object that could contain a property named c
     * @param {Any} other     - array of other parameters
     * @returns {Array} array of effective parameters
     */
    withExoticParameters ([a, b], {c: {d}} = {}, ...other) {
      return [a, b, d, ...other]
    }
  }

  // adds input validation
  apis.greeting.validate = [Joi.string().required()]

  return apis
}
