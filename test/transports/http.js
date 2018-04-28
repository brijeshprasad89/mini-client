const Lab = require('lab')
const assert = require('power-assert')
const got = require('got')
const moment = require('moment')
const wait = require('util').promisify(setTimeout)
const getClient = require('../..')
const utils = require('../test-utils')
const {declareTests} = require('../test-suites')
const {exposed, startServer} = require('../fixtures/sample-server')
const startModifiedServer = require('../fixtures/modified-server')

const lab = exports.lab = Lab.script()
const {describe, it, before, beforeEach, after} = lab

describe('Http transport', () => {
  const groupOpts = {greetings: ' nice to meet you'}

  let server

  const makeClient = (opts = {}) => getClient(Object.assign({
    remote: server.info.uri
  }, opts))

  before(utils.shutdownLogger)

  after(utils.restoreLogger)

  describe('given a remote service', () => {
    let client

    before(async () => {
      server = await startServer({groupOpts})
      client = makeClient()
    })

    after(() => server.stop())

    declareTests(lab, makeClient, exposed)

    it('should fail if non checksum can be found', async () => {
      let res
      try {
        res = await client.sample.noChecksum()
      } catch (err) {
        assert(err instanceof Error)
        assert(err.message.includes('Couldn\'t find checksum'))
        return
      }
      throw new Error(`unexpected result ${JSON.stringify(res, null, 2)}`)
    })

    it('should not add too much overhead', {timeout: 15e3}, async () => {
      const benchmark = {
        proxy: async () => client.sample.greeting('Jane'),
        direct: async () => (await got.post(`${server.info.uri}/api/sample/greeting`, {
          body: JSON.stringify({name: 'Jane'})
        })).body
      }

      const run = async (name, results, start, duration) => {
        try {
          await benchmark[name]()
          results.count++
        } catch (err) {
          results.errored++
          results.errors.push(err)
        }
        if (Date.now() - start >= duration) {
          return
        }
        await run(name, results, start, duration)
      }

      const runBench = async (names, results = {}) => {
        if (names.length === 0) {
          return results
        }
        const name = names.shift()
        results[name] = {count: 0, errored: 0, errors: []}
        // heating run
        await run(name, {count: 0, errored: 0, errors: []}, Date.now(), 1e3)
        // test run
        await run(name, results[name], Date.now(), 5e3)
        // next bench
        return runBench(names, results)
      }

      const results = await runBench(Object.keys(benchmark))
      const percentage = Math.round(results.proxy.count * 1000 / results.direct.count) / 10
      /* eslint no-console: 0 */
      console.log(results)
      console.log(`${percentage}%`)
      assert(results.direct.count > 1000)
      assert(results.proxy.count > 1000)
      assert.equal(results.direct.errored, 0)
      assert.equal(results.proxy.errored, 0)
      assert(percentage >= 75)
    })
  })

  describe('given no service', () => {
    let client

    beforeEach(async () => {
      if (server && server.stop) {
        await server.stop()
      }
      client = getClient({remote: 'http://localhost:3000'})
      server = null
    })

    after(() => server.stop())

    it('should not get remote exposed apis twice', async () => {
      server = await startServer()
      const invoked = []
      server.events.on('response', req => invoked.push(req.route.path))
      // init + ping
      await client.sample.ping()
      // ping only
      await client.sample.ping()
      // needed to get the 'response' event
      await wait(10)
      assert.equal(invoked.length, 3)
      assert.equal(invoked.filter(n => n.includes('exposed')).length, 1)
      assert.equal(invoked.filter(n => n.includes('ping')).length, 2)
    })

    it('should handle communication error', {timeout: 10e3}, async () => {
      try {
        await client.sample.ping() // no server available
      } catch (err) {
        assert(err instanceof Error)
        assert(err.message.includes('ECONNREFUSED'))
        return
      }
      throw new Error('should have failed')
    })

    it('should configure HTTP timeout', async () => {
      server = await startServer()
      try {
        await getClient(Object.assign({}, client.options, {timeout: 1})).sample.ping()
      } catch (err) {
        assert(err instanceof Error)
        assert(err.message.includes('timed out'))
        return
      }
      throw new Error('should have failed')
    })

    it('should handle communication error during init', async () => {
      try {
        await getClient(Object.assign({}, client.options, {timeout: 100})).init()
      } catch (err) {
        assert(err instanceof Error)
        assert(err.message.includes('timed out'))
        return
      }
      throw new Error('should have failed')
    })

    it('should report unknown operation', async () => {
      server = await startServer()
      try {
        // not exposed by server
        await client.unknown()
      } catch (err) {
        assert(err instanceof Error)
        assert(err.message.includes('unknown is not a function'))
        return
      }
      throw new Error('should have failed')
    })

    it('should report unknown group', async () => {
      server = await startServer()
      try {
        // not exposed by server
        await client.unknown.ping()
      } catch (err) {
        assert(err instanceof Error)
        assert(err.message.includes('Cannot read property \'ping\' of undefined'))
        return
      }
      throw new Error('should have failed')
    })

    it('should report unknown operation within group', async () => {
      server = await startServer()
      try {
        // not exposed by server
        await client.sample.unknown()
      } catch (err) {
        assert(err instanceof Error)
        assert(err.message.includes('sample.unknown is not a function'))
        return
      }
      throw new Error('should have failed')
    })

    it('should process operation not in groups', async () => {
      server = await startServer()
      const {time} = await client.noGroup()
      assert(moment(time).isValid())
    })
  })

  describe('given a remote server change', () => {
    let client
    before(async () => {
      server = await startServer({groupOpts})
      client = makeClient()
      await client.init()
      await server.stop()
      server = await startModifiedServer()
    })

    after(() => server.stop())

    it('should still invoke modified API with same signature', async () =>
      assert(await client.sample.greeting('Jane') === 'Hello dear Jane !')
    )

    it('should still invoke unmodified APIs', async () =>
      assert(await client.sample.getUndefined() === undefined)
    )

    it('should invoke new API', async () =>
      assert(moment((await client.modified.ping()).time).isValid())
    )

    it('should fail on deleted APIs', async () => {
      let res
      try {
        res = await client.sample.ping()
      } catch (err) {
        assert(err instanceof Error)
        assert(err.message.includes('isn\'t compatible with current client (expects sample-service@1.0.0)'))
        return
      }
      throw new Error(`unexpected result ${JSON.stringify(res, null, 2)}`)
    })
  })
})
