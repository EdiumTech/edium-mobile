import { basicSetup } from 'codemirror'
import { Compartment, EditorSelection, EditorState, Prec, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentMore, indentLess, indentSelection, redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { HighlightStyle, StreamLanguage, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { completeFromList, nextSnippetField, prevSnippetField } from '@codemirror/autocomplete'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { go } from '@codemirror/lang-go'
import { kotlin } from '@codemirror/legacy-modes/mode/clike'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { tags } from '@lezer/highlight'

export const MAX_SOURCE_BYTES = 65536
const encoder = new TextEncoder()
export function sourceByteLength(value) { return encoder.encode(value).length }

// Keys match CodeMirror's actual search, folding and accessibility phrases.
export const editorPhrases = Object.freeze({
  Find: 'Найти', Replace: 'Замена', next: 'Далее', previous: 'Назад', all: 'Выделить всё',
  'match case': 'С учётом регистра', regexp: 'Регулярное выражение', 'by word': 'Слово целиком',
  replace: 'Заменить', 'replace all': 'Заменить всё', close: 'Закрыть',
  'Go to line': 'Перейти к строке', go: 'Перейти', 'current match': 'Текущее совпадение', 'on line': 'в строке',
  'replaced match on line $': 'Совпадение заменено в строке $', 'replaced $ matches': 'Заменено совпадений: $',
  'Fold line': 'Свернуть блок', 'Unfold line': 'Развернуть блок', 'folded code': 'Свёрнутый код', unfold: 'Развернуть',
  'Folded lines': 'Свёрнуты строки', 'Unfolded lines': 'Развёрнуты строки', to: '—',
  Completions: 'Варианты автодополнения', 'Control character': 'Управляющий символ',
})

const kotlinLanguage = StreamLanguage.define(kotlin)
const swiftLanguage = StreamLanguage.define(swift)
const legacyKeywords = {
  kotlin: ['fun', 'val', 'var', 'if', 'else', 'when', 'for', 'while', 'return', 'null', 'true', 'false', 'is', 'in', 'as', 'class', 'object', 'data', 'listOf', 'mapOf', 'mutableListOf', 'mutableMapOf'],
  swift: ['func', 'let', 'var', 'if', 'else', 'guard', 'switch', 'case', 'for', 'while', 'return', 'nil', 'true', 'false', 'in', 'as', 'struct', 'enum', 'class', 'import'],
}

export function editorLanguageConfiguration(language) {
  const indentation = language === 'go' ? '\t' : language === 'javascript' ? '  ' : '    '
  const extension = {
    javascript: () => javascript(), python: () => python(), go: () => go(),
    kotlin: () => [kotlinLanguage, kotlinLanguage.data.of({ autocomplete: completeFromList(legacyKeywords.kotlin) })],
    swift: () => [swiftLanguage, swiftLanguage.data.of({ autocomplete: completeFromList(legacyKeywords.swift) })],
  }[language]
  if (!extension) throw new Error(`Unsupported editor language: ${language}`)
  return { extension: extension(), indentation, indentLabel: language === 'go' ? 'Tab · 4' : `${indentation.length} пробела` }
}

// Reject the entire transaction. A large paste must never silently replace a
// selection with a truncated prefix, and read-only must apply to commands too.
export function sourceGuard(onLimit = () => {}) {
  return EditorState.changeFilter.of(transaction => {
    if (!transaction.docChanged) return true
    if (transaction.startState.readOnly) return false
    if (sourceByteLength(transaction.newDoc.toString()) <= MAX_SOURCE_BYTES) return true
    onLimit()
    return false
  })
}

export function editorTab(editor, backwards = false) {
  if (editor.state.readOnly) return false
  // Snippet placeholders are real CodeMirror selections. Navigate them before
  // ordinary line indentation, so our high-priority Tab binding does not mask
  // the dynamic snippet keymap installed when a completion is accepted.
  return backwards ? prevSnippetField(editor) || indentLess(editor) : nextSnippetField(editor) || indentMore(editor)
}

const theme = EditorView.theme({
  '&': { height: '100%', minHeight: '380px', color: '#dde8f7', backgroundColor: '#101827', fontSize: '14px', border: 'none' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', maxHeight: '560px', fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace', lineHeight: '1.75' },
  '.cm-content': { minHeight: '380px', padding: '18px 0', caretColor: '#91c3ff', tabSize: '4' },
  '.cm-line': { padding: '0 22px 0 14px' },
  '.cm-gutters': { color: '#8598b3', backgroundColor: '#101827', border: 'none', padding: '0 4px 0 10px', minWidth: '48px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 4px' },
  '.cm-activeLine': { backgroundColor: '#1b2b414f' },
  '.cm-activeLineGutter': { color: '#b7d2f3', backgroundColor: '#1b2b41' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#31537c88' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#a6cdff', borderLeftWidth: '2px' },
  '.cm-matchingBracket': { color: '#c7eeff', backgroundColor: '#375c7866', outline: '1px solid #6fa7bf66' },
  '.cm-nonmatchingBracket': { color: '#ffb8b8', backgroundColor: '#93454555' },
  '.cm-selectionMatch': { backgroundColor: '#3b675755', outline: '1px solid #6ea58c66' },
  '.cm-searchMatch': { backgroundColor: '#d4ab5140', outline: '1px solid #d4ab5180' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#d4ab5180' },
  '.cm-foldPlaceholder': { color: '#9bb4d2', backgroundColor: '#213149', border: '1px solid #344760', borderRadius: '4px' },
  '.cm-tooltip': { color: '#dce8f8', backgroundColor: '#1b293c', border: '1px solid #3a4d66', borderRadius: '8px', boxShadow: '0 12px 28px #0005' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', maxHeight: '240px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { color: '#f0f6ff', backgroundColor: '#35537a' },
  '.cm-completionLabel': { padding: '2px 0' },
  '.cm-completionDetail': { color: '#9eb2ca', marginLeft: '12px' },
  '.cm-panels': { color: '#dce8f8', backgroundColor: '#182538' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid #30425b' },
  '.cm-search': { padding: '10px 12px', fontSize: '13px' },
  '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', margin: '4px 7px 4px 0' },
  '.cm-textfield': { color: '#e5effc', background: '#101827', border: '1px solid #475d7a', borderRadius: '5px', padding: '5px 7px' },
  '.cm-button': { color: '#dce8f8', background: '#2a3e59', border: '1px solid #476181', borderRadius: '5px', minHeight: '28px', padding: '4px 8px', fontSize: '12px', textTransform: 'none' },
  '.cm-search button[name=close]': { minHeight: '24px', height: '24px', width: '24px', padding: '0', background: 'transparent', color: '#c6d6e9', lineHeight: '24px' },
  '.cm-panel button:focus-visible, .cm-panel input:focus-visible': { outline: '2px solid #91c3ff', outlineOffset: '2px' },
  '.cm-specialChar': { color: '#ffa3a3' },
}, { dark: true })

const highlighting = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: '#c6a7ff' },
  { tag: [tags.string, tags.special(tags.string)], color: '#a8dbaa' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#e9bb83' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#8399b4', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#8fc8ff' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#89d4d8' },
  { tag: [tags.variableName, tags.propertyName], color: '#dde8f7' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: '#adc1db' },
  { tag: tags.invalid, color: '#ff999f', textDecoration: 'underline wavy' },
])

export function createCodeEditor({ parent, onChange = () => {}, onStatus = () => {}, onLimit = () => {}, onRun = () => {} }) {
  const documents = new Map()
  const readOnlyCompartment = new Compartment()
  const labelCompartment = new Compartment()
  let active = null
  let readOnly = false
  let switching = false
  let destroyed = false
  let limitPending = false

  function notifyLimit() {
    if (limitPending) return
    limitPending = true
    queueMicrotask(() => { limitPending = false; if (!destroyed) onLimit() })
  }
  function attributes(label) {
    return EditorView.contentAttributes.of({
      'aria-label': label || 'Код решения', 'aria-labelledby': 'source-label', 'aria-describedby': 'task-signature editor-limit',
      'aria-multiline': 'true', tabindex: '0', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off',
    })
  }
  function readonlyExtensions() {
    return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly), EditorView.contentAttributes.of({ 'aria-readonly': String(readOnly) })]
  }
  function status() {
    if (destroyed) return
    const state = view.state
    const line = state.doc.lineAt(state.selection.main.head)
    onStatus({ line: line.number, column: state.selection.main.head - line.from + 1,
      canUndo: !readOnly && undoDepth(state) > 0, canRedo: !readOnly && redoDepth(state) > 0,
      indentLabel: active?.language === 'go' ? 'Tab · 4' : active?.language && active.language !== 'javascript' ? '4 пробела' : '2 пробела' })
  }
  function createState(value, language, label) {
    const configuration = editorLanguageConfiguration(language)
    return EditorState.create({ doc: value, extensions: [
      basicSetup, theme, syntaxHighlighting(highlighting), configuration.extension, EditorState.phrases.of(editorPhrases),
      indentUnit.of(configuration.indentation), EditorState.tabSize.of(4),
      readOnlyCompartment.of(readonlyExtensions()), labelCompartment.of(attributes(label)), sourceGuard(notifyLimit),
      Prec.highest(keymap.of([
        { key: 'Mod-Enter', run: () => { if (!readOnly) onRun(); return true }, preventDefault: true },
        // CodeMirror's built-in Escape-then-Tab escape mode is preserved:
        // do not add an Escape handler or a raw DOM keydown Tab listener.
        { key: 'Tab', run: editor => editorTab(editor), shift: editor => editorTab(editor, true) },
      ])),
      EditorView.updateListener.of(update => {
        if (switching || destroyed) return
        if (active) documents.set(active.key, { ...active, state: update.state })
        if (update.docChanged) onChange(update.state.doc.toString())
        if (update.docChanged || update.selectionSet || update.transactions.length) status()
      }),
    ] })
  }
  const view = new EditorView({ parent, state: createState('', 'javascript', 'Код решения') })

  function editableCommand(command) {
    if (destroyed || readOnly || !active) return false
    const changed = command(view)
    view.focus()
    return changed
  }

  return {
    getValue() { return view.state.doc.toString() },
    setDocument({ key, value, language = 'javascript', label = 'Код решения' }) {
      if (destroyed) return false
      const source = String(value ?? '')
      if (sourceByteLength(source) > MAX_SOURCE_BYTES) { notifyLimit(); return false }
      if (typeof key !== 'string' || !key) throw new Error('Editor document key is required')
      if (active?.key === key && active.language === language && view.state.doc.toString() === source) {
        if (active.label !== label) {
          active = { key, language, label }
          view.dispatch({ effects: labelCompartment.reconfigure(attributes(label)), annotations: Transaction.addToHistory.of(false) })
        }
        status()
        return true
      }
      editorLanguageConfiguration(language)
      if (active) documents.set(active.key, { ...active, state: view.state })
      const saved = documents.get(key)
      const state = saved && saved.language === language && saved.state.doc.toString() === source
        ? saved.state : createState(source, language, label)
      active = { key, language, label }
      switching = true
      try {
        // Reconfiguration is not a document edit and must not enter undo or
        // autosave. Reuse cached state, preserving its selection and history.
        const configured = state.update({ effects: [readOnlyCompartment.reconfigure(readonlyExtensions()), labelCompartment.reconfigure(attributes(label))], annotations: Transaction.addToHistory.of(false) }).state
        if (view.state !== configured) view.setState(configured)
        documents.set(key, { ...active, state: view.state })
      } finally { switching = false }
      status()
      return true
    },
    setReadOnly(value) {
      if (destroyed) return
      readOnly = Boolean(value)
      view.dispatch({ effects: readOnlyCompartment.reconfigure(readonlyExtensions()), annotations: Transaction.addToHistory.of(false) })
      status()
    },
    focus() { if (!destroyed) view.focus() },
    undo() { return editableCommand(undo) },
    redo() { return editableCommand(redo) },
    indentAll() {
      return editableCommand(editor => {
        const original = editor.state.selection
        // The indentation command needs a full-document selection, but the
        // user's cursor should stay in place after formatting indentation.
        const temporary = editor.state.update({ selection: EditorSelection.single(0, editor.state.doc.length) }).state
        let transaction
        indentSelection({ state: temporary, dispatch: change => { transaction = change } })
        if (!transaction?.docChanged) return false
        editor.dispatch({ changes: transaction.changes, selection: original.map(transaction.changes), userEvent: 'input.indent' })
        return true
      })
    },
    destroy() { if (!destroyed) { destroyed = true; documents.clear(); view.destroy() } },
  }
}
