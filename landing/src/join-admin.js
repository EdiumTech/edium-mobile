import './join-admin.css'

const configuredApiBase = (import.meta.env.VITE_JOIN_API_BASE || '').replace(/\/$/, '')
const apiBase = configuredApiBase || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://127.0.0.1:8787' : '')
const statusLabels = { new: 'Новая', reviewing: 'Рассматриваем', contacted: 'Связались', accepted: 'Принята', rejected: 'Отказ' }
const contestLabels = { invited: 'Приглашён', opened: 'Открыт', started: 'Идёт', submitted: 'Отправлен', expired: 'Истёк', revoked: 'Отозван' }

const authView = document.querySelector('#auth-view')
const applicationsView = document.querySelector('#applications-view')
const authForm = document.querySelector('#auth-form')
const accessTokenInput = document.querySelector('#access-token')
const authError = document.querySelector('#auth-error')
const statusFilter = document.querySelector('#status-filter')
const contestFilter = document.querySelector('#contest-filter')
const list = document.querySelector('#applications-list')
const listStatus = document.querySelector('#list-status')
const emptyState = document.querySelector('#empty-state')
const dialog = document.querySelector('#application-dialog')
const dialogStatus = document.querySelector('#dialog-status')
const candidateName = document.querySelector('#candidate-name')
const candidateDetails = document.querySelector('#candidate-details')
const candidateStatus = document.querySelector('#candidate-status')
const contestEmpty = document.querySelector('#contest-empty')
const contestDetails = document.querySelector('#contest-details')
const contestState = document.querySelector('#contest-state')
const contestMeta = document.querySelector('#contest-meta')
const contestAnswers = document.querySelector('#contest-answers')
const reviewTasks = document.querySelector('#review-tasks')
const reviewConclusion = document.querySelector('#review-conclusion')
const contestStatus = document.querySelector('#contest-status')

let accessToken = ''
let currentApplication = null

async function api(path, options = {}) {
  if (!apiBase) throw new Error('API закрытого раздела ещё не настроен.')
  let response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    throw new Error('Не удалось связаться с сервером.')
  }
  let body = {}
  try { body = await response.json() } catch { /* generic response below */ }
  if (response.status === 401 || response.status === 403) {
    lock()
    throw new Error('Ключ доступа неверный или был изменён.')
  }
  if (!response.ok) throw new Error(body.message || 'Операция не выполнена.')
  return body
}

function lock() {
  accessToken = ''
  accessTokenInput.value = ''
  applicationsView.hidden = true
  authView.hidden = false
  if (dialog.open) dialog.close()
  accessTokenInput.focus()
}

function formatDate(value) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function addCell(row, value) {
  const cell = document.createElement('td')
  cell.textContent = value || '—'
  row.append(cell)
  return cell
}

function renderApplications(applications) {
  list.replaceChildren()
  emptyState.hidden = applications.length !== 0
  for (const application of applications) {
    const row = document.createElement('tr')
    const nameCell = document.createElement('td')
    const nameButton = document.createElement('button')
    nameButton.type = 'button'
    nameButton.className = 'name-button'
    nameButton.textContent = `${application.firstName} ${application.lastName}`
    nameButton.addEventListener('click', () => openApplication(application.id))
    nameCell.append(nameButton)
    row.append(nameCell)
    addCell(row, application.direction)
    addCell(row, formatDate(application.createdAt))
    const statusCell = document.createElement('td')
    const pill = document.createElement('span')
    pill.className = `status-pill status-${application.status}`
    pill.textContent = statusLabels[application.status] || application.status
    statusCell.append(pill)
    row.append(statusCell)
    const contestCell = document.createElement('td')
    const contestPill = document.createElement('span')
    contestPill.className = 'status-pill'
    contestPill.textContent = contestLabels[application.contestState] || 'Не назначен'
    contestCell.append(contestPill)
    row.append(contestCell)
    const openCell = document.createElement('td')
    const openButton = document.createElement('button')
    openButton.type = 'button'
    openButton.className = 'secondary-button'
    openButton.textContent = 'Открыть'
    openButton.addEventListener('click', () => openApplication(application.id))
    openCell.append(openButton)
    row.append(openCell)
    list.append(row)
  }
}

async function loadApplications() {
  listStatus.textContent = 'Загружаем заявки…'
  try {
    const params = new URLSearchParams()
    if (statusFilter.value) params.set('status', statusFilter.value)
    if (contestFilter.value) params.set('contestState', contestFilter.value)
    const query = params.size ? `?${params}` : ''
    const result = await api(`/v1/admin/applications${query}`)
    renderApplications(result.applications)
    listStatus.textContent = `Заявок: ${result.applications.length}`
  } catch (error) {
    listStatus.textContent = error.message
  }
}

