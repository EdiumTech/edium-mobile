const test = require('node:test')
const assert = require('node:assert/strict')

const modules = Promise.all([
  import('../src/join-code-editor.js'), import('@codemirror/state'), import('@codemirror/commands'),
  import('@codemirror/language'), import('@codemirror/autocomplete'),
])

test('search, folding and screen-reader phrases use Russian CodeMirror state translations', async () => {
  const [editor, { EditorState }] = await modules
  const state = EditorState.create({ extensions: EditorState.phrases.of(editor.editorPhrases) })
  assert.equal(state.phrase('Find'), 'Найти')
  assert.equal(state.phrase('replace all'), 'Заменить всё')
  assert.equal(state.phrase('Fold line'), 'Свернуть блок')
  assert.equal(state.phrase('Completions'), 'Варианты автодополнения')
  assert.equal(state.phrase('replaced $ matches', 3), 'Заменено совпадений: 3')
})

test('Go, Kotlin and Swift offer local keyword completions without a language server', async () => {
  const [editor, { EditorState }, , , { CompletionContext, completeFromList }] = await modules
  for (const language of ['go', 'kotlin', 'swift']) {
    const state = EditorState.create({ doc: 'ret', extensions: editor.editorLanguageConfiguration(language).extension })
    const sources = state.languageDataAt('autocomplete', 3)
    const results = await Promise.all(sources.map(source => (Array.isArray(source) ? completeFromList(source) : source)(new CompletionContext(state, 3, true))))
    assert.ok(results.some(result => result?.options.some(option => option.label === 'return')), `${language} keyword suggestions`)
  }
})

test('source limit is measured in UTF-8 bytes and rejects an entire oversized paste', async () => {
  const [editor, { EditorState, EditorSelection }] = await modules
  assert.equal(editor.sourceByteLength('aя🙂'), 7)
  let warnings = 0
  const state = EditorState.create({ doc: 'keep this source', selection: EditorSelection.single(5, 9), extensions: editor.sourceGuard(() => { warnings += 1 }) })
  const oversized = state.update({ changes: { from: 5, to: 9, insert: '🙂'.repeat(16384) }, userEvent: 'input.paste' })
  assert.equal(oversized.newDoc.toString(), 'keep this source')
  assert.equal(oversized.docChanged, false)
  assert.equal(warnings, 1)
  const boundary = EditorState.create({ extensions: editor.sourceGuard() }).update({ changes: { from: 0, insert: 'я'.repeat(32768) } })
  assert.equal(boundary.newDoc.length, 32768)
  assert.equal(editor.sourceByteLength(boundary.newDoc.toString()), 65536)
})

test('read-only rejects direct document transactions, not just keyboard input', async () => {
  const [editor, { EditorState }] = await modules
  const state = EditorState.create({ doc: 'original', extensions: [EditorState.readOnly.of(true), editor.sourceGuard()] })
  const change = state.update({ changes: { from: 0, to: 8, insert: 'changed' } })
  assert.equal(change.newDoc.toString(), 'original')
})

test('all five real language parsers provide syntax and expected Enter indentation', async () => {
  const [editor, { EditorState, EditorSelection }, { insertNewlineAndIndent }, { ensureSyntaxTree, indentUnit, getIndentUnit }] = await modules
  const headers = {
    javascript: 'function solve(input) {', python: 'def solve(data):', go: 'func Solve(input map[string]any) map[string]any {',
    kotlin: 'fun solve(input: Map<String, Any?>): Map<String, Any?> {', swift: 'func solve(_ input: [String: Any]) -> [String: Any] {',
  }
  for (const [language, doc] of Object.entries(headers)) {
    const configuration = editor.editorLanguageConfiguration(language)
    let state = EditorState.create({ doc, selection: EditorSelection.cursor(doc.length), extensions: [configuration.extension, indentUnit.of(configuration.indentation), EditorState.tabSize.of(4)] })
    const tree = ensureSyntaxTree(state, state.doc.length, 1000)
    assert.ok(tree && tree.length === doc.length, `${language} has a real syntax tree`)
    assert.equal(getIndentUnit(state), language === 'javascript' ? 2 : 4)
    assert.equal(insertNewlineAndIndent({ state, dispatch: transaction => { state = transaction.state } }), true)
    assert.equal(state.doc.toString(), `${doc}\n${configuration.indentation}`, `${language} auto-indentation`)
  }
})

