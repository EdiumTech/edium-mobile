import './join-admin.css'

const configuredApiBase = (import.meta.env.VITE_JOIN_API_BASE || '').replace(/\/$/, '')
const apiBase = configuredApiBase || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://127.0.0.1:8787' : '')
const statusLabels = { new: 'Новая', reviewing: 'Рассматриваем', contacted: 'Связались', accepted: 'Принята', rejected: 'Отказ' }

const authView = document.querySelector('#auth-view')
const applicationsView = document.querySelector('#applications-view')
const authForm = document.querySelector('#auth-form')
const accessTokenInput = document.querySelector('#access-token')
const authError = document.querySelector('#auth-error')
const statusFilter = document.querySelector('#status-filter')
const list = document.querySelector('#applications-list')
const listStatus = document.querySelector('#list-status')
const emptyState = document.querySelector('#empty-state')
const dialog = document.querySelector('#application-dialog')
const dialogStatus = document.querySelector('#dialog-status')
const candidateName = document.querySelector('#candidate-name')
const candidateDetails = document.querySelector('#candidate-details')
const candidateStatus = document.querySelector('#candidate-status')

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
    const query = statusFilter.value ? `?status=${encodeURIComponent(statusFilter.value)}` : ''
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
    const query = statusFilter.value ? `?status=${encodeURIComponent(statusFilter.value)}` : ''
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
