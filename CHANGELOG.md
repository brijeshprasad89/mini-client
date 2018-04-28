# Changelog

## Unreleased
#### Added
- Support for Buffer and Stream parameters and results
- `init()` method is now optional: initialization will occur at first call if needed, whatever transport used
- Usage of Yarn 

## Fixed
- `client.exposed` contains the exposed descriptor, even with local transport (only http transport used to have one) 
- Http errors are now wrapped in Boom errors with http transport (only local transport was propagating them)

#### Changed
- Reformat internals to introduce transports: better extensibility
- **Breaking**: `buildClient()` throws only asynchronous validation errors  (`name` and `version` when using local service).

  Previously those errors were thrown synchronously.
- **Breaking**: when called, `init()` always refresh the exposed APIs. 
  This allows to force initialization proactively when suspecting a remote service change.

  Previously it was feching exposed APIs only once.
- **Breaking**: use [got](https://github.com/sindresorhus/got) instead of [request-promise-native](https://github.com/request/request-promise-native). 

  Thrown Error codes and message may be slighlty different.
- Reformat CHANGELOG to follow [Keep a Changelog](https://keepachangelog.com) recommandations
- New documentation with latest docma v2.0.0
- Dependencies update


## 4.1.0
#### Added
- Support for destructured parameters and rest parameters (previously was throwing errors)

#### Fixed
- Parsing error on exposed API written as `async a => {}` (usage of mini-serivce-utils@3.0.0)


## 4.0.0
#### Changed
- Replace promise-based code with async/await equivalent


## 3.3.0
#### Changed
- Replace internals to use latest validation mecanics

  Error message when invoking an API with too many parameters is slightly different.
  Previously: `must contain at most`, now: `"x" is not allowed`
- Update docs template from docdash to docma
- Dependencies update


## 3.2.1
#### Added
- Allow http request timeout configuration


## 3.2.0
#### Added
- Support synchronous `init()` and API functions
- API call fails with proper error it no checksum found

#### Changed
- Dependencies update


## 3.1.0
#### Added
- Automatically reloads exposed APIs when remote server has changed, and mark previous APIs as deprecated

#### Changed
- Use [standard.js](https://standardjs.com/) lint configuration

#### Fixed
- Don't fail if an API resolves or returns `undefined` value.


## 3.0.0
#### Added
- Use CRC32 checksum to validate that remote server is compatible

#### Changed
- **Breaking**: Groups are now used as sub-objects of client.
- Dependencies update


## 2.0.0
#### Added
- Allow to declare API without groups
- Allow to declare API validation in group options


#### Changed
- Introduce new terminology, with service descriptor and API groups
- **Breaking**: Force name+version on local client
- **Breaking**: When parsing exposed APIs, expect 'group' property instead of 'name'
- Better documentation
- More understandable error messages


## 1.0.0
#### Added
- initial release