test('real CodeMirror history is independent per document and survives state reuse', async () => {
  const [editor, { EditorState, EditorSelection }, { history, undo, redo, undoDepth, redoDepth }] = await modules
  function document(value) { return EditorState.create({ doc: value, extensions: [history(), editor.sourceGuard()] }) }
  let first = document('first')
  let second = document('second')
  first = first.update({ changes: { from: 5, insert: ' edited' }, selection: EditorSelection.cursor(12), userEvent: 'input.type' }).state
  second = second.update({ changes: { from: 6, insert: ' other' }, userEvent: 'input.type' }).state
  const cached = new Map([['task:python', first], ['task:go', second]])
  first = cached.get('task:python')
  assert.equal(first.selection.main.head, 12)
  assert.equal(undoDepth(first), 1)
  undo({ state: first, dispatch: transaction => { first = transaction.state } })
  assert.equal(first.doc.toString(), 'first')
  assert.equal(redoDepth(first), 1)
  assert.equal(second.doc.toString(), 'second other')
  redo({ state: first, dispatch: transaction => { first = transaction.state } })
  assert.equal(first.doc.toString(), 'first edited')
})

test('bracket insertion uses real CodeMirror transactions', async () => {
  const [editor, { EditorState }, , , { insertBracket }] = await modules
  const state = EditorState.create({ extensions: editor.editorLanguageConfiguration('javascript').extension })
  const transaction = insertBracket(state, '(')
  assert.equal(transaction.newDoc.toString(), '()')
  assert.equal(transaction.newSelection.main.head, 1)
})

test('Tab at a middle caret indents the line; Shift-Tab reverses it without inserting into code', async () => {
  const [editor, { EditorState, EditorSelection }, , { indentUnit }] = await modules
  for (const language of ['javascript', 'python', 'go']) {
    const configuration = editor.editorLanguageConfiguration(language)
    let state = EditorState.create({ doc: 'return value', selection: EditorSelection.cursor(6),
      extensions: [configuration.extension, indentUnit.of(configuration.indentation), EditorState.tabSize.of(4), editor.sourceGuard()] })
    editor.editorTab({ state, dispatch: transaction => { state = transaction.state } })
    assert.equal(state.doc.toString(), `${configuration.indentation}return value`)
    assert.equal(state.selection.main.head, 6 + configuration.indentation.length)
    editor.editorTab({ state, dispatch: transaction => { state = transaction.state } }, true)
    assert.equal(state.doc.toString(), 'return value')
    assert.equal(state.selection.main.head, 6)
  }
})

test('Tab and Shift-Tab navigate accepted completion snippet fields before indentation', async () => {
  const [editor, { EditorState }, , , { snippet, hasNextSnippetField }] = await modules
  let state = EditorState.create({ extensions: editor.editorLanguageConfiguration('javascript').extension })
  const target = { get state() { return state }, dispatch: transaction => { state = transaction.state } }
  snippet('function ${name}(${params}) {\n\t${body}\n}')(target, null, 0, 0)
  const source = state.doc.toString()
  const selected = () => state.sliceDoc(state.selection.main.from, state.selection.main.to)
  assert.equal(selected(), 'name')
  assert.equal(hasNextSnippetField(state), true)
  assert.equal(editor.editorTab(target), true)
  assert.equal(selected(), 'params')
  assert.equal(state.doc.toString(), source, 'Tab must not indent a line while traversing snippet placeholders')
  assert.equal(editor.editorTab(target, true), true)
  assert.equal(selected(), 'name')
  assert.equal(state.doc.toString(), source)
})
