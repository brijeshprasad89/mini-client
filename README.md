[![NPM Version][npm-image]][npm-url]
[![Dependencies][david-image]][david-url]
[![Build][travis-image]][travis-url]
[![Test Coverage][coveralls-image]][coveralls-url]

# Minimalist µServices

Mini-client is a generic client for µServices built with [mini-service][mini-service-url].
The goal of mini-service is to give the minimal structure to implement a µService, that can be invoked locally or remotely.

Its principles are the following:
- very easy to add new service api endpoints
- easy to use client interface, same usage both locally and remotely
- hide deployment details and provide simple-yet-working solution
- promises based

mini-client & mini-service use the latest ES6 features, so they requires node 6+

Please checkout the [API reference][api-reference]

This project was kindly sponsored by [nearForm][nearform].


## Generic client for mini-services

Mini-client expose a generic client that can be wired to any service exposed with [mini-service][mini-service-url].
It provides an JavaScript object, that will fetch exposed APIs and creates a function for each of them.
This allow to invoke remote API like if they were plain function (it's a kind of good old RPC).

`caller-remote.js`
```javascript
const getClient = require('mini-client')

const calc = getClient({
  remote: 'http://localhost:3000'
})
calc.add(10, 5).then(sum => console.log(`Result is: ${sum}`))
```

Each API will end-up as a function (named after the API itself) that returns a promise.
Calling a function that isn't an exposed API will fails as if you try to invoked an unknown property of a regular
 object.

At the first call, mini-client fetch from the remote server the exposed API and creates the actual functions.

After being initialized, a mini-client can't be wired to another service, and will always try to invoke the one it
was initiliazed with.

Please note that you can call `init()` (see bellow), which doesn't do anything in "remote mode".


## Generic client for local services

While calling remote service is a realistic scenario for production environments, it's more convenient to run
all code in the same unit on dev (for debugging) and in continuous integration.

That's why mini-client can run the in "local mode".
In this case, the service definition is loaded at initialization.

`caller-local.js`
```javascript
const getClient = require('mini-client')
const calcService = require('./calc-service')

const calc = getClient(calcService)
calc.init().then(() =>
  calc.add(10, 5).then(sum => console.log(`Result is: ${sum}`))
)
```

Two noticeable difference with "remote mode":
- you need to provide the [service definition][service-definition-url] when creating the client
- you need to invoke `init()` prior to any call, which run exposed API initialization code
(as if the server were starting)

Then, you can invoke exposed APIs as function like in "remote mode".


## Validations

When invoking an exposed API, Mini-client can report parameters validation error.
If the distant service denies the operation because of a missing or errored parameter,
the returned promise will be rejected with the appropriate error message.


## Checksum compatibility and automatic reloads

When Mini-client is running in remote mode, it caches remote exposed API at first call.
But what would happened if a new version of remote server is redeployed ?

If the list of newer exposed API equals the one used when Mini-client was started, everything will be fine.
But if the two lists are different, then there's a chance that Mini-client will invoke URLs that don't exist any more, or requires different parameters.

To detect such changes, the CRC-32 checksum of the exposed Api list is sent by remote server in the `X-Service-CRC` response header.
On each call, Mini-client will compare that checksum with the one valid when it initialized.

If both value differs, then Mini-Client will:
- mark all existing functions as deprecated (they will reject further call with appropriate error)
  > Remote server isn't compatible with current client (expects service-name@x.y.z)
- fetch new list of exposed APIs on remote server, and creates/updates function
- invoke the current function to process with call (will succeed if supported)

When Mini-client is running on local mode, such situation can never happen.


## License

Copyright [Damien Simonin Feugas][feugy] and other contributors, licensed under [MIT](./LICENSE).


## 2.x to 3.x changes

Groups are now used as sub-objects of mini-client.

Given a service exposing:
- api `ping` without group *(or if group has same name as overall service)*
- group `a` with apis `ping` & `pong`
- group `b` with api `ping`

the final Mini-client will be:
```javascript
client = {
  ping(),
  a: {
    ping(),
    pong()
  },
  b: {
    ping()
  }
}
```


## 1.x to 2.x changes

Local services, as remote services, **must** have `name` and `version` options defined

When defining services, the `name` property was renamed to `group`:
```javascript
module.exports = [{
  group: 'calc', // was name previously
  init: () => Promise.resolve({
    add: (a, b) => ...,
    subtract: (a, b) => ...
  })
```


## Changelog

### 3.1.0
- Automatically reloads exposed APIs when remote server has changed, and mark previous APIs as deprecated
- Use [standard.js](https://standardjs.com/) lint configuration
- Don't fail if an API resolves or returns `undefined` value.

### 3.0.0
- [*Breaking change*] Groups are now used as sub-objects of client.
- Use CRC32 checksum to validate that remote server is compatible
- Dependencies update

### 2.0.0
- Introduce new terminology, with service descriptor and API groups
- Allow to declare API without groups
- Allow to declare API validation in group options
- [*Breaking change*] Force name+version on local client
- [*Breaking change*] When parsing exposed APIs, expect 'group' property instead of 'name'
- Better documentation
- More understandable error messages

### 1.0.0
- initial release

[nearform]: http://nearform.com
[feugy]: https://github.com/feugy
[mini-service-url]: https://github.com/feugy/mini-service
[david-image]: https://img.shields.io/david/feugy/mini-client.svg
[david-url]: https://david-dm.org/feugy/mini-client
[npm-image]: https://img.shields.io/npm/v/mini-client.svg
[npm-url]: https://npmjs.org/package/mini-client
[travis-image]: https://api.travis-ci.org/feugy/mini-client.svg
[travis-url]: https://travis-ci.org/feugy/mini-client
[coveralls-image]: https://img.shields.io/coveralls/feugy/mini-client/master.svg
[coveralls-url]: https://coveralls.io/r/feugy/mini-client?branch=master
[api-reference]: https://feugy.github.io/mini-client/
[mini-service-url]: https://github.com/feugy/mini-service/
[service-definition-url]: https://github.com/feugy/mini-service#example