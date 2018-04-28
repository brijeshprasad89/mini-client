const Lab = require('lab')
const assert = require('power-assert')
const bunyan = require('bunyan')
const getClient = require('../..')
const utils = require('../test-utils')
const {declareTests, invoke} = require('../test-suites')

const lab = exports.lab = Lab.script()
const {describe, it, before, beforeEach, after} = lab

// Test when client is local
const declareLocaleTests = (lab, makeClient, withGroups = true) => {
  const {it} = lab

  it('should handle synchronously failing APIs', async () => {
    let res
    try {
      res = await invoke(makeClient(), 'errored', withGroups)()
    } catch (err) {
      assert(err instanceof Error)
      assert(err.message.includes('Error while calling API errored:'))
      assert(err.message.includes('errored API'))
      return
    }
    throw new Error(`unexpected result ${JSON.stringify(res, null, 2)}`)
  })
}

describe('Local transport', () => {
  before(utils.shutdownLogger)

  after(utils.restoreLogger)

  it('should be initialized multiple times', async () => {
    const instance = getClient({name: 'multiple', version: '1.0.0', init: () => ({})})
    await instance.init()
    await instance.init()
  })

  describe('given a service with ordered list of groups', () => {
    const initOrder = []
    const ordered = Array.from({length: 3}).map((v, i) => ({
      name: `group${i}`,
      init: async opts => {
        if (opts.fail) throw new Error(`group ${i} failed to initialize`)
        initOrder.push(i)
        opts.logger.info(`from group ${i}`)
        return {ping: () => null}
      }
    }))
    const name = 'client'
    const version = '1.0.0'

    beforeEach(() =>
      initOrder.splice(0, initOrder.length)
    )

    it('should keep order when registering locally', async () => {
      await getClient({name, version, groups: ordered}).group0.ping()
      assert.deepEqual(initOrder, [0, 1, 2])
    })

    it('should stop initialisation at first error', async () => {
      let res
      try {
        res = await getClient({
          name,
          version,
          groups: ordered,
          groupOpts: {
            group1: {fail: true}
          }
        }).group0.ping()
      } catch (err) {
        assert(err instanceof Error)
        assert(err.message.includes('group 1 failed to initialize'))
        assert.deepEqual(initOrder, [0])
        return
      }
      throw new Error(`unexpected result ${JSON.stringify(res, null, 2)}`)
    })

    it('should ignore groups that doesn\'t expose an object', async () =>
      getClient({
        name,
        version,
        groups: [{
          name: 'initString',
          init: async () => 'initialized'
        }, {
          name: 'initBoolean',
          init: async () => true
        }, {
          name: 'initArray',
          init: async () => [{worked: true}]
        }, {
          name: 'initEmpty',
          init: async () => null
        }].concat(ordered)
      }).group0.ping()
    )

    it('should enforce group name', async () => {
      try {
        const server = await getClient({
          name,
          version,
          groups: [{
            init: async () => 'initialized'
          }]
        }).whatever()
        await server.stop()
      } catch (err) {
        assert.ok(err instanceof Error)
        assert(err.message.includes('"name" is required'))
        return
      }
      throw new Error('should have failed')
    })

    it('should enforce group init function', async () => {
      try {
        const server = await getClient({
          name,
          version,
          groups: [{
            name: 'test'
          }]
        }).whatever()
        await server.stop()
      } catch (err) {
        assert.ok(err instanceof Error)
        assert(err.message.includes('"init" is required'))
        return
      }
      throw new Error('should have failed')
    })

    it('should enforce client name', async () => {
      try {
        const server = await getClient({
          version,
          groups: [{
            name: 'group1',
            init: () => 'initialized'
          }]
        }).whatever()
        await server.stop()
      } catch (err) {
        assert.ok(err instanceof Error)
        assert(err.message.includes('"name" and "version" options'))
        return
      }
      throw new Error('should have failed')
    })

    it('should enforce client version', async () => {
      try {
        const server = await getClient({
          name,
          groups: [{
            name: 'group1',
            init: () => 'initialized'
          }]
        }).whatever()
        await server.stop()
      } catch (err) {
        assert.ok(err instanceof Error)
        assert(err.message.includes('"name" and "version" options'))
        return
      }
      throw new Error('should have failed')
    })

    it('should expose logger to groups', async () => {
      const logs = []
      const logger = bunyan.createLogger({name: 'test'})
      logger.info = msg => logs.push(msg)
      await getClient({
        name,
        version,
        logger,
        groups: ordered
      }).group0.ping()
      assert.deepEqual(logs, ['from group 0', 'from group 1', 'from group 2'])
    })
  })

  describe('given a service with init', () => {
    const {exposed, init} = require('../fixtures/sample')
    const name = 'sample-service'

    const makeClient = (opts = {}) =>
      getClient(Object.assign({
        name,
        version: '1.0.0',
        init,
        greetings: ' nice to meet you'
      }, opts))

    declareTests(lab, makeClient, exposed.map(api => Object.assign({}, api, {group: name})), false)

    declareLocaleTests(lab, makeClient, false)
  })

  describe('given a service with API group', () => {
    const {exposed: exposedSample, init: initSample} = require('../fixtures/sample')
    const {exposed: exposedSync, init: initSync} = require('../fixtures/synchronous')

    const makeClient = (opts = {}) =>
      getClient(Object.assign({
        name: 'sample-service',
        version: '1.0.0',
        groups: [{
          name: 'sample',
          init: initSample
        }, {
          name: 'synchronous',
          init: initSync
        }],
        groupOpts: {
          sample: {greetings: ' nice to meet you'}
        }
      }, opts))

    declareTests(lab, makeClient, exposedSample.concat(exposedSync))

    declareLocaleTests(lab, makeClient)

    it('should synchronously greets people', async () =>
      assert(await makeClient().synchronous.greeting('Jane') === 'Hello Jane !')
    )

    it('should validate parameter existence', async () => {
      let res
      try {
        res = await makeClient().synchronous.greeting()
      } catch (err) {
        assert(err instanceof Error)
        assert(err.message.includes('Incorrect parameters for API greeting'))
        assert(err.message.includes('["name" is required]'))
        return
      }
      throw new Error(`unexpected result ${JSON.stringify(res, null, 2)}`)
    })

    it('should handle undefined result', async () =>
      assert(await makeClient().synchronous.getUndefined() === undefined)
    )

    it('should propagate Boom errors', async () => {
      let res
      try {
        res = await makeClient().synchronous.boomError()
      } catch (err) {
        assert(err.isBoom === true)
        assert(err.output.statusCode === 401)
        assert(err.message.includes('Custom authorization error'))
        return
      }
      throw new Error(`unexpected result ${JSON.stringify(res, null, 2)}`)
    })
  })
})
