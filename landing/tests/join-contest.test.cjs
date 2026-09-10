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
  click() { if (!this.disabled) return this.fire('click') }
  focus() { this.focused = true }
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function page({ mobile = false, language = 'javascript' } = {}) {
  const elements = new Map()
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element())
    return elements.get(id)
  }
  const tasks = ['one', 'two', 'three'].map(id => ({ id, title: id, summary: '', description: '', signature: '', starterCode: 'function solve(input) { return null }', publicExamples: [] }))
  if (mobile) tasks.forEach((task, index) => {
    const kotlin = { label: 'Kotlin', starterCode: 'fun solve(input: Map<String, Any?>) = emptyMap<String, Any?>()', signature: 'fun solve(input: Map<String, Any?>): Map<String, Any?>' }
    const swift = { label: 'Swift', starterCode: 'func solve(_ input: [String: Any]) -> [String: Any] { [:] }', signature: 'func solve(_ input: [String: Any]) -> [String: Any]' }
    task.languages = index === 0 ? { kotlin } : index === 1 ? { swift } : { kotlin, swift }
    task.defaultLanguage = index === 1 ? 'swift' : 'kotlin'
  })
  const roleLanguages = {
    python: { label: 'Python', starterCode: 'def solve(data: dict) -> dict:\n    return {}', signature: 'def solve(data: dict) -> dict' },
    go: { label: 'Go', starterCode: 'package main\nfunc Solve(input map[string]any) map[string]any { return map[string]any{} }', signature: 'func Solve(input map[string]any) map[string]any' },
  }
  if (roleLanguages[language]) tasks.forEach(task => {
    task.languages = { [language]: roleLanguages[language] }
    task.defaultLanguage = language
  })
  let state = { id: 'demo', state: 'opened', revision: 1, tasks, answers: {}, trackLabel: 'Дизайн', durationMinutes: 90, startBefore: new Date(Date.now() + 86400000).toISOString() }
  if (mobile) state = { ...state, trackLabel: 'Мобильная разработка', languages: ['kotlin', 'swift'] }
  if (roleLanguages[language]) state = { ...state, trackLabel: language === 'python' ? 'AI/ML' : 'Бэкенд', languages: [language] }
  const requests = []
  const delays = new Map()
  const responses = new Map()
  const timers = new Map()
  let timerId = 0
  let editor = null
  const editorCalls = []
  function createCodeEditor(callbacks) {
    assert.equal(editor, null, 'the page creates one editor adapter')
    assert.equal(callbacks.parent, element('#code-editor'))
    // Keep the legacy test typing API as a proxy, not a real page textarea.
    // Page code must read/write through the adapter methods below.
    const field = element('#source')
    const documents = new Map()
    let activeKey = null
    const current = () => documents.get(activeKey)
    const status = () => {
      const document = current()
      const lines = field.value.split('\n')
      callbacks.onStatus?.({ line: lines.length, column: lines.at(-1).length + 1,
        canUndo: !field.readOnly && Boolean(document?.undo.length), canRedo: !field.readOnly && Boolean(document?.redo.length),
        indentLabel: document?.language === 'python' ? '4 пробела' : '2 пробела' })
    }
    const edit = value => {
      const document = current()
      if (!document || field.readOnly) { field.value = document?.value || ''; return false }
      if (document.value !== value) { document.undo.push(document.value); document.redo = []; document.value = value }
      field.value = value
      callbacks.onChange?.(value)
      status()
      return true
    }
    editor = {
      callbacks, documents,
      get activeKey() { return activeKey },
      getValue() { editorCalls.push({ method: 'getValue' }); return field.value },
      setDocument(document) {
        editorCalls.push({ method: 'setDocument', ...document })
        activeKey = document.key
        const previous = documents.get(activeKey)
        documents.set(activeKey, previous?.value === document.value ? { ...previous, ...document } : { ...document, undo: [], redo: [] })
        field.value = document.value
        status()
        return true
      },
      setReadOnly(value) { editorCalls.push({ method: 'setReadOnly', value }); field.readOnly = value; status() },
      focus() { editorCalls.push({ method: 'focus' }); field.focus() },
      undo() {
        editorCalls.push({ method: 'undo' })
        const document = current()
        if (field.readOnly || !document?.undo.length) return false
        document.redo.push(document.value); document.value = document.undo.pop(); field.value = document.value
        callbacks.onChange?.(field.value); status(); return true
      },
      redo() {
        editorCalls.push({ method: 'redo' })
        const document = current()
        if (field.readOnly || !document?.redo.length) return false
        document.undo.push(document.value); document.value = document.redo.pop(); field.value = document.value
        callbacks.onChange?.(field.value); status(); return true
      },
      indentAll() { editorCalls.push({ method: 'indentAll' }); return edit(`  ${field.value}`) },
      destroy() { editorCalls.push({ method: 'destroy' }) },
    }
    editorCalls.push({ method: 'create', parent: callbacks.parent })
    field.addEventListener('input', () => edit(field.value))
    return editor
  }
  const context = vm.createContext({
    document: {
      querySelector: element,
      querySelectorAll: () => element('#task-tabs').children,
      createElement: () => new Element(),
    },
    location: { hostname: '127.0.0.1', hash: `#invite=${'A'.repeat(64)}` },
    window: { confirm: () => true }, URLSearchParams, createCodeEditor,
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
      if (route.includes('/answers/')) state = { ...state, revision: state.revision + 1, answers: { ...state.answers, [route.split('/').pop()]: { source: body.source, language: body.language } } }
      if (route.endsWith('/submit')) state = { ...state, state: 'submitted' }
      const response = { ...state }
      if (route.includes('/answers/') || route.endsWith('/submit') || route.endsWith('/start')) delete response.tasks
      return { ok: true, json: async () => ({ contest: response }) }
    },
  })
  const source = fs.readFileSync(path.join(__dirname, '../src/join-contest.js'), 'utf8')
    .replace(/^import '\.\/[^']+'\n/gm, '')
    .replace(/^import\s+\{\s*createCodeEditor\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace('import.meta.env.VITE_JOIN_API_BASE', "''")
  vm.runInContext(source, context)
  await new Promise(resolve => setImmediate(resolve))
  await element('#start-button').fire('click')
  return { element, requests, delays, responses, tasks, editor, editorCalls,
    async flushTimers() {
      const pending = [...timers.values()]
      timers.clear()
      await Promise.all(pending.map(callback => callback()))
      await new Promise(resolve => setImmediate(resolve))
    },
  }
}

test('page uses the editor adapter without a legacy textarea dependency', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/join-contest.js'), 'utf8')
  const html = fs.readFileSync(path.join(__dirname, '../join/contest/index.html'), 'utf8')
  assert.match(source, /import\s+\{\s*createCodeEditor\s*\}\s+from/)
  assert.doesNotMatch(source, /\$\(['"]#source['"]\)/)
  assert.match(html, /id="code-editor"/)
  assert.doesNotMatch(html, /<textarea\b[^>]*\bid="source"/)
  assert.doesNotMatch(html, /editor-keyboard-help|source-help|Запусти проверку/)
  assert.equal((html.match(/id="submit-button"/g) || []).length, 1)
  assert.match(html, /workspace-actions[\s\S]*id="submit-button"/)
  assert.match(html, /id="editor-limit"[^>]*\brole="status"/)
  const app = await page()
  assert.ok(app.editor)
  assert.equal(app.editorCalls.filter(call => call.method === 'create').length, 1)
  assert.equal(app.editor.activeKey, 'one:javascript')
  const document = app.editor.documents.get('one:javascript')
  assert.equal(document.language, 'javascript')
  assert.match(document.label, /JavaScript/)
  assert.equal(document.value, app.tasks[0].starterCode)
  assert.equal(app.element('#editor-filename').textContent, 'solution.js')
  assert.equal(app.requests.some(request => request.route.includes('/answers/')), false, 'loading a document is not a user edit')
  await app.element('#source-label').click()
  assert.equal(app.element('#source').focused, true)
})

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
  assert.deepEqual(Object.keys(save.body).sort(), ['language', 'revision', 'source'])
  assert.equal(save.body.source, source)
  assert.match(app.element('#test-summary').textContent, /Пройдено 1 из 3 тестов/)
  assert.equal(app.element('#test-results').children.length, 3)
  assert.equal(app.element('#test-progress').value, 1)
  await app.element('#submit-button').fire('click')
  assert.equal(app.element('#finished-view').hidden, false)
  assert.equal(app.element('#finished-answers').children.length, 3)
})

test('mobile requires Kotlin and Swift tasks and preserves drafts when the optional language changes', async () => {
  const app = await page({ mobile: true })
  assert.match(app.element('#intro-format').textContent, /обязательно на Kotlin, одна — на Swift/)
  assert.equal(app.element('#source-label').textContent, 'Решение · Kotlin')
  assert.equal(app.editor.activeKey, 'one:kotlin')
  assert.equal(app.editor.documents.get('one:kotlin').language, 'kotlin')
  assert.equal(app.element('#editor-filename').textContent, 'solution.kt')
  assert.equal(app.element('#language-picker').hidden, true)
  await app.element('#task-tabs').children[1].fire('click')
  assert.equal(app.element('#source-label').textContent, 'Решение · Swift')
  assert.equal(app.editor.activeKey, 'two:swift')
  assert.equal(app.editor.documents.get('two:swift').language, 'swift')
  assert.equal(app.element('#editor-filename').textContent, 'solution.swift')
  assert.equal(app.element('#language-picker').hidden, true)
  await app.element('#task-tabs').children[2].fire('click')
  assert.equal(app.element('#language-picker').hidden, false)
  const kotlinDraft = 'fun solve(input: Map<String, Any?>) = input'
  app.element('#source').value = kotlinDraft
  app.element('#source').fire('input')
  app.element('#solution-language').value = 'swift'
  await app.element('#solution-language').fire('change')
  const firstSave = app.requests.find(request => request.route.includes('/answers/three'))
  assert.equal(firstSave.body.language, 'kotlin')
  assert.equal(firstSave.body.source, kotlinDraft)
  assert.equal(app.element('#source-label').textContent, 'Решение · Swift')
  assert.equal(app.editor.activeKey, 'three:swift')
  app.element('#source').value = 'func solve(_ input: [String: Any]) -> [String: Any] { input }'
  app.element('#source').fire('input')
  app.element('#solution-language').value = 'kotlin'
  await app.element('#solution-language').fire('change')
  assert.equal(app.element('#source').value, kotlinDraft)
  assert.equal(app.element('#source-label').textContent, 'Решение · Kotlin')
  assert.equal(app.editor.activeKey, 'three:kotlin')
  assert.equal(app.editor.documents.get('three:kotlin').value, kotlinDraft)
})

for (const [language, label, track, starter] of [
  ['python', 'Python', 'AI/ML', 'def solve(data: dict) -> dict:\n    return {}'],
  ['go', 'Go', 'Бэкенд', 'package main\nfunc Solve(input map[string]any) map[string]any { return map[string]any{} }'],
]) test(`${track} has a fixed ${label} editor, correct run/save language and complete counts`, async () => {
  const app = await page({ language })
  assert.equal(app.element('#workspace-track').textContent, `${track} · ${label}`)
  assert.match(app.element('#intro-format').textContent, new RegExp(`Все три задачи решаются на ${label}`))
  assert.doesNotMatch(app.element('#intro-format').textContent, /JavaScript/)
  for (const tab of app.element('#task-tabs').children) {
    await tab.fire('click')
    assert.equal(app.element('#language-picker').hidden, true)
    assert.equal(app.element('#source-label').textContent, `Решение · ${label}`)
    assert.equal(app.element('#source').value, starter)
    assert.equal(app.editor.documents.get(app.editor.activeKey).language, language)
  }
  app.element('#source').fire('input')
  app.responses.set('/v1/contest/run', { result: { passed: 2, total: 7, tests: Array.from({ length: 7 }, (_, i) => ({ name: String(i), passed: i < 2 })) } })
  await app.element('#run-button').fire('click')
  const save = app.requests.find(request => request.route.includes('/answers/'))
  const run = app.requests.find(request => request.route.endsWith('/run'))
  assert.equal(save.body.language, language)
  assert.equal(run.body.language, language)
  assert.equal(run.body.source, starter)
  assert.match(app.element('#test-summary').textContent, /Пройдено 2 из 7/)
  await app.element('#submit-button').fire('click')
  assert.equal(app.element('#finished-view').hidden, false)
  assert.match(app.element('#finished-answers').children[2].children[1].textContent, new RegExp(label))
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
  assert.equal(app.element('#test-summary').textContent, '')
  await app.element('#task-tabs').children[0].fire('click')
  assert.match(app.element('#test-summary').textContent, /Пройдено 1 из 1/)
  app.element('#source').value += '\n// changed'
  app.element('#source').fire('input')
  assert.match(app.element('#test-summary').textContent, /Код изменился/)
})

test('an in-flight mobile report stays with the submitted language', async () => {
  const app = await page({ mobile: true })
  await app.element('#task-tabs').children[2].fire('click')
  app.element('#source').value = 'fun solve(input: Map<String, Any?>) = input'
  app.element('#source').fire('input')
  const pending = deferred()
  app.delays.set('/v1/contest/run', pending)
  app.responses.set('/v1/contest/run', { result: { passed: 7, total: 7, tests: Array.from({ length: 7 }, (_, index) => ({ name: String(index), passed: true })) } })
  const running = app.element('#run-button').fire('click')
  app.element('#solution-language').value = 'swift'
  await app.element('#solution-language').fire('change')
  pending.resolve()
  await running
  const sent = app.requests.find(request => request.route.endsWith('/run'))
  assert.equal(sent.body.language, 'kotlin')
  assert.match(sent.body.source, /^fun /)
  assert.equal(app.element('#source-label').textContent, 'Решение · Swift')
  assert.equal(app.element('#test-summary').textContent, '')
  app.element('#solution-language').value = 'kotlin'
  await app.element('#solution-language').fire('change')
  assert.match(app.element('#test-summary').textContent, /Пройдено 7 из 7/)
})

test('switch and submit lock editing until the pending draft is saved', async () => {
  const app = await page()
  app.element('#source').value = 'function solve() { return 42 }'
  app.element('#source').fire('input')
  const pending = deferred()
  app.delays.set('/v1/contest/answers/one', pending)
  const switching = app.element('#task-tabs').children[1].fire('click')
  assert.equal(app.element('#source').readOnly, true)
  assert.equal(app.element('#editor-undo').disabled, true)
  assert.equal(app.element('#editor-redo').disabled, true)
  assert.equal(app.element('#editor-indent').disabled, true)
  const lockedSource = app.element('#source').value
  await app.element('#editor-indent').click()
  assert.equal(app.element('#source').value, lockedSource)
  await app.element('#task-tabs').children[2].fire('click')
  pending.resolve()
  await switching
  assert.equal(app.element('#task-title').textContent, 'two')
  assert.equal(app.element('#source').readOnly, false)
  assert.equal(app.element('#editor-indent').disabled, false)
  app.element('#source').value = 'function solve() { return 43 }'
  app.element('#source').fire('input')
  const pendingSubmit = deferred()
  app.delays.set('/v1/contest/answers/two', pendingSubmit)
  const submitting = app.element('#submit-button').fire('click')
  assert.equal(app.element('#source').readOnly, true)
  assert.equal(app.element('#editor-undo').disabled, true)
  assert.equal(app.element('#editor-redo').disabled, true)
  assert.equal(app.element('#editor-indent').disabled, true)
  assert.equal(app.requests.some(request => request.route.endsWith('/submit')), false)
  await app.editor.callbacks.onRun()
  assert.equal(app.requests.some(request => request.route.endsWith('/run')), false)
  await app.element('#task-tabs').children[2].fire('click')
  assert.equal(app.element('#task-title').textContent, 'two')
  pendingSubmit.resolve()
  await submitting
  assert.equal(app.element('#finished-view').hidden, false)
})

test('toolbar edits trigger autosave and the editor run shortcut submits the current document', async () => {
  const app = await page()
  const initial = app.element('#source').value
  const typed = 'function solve(input) { return input }'
  app.element('#source').value = typed
  app.element('#source').fire('input')
  assert.equal(app.element('#editor-undo').disabled, false)
  await app.element('#editor-undo').click()
  assert.equal(app.element('#source').value, initial)
  assert.equal(app.element('#editor-redo').disabled, false)
  await app.flushTimers()
  assert.equal(app.requests.filter(request => request.route.includes('/answers/')).at(-1).body.source, initial)
  await app.element('#editor-redo').click()
  assert.equal(app.element('#source').value, typed)
  await app.element('#editor-indent').click()
  const formatted = app.element('#source').value
  assert.notEqual(formatted, typed)
  assert.match(app.element('#task-save-state').textContent, /несохранённые/)
  await app.flushTimers()
  const saved = app.requests.filter(request => request.route.includes('/answers/')).at(-1)
  assert.equal(saved.body.source, formatted)
  app.responses.set('/v1/contest/run', { result: { passed: 1, total: 1, tests: [{ name: 'all', passed: true }] } })
  await app.editor.callbacks.onRun()
  await new Promise(resolve => setImmediate(resolve))
  const run = app.requests.filter(request => request.route.endsWith('/run')).at(-1)
  assert.equal(run.body.source, formatted)
  assert.equal(run.body.language, 'javascript')
  assert.ok(app.editorCalls.some(call => call.method === 'getValue'))
  assert.deepEqual(app.editorCalls.filter(call => ['undo', 'redo', 'indentAll'].includes(call.method)).map(call => call.method), ['undo', 'redo', 'indentAll'])
  await app.element('#editor-undo').click()
  assert.equal(app.element('#source').value, typed)
  assert.match(app.element('#test-summary').textContent, /Код изменился/)
})

test('editor status and rejected-edit notices update without changing or saving source', async () => {
  const app = await page({ language: 'python' })
  app.editor.callbacks.onStatus({ line: 8, column: 3, canUndo: true, canRedo: false, indentLabel: '4 пробела' })
  assert.match(app.element('#editor-position').textContent, /8.*3/)
  assert.match(app.element('#editor-indent-size').textContent, /4 пробела/)
  assert.equal(app.element('#editor-undo').disabled, false)
  assert.equal(app.element('#editor-redo').disabled, true)
  const before = app.element('#source').value
  app.editor.callbacks.onLimit()
  assert.ok(app.element('#editor-limit').textContent.trim())
  assert.equal(app.element('#source').value, before)
  await app.flushTimers()
  assert.equal(app.requests.some(request => request.route.includes('/answers/')), false)
  app.element('#source').value += '\n# edit after a rejected paste'
  app.element('#source').fire('input')
  assert.equal(app.element('#editor-limit').textContent, '')
})

test('run shortcut is ignored while the run action is already pending', async () => {
  const app = await page()
  const pending = deferred()
  app.delays.set('/v1/contest/run', pending)
  app.responses.set('/v1/contest/run', { result: { passed: 0, total: 1, tests: [{ name: 'all', passed: false }] } })
  const running = app.element('#run-button').fire('click')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(app.element('#run-button').disabled, true)
  await app.editor.callbacks.onRun()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(app.requests.filter(request => request.route.endsWith('/run')).length, 1)
  pending.resolve()
  await running
})
