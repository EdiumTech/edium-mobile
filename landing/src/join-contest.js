import './join-contest.css'
import './join-contest-layout.css'

const configuredApiBase = (import.meta.env.VITE_JOIN_API_BASE || '').replace(/\/$/, '')
const apiBase = configuredApiBase || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8787' : '')
const token = new URLSearchParams(location.hash.slice(1)).get('invite') || ''
const views = ['loading-view', 'error-view', 'intro-view', 'workspace', 'finished-view']
const $ = selector => document.querySelector(selector)
let contest = null
let activeTask = 0
let clockOffset = 0
let saveTimer = null
let saveQueue = Promise.resolve()
let lastSaveError = null
let timerHandle = null
let lastAnnouncedMinute = null
const announcedWarnings = new Set()

function show(id) { for (const view of views) $(`#${view}`).hidden = view !== id }
function formatDate(value) { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function serverNow() { return Date.now() + clockOffset }

async function api(path, options = {}) {
  if (!apiBase) throw new Error('API контеста ещё не настроен.')
  let response
  try {
    response = await fetch(`${apiBase}${path}`, { ...options, cache: 'no-store', headers: { ...options.headers, Authorization: `Contest ${token}` } })
  } catch { throw new Error('Не удалось связаться с сервером. Код в редакторе не потерян — попробуй ещё раз.') }
  let body = {}
  try { body = await response.json() } catch { /* use generic error */ }
  if (!response.ok) {
    const error = new Error(body.message || 'Операция не выполнена.')
    error.code = body.code
    error.status = response.status
    throw error
  }
  return body
}

function syncClock(value) { if (value) clockOffset = new Date(value).getTime() - Date.now() }

function finishView(state) {
  clearInterval(timerHandle)
  $('#timer').textContent = '00:00'
  const copy = {
    submitted: ['Решения отправлены', 'Спасибо! Команда Edium рассмотрит решения и свяжется с тобой.'],
    expired: ['Время истекло', 'Редактирование закрыто. Последняя сохранённая сервером версия осталась у команды Edium.'],
    revoked: ['Контест отозван', 'Эта персональная ссылка больше не действует. Если это ошибка, свяжись с командой Edium.'],
  }[state] || ['Контест недоступен', 'Свяжись с командой Edium, чтобы уточнить детали.']
  $('#finished-title').textContent = copy[0]
  $('#finished-message').textContent = copy[1]
  $('#finished-answers').replaceChildren(...(contest.tasks || []).map(task => {
    const row = document.createElement('div'); row.className = 'answer-summary'
    const title = document.createElement('strong'); title.textContent = task.title
    const value = document.createElement('code'); value.textContent = contest.answers?.[task.id]?.source ? 'Ответ сохранён' : 'Ответ не добавлен'
    row.append(title, value); return row
  }))
  show('finished-view')
}

function updateTimer() {
  if (!contest?.deadlineAt) return
  const left = Math.max(0, new Date(contest.deadlineAt).getTime() - serverNow())
  const totalSeconds = Math.ceil(left / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  $('#timer').textContent = `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  const roundedMinutes = Math.ceil(totalSeconds / 60)
  if (roundedMinutes !== lastAnnouncedMinute) {
    lastAnnouncedMinute = roundedMinutes
    $('#timer-live').textContent = `Осталось ${roundedMinutes} минут.`
  }
  const warning = [1, 5, 15].find(value => totalSeconds <= value * 60)
  if (warning && !announcedWarnings.has(warning)) {
    announcedWarnings.add(warning)
    $('#workspace-note').textContent = `Осталось ${warning} ${warning === 1 ? 'минута' : 'минут'}. Последняя сохранённая версия отправится автоматически.`
  }
  if (left <= 0) refreshContest()
}

function answerFor(task) { return contest.answers?.[task.id] || { source: task.starterCode || '', explanation: '', url: '' } }

function updateExplanationCounter() {
  const task = contest.tasks[activeTask]
  $('#explanation-help').textContent = `${$('#explanation').value.length} символов · для отправки нужно от ${task.minExplanation || 0} до ${task.maxExplanation || 2400}.`
}

function renderTask() {
  const task = contest.tasks[activeTask]
  const answer = answerFor(task)
  $('#task-index').textContent = `Задача ${activeTask + 1} из ${contest.tasks.length}`
  $('#task-title').textContent = task.title
  $('#task-description').textContent = task.description
  $('#task-input').textContent = task.summary
  $('#task-output').textContent = task.signature
  $('#task-examples').replaceChildren(...task.publicExamples.map(example => {
    const box = document.createElement('div'); box.className = 'example'
    const code = document.createElement('code'); code.textContent = `Вход: ${JSON.stringify(example.input)}\nРезультат: ${JSON.stringify(example.expected)}`
    box.append(code); return box
  }))
  $('#source').value = answer.source || task.starterCode || ''
  $('#explanation').value = answer.explanation || ''
  $('#explanation').minLength = task.minExplanation || 0
  $('#explanation').maxLength = task.maxExplanation || 2400
  updateExplanationCounter()
  $('#solution-url').value = answer.url || ''
  $('#test-results').replaceChildren()
  document.querySelectorAll('#task-tabs button').forEach((button, index) => button.setAttribute('aria-current', String(index === activeTask)))
}

function renderWorkspace() {
  show('workspace')
  const tabs = contest.tasks.map((task, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `${index + 1}. ${task.shortTitle || task.title}`
    button.addEventListener('click', async () => {
      try { await flushSave(); activeTask = index; renderTask() }
      catch (error) { $('#workspace-note').textContent = error.message }
    })
    return button
  })
  $('#task-tabs').replaceChildren(...tabs)
  renderTask()
  updateTimer()
  clearInterval(timerHandle)
  timerHandle = setInterval(updateTimer, 1000)
}

function renderContest(value) {
  contest = value
  syncClock(contest.serverNow)
  if (['submitted', 'expired', 'revoked'].includes(contest.state)) return finishView(contest.state)
  if (contest.state === 'started') return renderWorkspace()
  $('#intro-count').textContent = String(contest.tasks.length)
  $('#intro-duration').textContent = `${contest.durationMinutes} минут`
  $('#intro-start-before').textContent = formatDate(contest.startBefore)
  $('#timer').textContent = '—'
  show('intro-view')
}

function currentPayload() {
  return { source: $('#source').value, explanation: $('#explanation').value, url: $('#solution-url').value || null, revision: contest.revision }
}

function queueSave() {
  clearTimeout(saveTimer)
  $('#task-save-state').textContent = 'Есть несохранённые изменения'
  saveTimer = setTimeout(() => saveCurrent(), 700)
}

function saveCurrent() {
  clearTimeout(saveTimer)
  if (contest?.state !== 'started') return saveQueue
  const task = contest.tasks[activeTask]
  const draft = currentPayload()
  delete draft.revision
  $('#task-save-state').textContent = 'Сохраняем…'
  saveQueue = saveQueue.then(async () => {
    try {
      const result = await api(`/v1/contest/answers/${encodeURIComponent(task.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, revision: contest.revision }) })
      contest.revision = result.contest.revision
      contest.answers = result.contest.answers
      lastSaveError = null
      $('#task-save-state').textContent = 'Сохранено'
    } catch (error) {
      lastSaveError = error
      $('#task-save-state').textContent = error.code === 'revision_conflict' ? 'Открыта более новая версия в другой вкладке' : error.message
      if (['expired', 'revoked'].includes(error.code)) await refreshContest()
      throw error
    }
  }).catch(() => {})
  return saveQueue
}