function detail(label, value, { wide = false, href = null } = {}) {
  const wrapper = document.createElement('dl')
  wrapper.className = `detail${wide ? ' detail-wide' : ''}`
  const term = document.createElement('dt')
  term.textContent = label
  const description = document.createElement('dd')
  if (href && value) {
    const link = document.createElement('a')
    link.href = href
    link.textContent = value
    link.target = '_blank'
    link.rel = 'noopener'
    description.append(link)
  } else description.textContent = value || '—'
  wrapper.append(term, description)
  return wrapper
}

function renderContest(value) {
  currentApplication.contest = value
  contestStatus.textContent = ''
  contestEmpty.hidden = Boolean(value)
  contestDetails.hidden = !value
  contestState.textContent = value ? (contestLabels[value.state] || value.state) : 'Не назначен'
  if (!value) return
  const dateOrDash = date => date ? formatDate(date) : '—'
  contestMeta.replaceChildren(
    detail('Создан', dateOrDash(value.created_at)),
    detail('Начат', dateOrDash(value.started_at)),
    detail('Дедлайн', dateOrDash(value.deadline_at || value.start_before)),
    detail('Отправлен', dateOrDash(value.submitted_at)),
    detail('Версия заданий', value.task_set_version),
    detail('Набор заданий', value.trackLabel || value.direction || 'Общий'),
    detail('Продление', value.extension_count ? 'Использовано' : 'Доступно'),
  )
  document.querySelector('#copy-contest-link').disabled = !value.inviteUrl
  document.querySelector('#resend-contest').disabled = !value.hasEmail || !value.inviteUrl
  document.querySelector('#extend-contest').disabled = !value.inviteUrl || value.extension_count > 0
  document.querySelector('#revoke-contest').disabled = !value.inviteUrl
  contestAnswers.replaceChildren(...value.tasks.map(task => {
    const answer = value.answers?.[task.id]
    const section = document.createElement('section'); section.className = 'contest-answer'
    const title = document.createElement('h4'); title.textContent = task.title
    const source = document.createElement('pre'); source.textContent = answer?.source || 'Ответ не добавлен'
    section.append(title, source)
    if (answer?.explanation) { const explanation = document.createElement('p'); explanation.textContent = answer.explanation; section.append(explanation) }
    if (answer?.url) { const link = document.createElement('a'); link.href = answer.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = answer.url; section.append(link) }
    return section
  }))
  const review = value.review || { tasks: {}, conclusion: '' }
  reviewTasks.replaceChildren(...value.tasks.map(task => {
    const row = document.createElement('div'); row.className = 'review-task'; row.dataset.taskId = task.id
    const note = document.createElement('textarea'); note.placeholder = `Заметка: ${task.title}`; note.maxLength = 4000; note.value = review.tasks?.[task.id]?.note || ''
    const score = document.createElement('select'); score.innerHTML = '<option value="">Без оценки</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option>'; score.value = review.tasks?.[task.id]?.score || ''
    row.append(note, score); return row
  }))
  reviewConclusion.value = review.conclusion || ''
}

async function openApplication(id) {
  dialogStatus.textContent = ''
  try {
    const result = await api(`/v1/admin/applications/${encodeURIComponent(id)}`)
    currentApplication = result.application
    const item = currentApplication
    candidateName.textContent = `${item.firstName} ${item.lastName}`
    candidateStatus.value = item.status
    candidateDetails.replaceChildren(
      detail('Дата заявки', formatDate(item.createdAt)),
      detail('Направление', item.direction),
      detail('Telegram', item.telegram, { href: `https://t.me/${item.telegram.replace('@', '')}` }),
      detail('Телефон', item.phone, { href: `tel:${item.phone}` }),
      detail('Email', item.email, item.email ? { href: `mailto:${item.email}` } : {}),
      detail('Ссылка', item.portfolioUrl, item.portfolioUrl ? { href: item.portfolioUrl } : {}),
      detail('Мотивационное письмо', item.motivation, { wide: true }),
      detail('Резюме', `${item.resumeName} · ${formatBytes(item.resumeSize)}`, { wide: true }),
    )
    renderContest(item.contest)
    dialog.showModal()
  } catch (error) {
    listStatus.textContent = error.message
  }
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} КБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

