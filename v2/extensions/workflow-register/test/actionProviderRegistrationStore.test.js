const assert = require("node:assert/strict")
const { test } = require("node:test")
const { ActionProviderRegistrationStore } = require("../out/core/actionProviderRegistrationStore")

function disposable(label, calls, options = {}) {
  return {
    dispose: () => {
      calls.push(label)
      if (options.throwOnDispose) throw new Error(`${label} failed`)
    }
  }
}

test("registration store removes manually disposed entries and does not dispose them twice", () => {
  const calls = []
  const store = new ActionProviderRegistrationStore()
  const first = store.track(disposable("first", calls))
  store.track(disposable("second", calls))

  first.dispose()
  store.dispose()
  store.dispose()

  assert.deepEqual(calls, ["first", "second"])
})

test("registration store disposes all remaining entries even when one disposal throws", () => {
  const calls = []
  const store = new ActionProviderRegistrationStore()
  store.track(disposable("first", calls))
  store.track(disposable("second", calls, { throwOnDispose: true }))
  store.track(disposable("third", calls))

  assert.throws(() => store.dispose(), /second failed/)
  assert.deepEqual(calls, ["third", "second", "first"])
  store.dispose()
  assert.deepEqual(calls, ["third", "second", "first"])
})

test("registration store rejects and disposes entries tracked after shutdown", () => {
  const calls = []
  const store = new ActionProviderRegistrationStore()
  store.dispose()

  assert.throws(
    () => store.track(disposable("late", calls)),
    /registration store is disposed/
  )
  assert.deepEqual(calls, ["late"])
})
