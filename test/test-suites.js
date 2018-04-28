const assert = require('power-assert')
const moment = require('moment')
const BufferList = require('bl')

const invoke = (client, operation, withGroups = true) => {
  if (!withGroups) {
    return client[operation]
  }
  return client.sample[operation]
}

exports.invoke = invoke

exports.declareTests = (lab, makeClient, exposed, withGroups = true) => {
  let client
  const {it, before, describe, beforeEach} = lab

  before(() => {
    client = makeClient()
  })

  it('should not be detected as a Promise', () =>
    // This will check the existence of then method on the Proxy
    Promise.resolve(makeClient())
  )

  it('should groups not be detected as a Promise', () =>
    // This will check the existence of then method on the Proxy
    Promise.resolve(makeClient().unknown)
  )

  it('should performs hidden initialization when invoking api', async () => {
    const freshClient = makeClient()
    assert.equal(freshClient.version, 'unknown')
    const result = await invoke(freshClient, 'ping', withGroups)()
    assert(moment(result.time).isValid())
    assert(typeof result.time === 'string')
    assert(freshClient.version === 'sample-service@1.0.0')
  })

  it('should performs explicit initialization', async () => {
    const freshClient = makeClient()
    assert.equal(freshClient.version, 'unknown')
    await freshClient.init()
    assert(freshClient.version === 'sample-service@1.0.0')
    const result = await invoke(freshClient, 'ping', withGroups)()
    assert(moment(result.time).isValid())
    assert(typeof result.time === 'string')
  })

  it('should greets people', async () => {
    const result = await invoke(client, 'greeting', withGroups)('Jane')
    assert(result === 'Hello Jane nice to meet you !')
  })

  it('should handle API errors', async () => {
    try {
      await invoke(client, 'failing', withGroups)()
    } catch (err) {
      assert(err instanceof Error)
      assert(err.message.includes('really bad'))
      return
    }
    throw new Error('should have failed')
  })

  it('should validate parameter existence', async () => {
    try {
      await invoke(client, 'greeting', withGroups)()
    } catch (err) {
      assert(err instanceof Error)
      assert(err.message.includes('Incorrect parameters for API greeting'))
      assert(err.message.includes('["name" is required]'))
      return
    }
    throw new Error('should have failed')
  })

  it('should validate parameter type', async () => {
    try {
      await invoke(client, 'greeting', withGroups)(18)
    } catch (err) {
      assert(err instanceof Error)
      assert(err.message.includes('must be a string'))
      return
    }
    throw new Error('should have failed')
  })

  it('should not allows extra parameters', async () => {
    try {
      await invoke(client, 'greeting', withGroups)('Jane', 'Peter')
    } catch (err) {
      assert(err instanceof Error)
      assert(err.message.includes('"1" is not allowed'))
      return
    }
    throw new Error('should have failed')
  })

  it('should handle undefined result', async () => {
    const res = await invoke(client, 'getUndefined', withGroups)()
    assert(res === undefined)
  })

  it('should handle API with exotic parameters', async () => {
    const res = await invoke(client, 'withExoticParameters', withGroups)([1, 2], {c: {d: 3}}, 4, 5, 6)
    assert.deepStrictEqual(res, [1, 2, 3, 4, 5, 6])
  })

  it('should send and receive buffers', async () => {
    const res = await invoke(client, 'bufferHandling', withGroups)(Buffer.from(new Uint8Array([1, 2])))
    assert(Buffer.compare(res, Buffer.from(new Uint8Array([1, 2, 3, 4]))) === 0)
  })

  it('should send and receive streams', async () => {
    const result = await new Promise((resolve, reject) => {
      const output = new BufferList()
      const input = new BufferList()

      invoke(client, 'streamHandling', withGroups)(input)
        .then(result => {
          result
            .on('end', () => resolve(output.toString()))
            .pipe(output)
            .on('error', reject)
        })
        .catch(reject)

      input.append('here is the message body', 'utf8')
    })
    assert(result === 'here is a prefix -- here is the message body')
  })

  it('should propagate Boom errors', async () => {
    try {
      await invoke(client, 'boomError', withGroups)()
    } catch (err) {
      assert(err.isBoom === true)
      assert(err.output.statusCode === 401)
      assert(err.message.includes('Custom authorization error'))
      return
    }
    throw new Error('should have failed')
  })

  it('should list exposed APIs', async () => {
    assert.deepStrictEqual(client.exposed, {
      name: 'sample-service',
      version: '1.0.0',
      apis: exposed
    })
  })

  describe('given a mocked logger', () => {
    const logs = []
    let client
    const logger = {
      debug: (...args) => logs.push(['debug'].concat(args)),
      info: (...args) => logs.push(['info'].concat(args)),
      error: (...args) => logs.push(['error'].concat(args)),
      warn: (...args) => logs.push(['warn'].concat(args))
    }

    const assertInitLog = (got = true) => {
      let trace = logs.find(log => /fetch exposed apis/.test(log[2]))
      assert(got ? trace : !trace)
      trace = logs.find(log => /client ready/.test(log[1]))
      assert(got ? trace : !trace)
    }

    beforeEach(() => {
      client = makeClient({logger})
      logs.splice(0, logs.length)
    })

    it('should not use proxy after first call', async () => {
      await invoke(client, 'ping', withGroups)()
      assertInitLog()
      logs.splice(0, logs.length)
      await invoke(client, 'ping', withGroups)()
      assertInitLog(false)
    })

    it('should refresh already initialized instance', async () => {
      assert.equal(client.version, 'unknown')
      await client.init()
      assert(client.version === 'sample-service@1.0.0')
      assertInitLog()
      await client.init()
      assert(client.version === 'sample-service@1.0.0')
      assertInitLog()
    })
  })
}