authForm.addEventListener('submit', async event => {
  event.preventDefault()
  authError.textContent = ''
  accessToken = accessTokenInput.value
  try {
    const params = new URLSearchParams()
    if (statusFilter.value) params.set('status', statusFilter.value)
    if (contestFilter.value) params.set('contestState', contestFilter.value)
    const query = params.size ? `?${params}` : ''
    const result = await api(`/v1/admin/applications${query}`)
    authView.hidden = true
    applicationsView.hidden = false
    renderApplications(result.applications)
    listStatus.textContent = `Заявок: ${result.applications.length}`
    const requestedId = new URLSearchParams(location.hash.slice(1)).get('application')
    if (requestedId) openApplication(requestedId)
  } catch (error) {
    authError.textContent = error.message
  }
})

document.querySelector('#lock-button').addEventListener('click', lock)
document.querySelector('#refresh-button').addEventListener('click', loadApplications)
statusFilter.addEventListener('change', loadApplications)
contestFilter.addEventListener('change', loadApplications)
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close())
dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close()
})

document.querySelector('#save-status').addEventListener('click', async () => {
  if (!currentApplication) return
  dialogStatus.textContent = 'Сохраняем…'
  try {
    const result = await api(`/v1/admin/applications/${encodeURIComponent(currentApplication.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: candidateStatus.value }),
    })
    currentApplication.status = result.status
    dialogStatus.textContent = 'Статус сохранён.'
    await loadApplications()
  } catch (error) { dialogStatus.textContent = error.message }
})

document.querySelector('#download-resume').addEventListener('click', async () => {
  if (!currentApplication) return
  dialogStatus.textContent = 'Готовим безопасную ссылку…'
  try {
    const result = await api(`/v1/admin/applications/${encodeURIComponent(currentApplication.id)}/resume`)
    dialogStatus.textContent = 'Ссылка действует 60 секунд.'
    location.assign(result.downloadUrl)
  } catch (error) { dialogStatus.textContent = error.message }
})

async function contestAction(action = '', options = {}) {
  if (!currentApplication) return
  contestStatus.textContent = 'Сохраняем…'
  try {
    const suffix = action ? `/${action}` : ''
    const result = await api(`/v1/admin/applications/${encodeURIComponent(currentApplication.id)}/contest${suffix}`, options)
    renderContest(result.contest)
    contestStatus.textContent = 'Готово.'
    await loadApplications()
  } catch (error) { contestStatus.textContent = error.message }
}

document.querySelector('#create-contest').addEventListener('click', () => contestAction('', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    durationMinutes: Number(document.querySelector('#contest-duration').value),
    startWithinDays: Number(document.querySelector('#contest-days').value),
  }),
}))

document.querySelector('#copy-contest-link').addEventListener('click', async () => {
  if (!currentApplication?.contest?.inviteUrl) return
  try {
    await navigator.clipboard.writeText(currentApplication.contest.inviteUrl)
    contestStatus.textContent = 'Персональная ссылка скопирована.'
  } catch { contestStatus.textContent = 'Браузер не разрешил копирование. Открой страницу по HTTPS и попробуй снова.' }
})

document.querySelector('#resend-contest').addEventListener('click', () => contestAction('resend', { method: 'POST' }))
document.querySelector('#extend-contest').addEventListener('click', () => {
  if (window.confirm('Продлить срок на 60 минут? Продление доступно только один раз.')) contestAction('extend', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: 60 }),
  })
})
document.querySelector('#revoke-contest').addEventListener('click', () => {
  if (window.confirm('Отозвать персональную ссылку? Кандидат больше не сможет открыть контест.')) contestAction('revoke', { method: 'POST' })
})

document.querySelector('#save-review').addEventListener('click', () => {
  const tasks = {}
  for (const row of reviewTasks.querySelectorAll('.review-task')) {
    const [note, score] = row.children
    tasks[row.dataset.taskId] = { note: note.value, score: score.value ? Number(score.value) : null }
  }
  contestAction('review', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks, conclusion: reviewConclusion.value }),
  })
})

document.querySelector('#delete-application').addEventListener('click', async () => {
  if (!currentApplication) return
  const fullName = `${currentApplication.firstName} ${currentApplication.lastName}`
  if (!window.confirm(`Удалить заявку ${fullName} и резюме без возможности восстановления?`)) return
  dialogStatus.textContent = 'Удаляем…'
  try {
    await api(`/v1/admin/applications/${encodeURIComponent(currentApplication.id)}`, { method: 'DELETE' })
    dialog.close()
    currentApplication = null
    await loadApplications()
  } catch (error) { dialogStatus.textContent = error.message }
})