async function flushSave() {
  if (saveTimer || lastSaveError) saveCurrent()
  await saveQueue
  if (lastSaveError) throw lastSaveError
}

async function refreshContest() {
  try { renderContest((await api('/v1/contest')).contest) }
  catch (error) { showError(error) }
}

function showError(error) {
  clearInterval(timerHandle)
  $('#error-title').textContent = error.status === 404 ? 'Ссылка недействительна' : 'Контест недоступен'
  $('#error-message').textContent = error.message
  show('error-view')
}

$('#start-button').addEventListener('click', async () => {
  if (!window.confirm(`Начать контест? После подтверждения таймер на ${contest.durationMinutes} минут нельзя будет остановить или сбросить.`)) return
  $('#start-button').disabled = true
  try { renderContest((await api('/v1/contest/start', { method: 'POST' })).contest) }
  catch (error) { showError(error) }
  finally { $('#start-button').disabled = false }
})

for (const field of ['#source', '#explanation', '#solution-url']) $(field).addEventListener('input', () => {
  if (field === '#explanation') updateExplanationCounter()
  queueSave()
})

$('#source').addEventListener('keydown', event => {
  if (event.key !== 'Tab') return
  event.preventDefault()
  const field = event.currentTarget
  field.setRangeText('  ', field.selectionStart, field.selectionEnd, 'end')
  queueSave()
})

$('#run-button').addEventListener('click', async () => {
  const button = $('#run-button'); button.disabled = true; button.textContent = 'Запускаем…'
  $('#test-results').textContent = ''
  try {
    await flushSave()
    const task = contest.tasks[activeTask]
    const { result } = await api('/v1/contest/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: task.id, source: $('#source').value }) })
    $('#test-results').replaceChildren(...result.tests.map(test => {
      const row = document.createElement('div'); row.className = `test-result ${test.passed ? 'pass' : 'fail'}`; row.textContent = `${test.passed ? '✓' : '×'} ${test.name}${test.message ? ` — ${test.message}` : ''}`; return row
    }))
  } catch (error) { $('#test-results').textContent = error.message }
  finally { button.disabled = false; button.textContent = 'Запустить тесты' }
})

$('#submit-button').addEventListener('click', async () => {
  if (!window.confirm('Отправить решения? После этого изменить их будет нельзя.')) return
  const button = $('#submit-button'); button.disabled = true
  try { await flushSave(); renderContest((await api('/v1/contest/submit', { method: 'POST' })).contest) }
  catch (error) { $('#workspace-note').textContent = error.message; button.disabled = false }
})

async function boot() {
  if (!/^[A-Za-z0-9_-]{64}$/.test(token)) return showError(Object.assign(new Error('Попроси команду Edium прислать новую персональную ссылку.'), { status: 404 }))
  try { renderContest((await api('/v1/contest/open', { method: 'POST' })).contest) }
  catch (error) { showError(error) }
}

boot()
