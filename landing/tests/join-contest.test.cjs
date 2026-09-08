const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Exercise the page's event handlers and asynchronous API flow without a browser dependency.
class Element {
  constructor() {
    this.value = ''; this.textContent = ''; this.children = []; this.attributes = {}
    this.events = {}; this.className = ''; this.disabled = false; this.readOnly = false
    this.classList = {
      add: name => { this.className += ` ${name}` },
      toggle: (name, enabled) => { if (enabled) this.className += ` ${name}` },
    }
  }
  addEventListener(name, handler) { this.events[name] = handler }
  replaceChildren(...children) { this.children = children }
  append(...children) { this.children.push(...children) }
  setAttribute(name, value) { this.attributes[name] = value }
  fire(name, extra = {}) { return this.events[name]?.({ currentTarget: this, preventDefault() {}, ...extra }) }
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function page() {
  const elements = new Map()
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element())
    return elements.get(id)
  }
  const tasks = ['one', 'two', 'three'].map(id => ({ id, title: id, summary: '', description: '', signature: '', starterCode: 'function solve(input) { return null }', publicExamples: [] }))
  let state = { id: 'demo', state: 'opened', revision: 1, tasks, answers: {}, trackLabel: 'Дизайн', durationMinutes: 90, startBefore: new Date(Date.now() + 86400000).toISOString() }
  const requests = []
  const delays = new Map()
  const responses = new Map()
  const timers = new Map()
  let timerId = 0
  const context = vm.createContext({
    document: {
      querySelector: element,
      querySelectorAll: () => element('#task-tabs').children,
      createElement: () => new Element(),
    },
    location: { hostname: '127.0.0.1', hash: `#invite=${'A'.repeat(64)}` },
    window: { confirm: () => true }, URLSearchParams,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId },
    clearTimeout: id => timers.delete(id),
    setInterval: () => 1, clearInterval() {},
    fetch: async (url, options) => {
      const route = new URL(url).pathname
      const body = JSON.parse(options.body || '{}')
      requests.push({ route, body })
      if (delays.has(route)) await delays.get(route).promise
      if (responses.has(route)) return { ok: true, json: async () => responses.get(route) }
      if (route.endsWith('/start')) state = { ...state, state: 'started', deadlineAt: new Date(Date.now() + 5400000).toISOString() }
      if (route.includes('/answers/')) state = { ...state, revision: state.revision + 1, answers: { ...state.answers, [route.split('/').pop()]: { source: body.source } } }
      if (route.endsWith('/submit')) state = { ...state, state: 'submitted' }
      const response = { ...state }
      if (route.includes('/answers/') || route.endsWith('/submit') || route.endsWith('/start')) delete response.tasks
      return { ok: true, json: async () => ({ contest: response }) }
    },
  })
  const source = fs.readFileSync(path.join(__dirname, '../src/join-contest.js'), 'utf8')
    .replace(/^import '\.\/[^']+'\n/gm, '').replace('import.meta.env.VITE_JOIN_API_BASE', "''")
  vm.runInContext(source, context)
  await new Promise(resolve => setImmediate(resolve))
  await element('#start-button').fire('click')
  return { element, requests, delays, responses, tasks }
}

test('code-only save and full test counts work with partial contest responses', async () => {
  const app = await page()
  assert.equal(app.element('#workspace').hidden, false)
  assert.equal(app.element('#workspace-track').textContent, 'Дизайн · JavaScript')
  const source = 'function solve(input) { return input }'
  app.element('#source').value = source
  app.element('#source').fire('input')
  app.responses.set('/v1/contest/run', { result: { passed: 1, total: 3, tests: [
    { name: 'пример', passed: true }, { name: 'граница', passed: false }, { name: 'пустой ввод', passed: false },
  ] } })
  await app.element('#run-button').fire('click')
  const save = app.requests.find(request => request.route.includes('/answers/'))
  assert.deepEqual(Object.keys(save.body).sort(), ['revision', 'source'])
  assert.equal(save.body.source, source)
  assert.match(app.element('#test-summary').textContent, /Пройдено 1 из 3 тестов/)
  assert.equal(app.element('#test-results').children.length, 3)
  assert.equal(app.element('#test-progress').value, 1)
  await app.element('#submit-button').fire('click')
  assert.equal(app.element('#finished-view').hidden, false)
  assert.equal(app.element('#finished-answers').children.length, 3)
})

test('test report stays with its task and becomes stale after source edits', async () => {
  const app = await page()
  const pending = deferred()
  app.delays.set('/v1/contest/run', pending)
  app.responses.set('/v1/contest/run', { result: { passed: 1, total: 1, tests: [{ name: 'all', passed: true }] } })
  const running = app.element('#run-button').fire('click')
  await app.element('#task-tabs').children[1].fire('click')
  pending.resolve()
  await running
  assert.match(app.element('#test-summary').textContent, /Запусти проверку/)
  await app.element('#task-tabs').children[0].fire('click')
  assert.match(app.element('#test-summary').textContent, /Пройдено 1 из 1/)
  app.element('#source').value += '\n// changed'
  app.element('#source').fire('input')
  assert.match(app.element('#test-summary').textContent, /Код изменился/)
})

test('switch and submit lock editing until the pending draft is saved', async () => {
  const app = await page()
  app.element('#source').value = 'function solve() { return 42 }'
  app.element('#source').fire('input')
  const pending = deferred()
  app.delays.set('/v1/contest/answers/one', pending)
  const switching = app.element('#task-tabs').children[1].fire('click')
  assert.equal(app.element('#source').readOnly, true)
  await app.element('#task-tabs').children[2].fire('click')
  pending.resolve()
  await switching
  assert.equal(app.element('#task-title').textContent, 'two')
  assert.equal(app.element('#source').readOnly, false)
  app.element('#source').value = 'function solve() { return 43 }'
  app.element('#source').fire('input')
  const pendingSubmit = deferred()
  app.delays.set('/v1/contest/answers/two', pendingSubmit)
  const submitting = app.element('#submit-button').fire('click')
  assert.equal(app.element('#source').readOnly, true)
  assert.equal(app.requests.some(request => request.route.endsWith('/submit')), false)
  await app.element('#task-tabs').children[2].fire('click')
  assert.equal(app.element('#task-title').textContent, 'two')
  pendingSubmit.resolve()
  await submitting
  assert.equal(app.element('#finished-view').hidden, false)
})
