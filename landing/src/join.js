import './join.css'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const configuredApiBase = (import.meta.env.VITE_JOIN_API_BASE || '').replace(/\/$/, '')
const apiBase = configuredApiBase || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://127.0.0.1:8787' : '')

const form = document.querySelector('#application-form')
const successState = document.querySelector('#success-state')
const summary = document.querySelector('#form-error-summary')
const summaryList = summary.querySelector('ul')
const submitButton = document.querySelector('#submit-button')
const submitLabel = submitButton.querySelector('.submit-label')
const submitLoading = submitButton.querySelector('.submit-loading')
const submitProgress = document.querySelector('#submit-progress')
const direction = document.querySelector('#direction')
const otherDirectionField = document.querySelector('#other-direction-field')
const motivation = document.querySelector('#motivation')
const motivationCounter = document.querySelector('#motivation-counter')
const resumeInput = document.querySelector('#resume')
const dropZone = document.querySelector('#drop-zone')
const emptyFileState = dropZone.querySelector('.drop-zone-empty')
const selectedFileState = dropZone.querySelector('.drop-zone-file')
const fileName = document.querySelector('#file-name')
const fileSize = document.querySelector('#file-size')
const fileType = dropZone.querySelector('.file-type')
const removeFileButton = document.querySelector('#remove-file')
const startedAt = new Date().toISOString()
let idempotencyKey = crypto.randomUUID()

let selectedFile = null
let preparedUpload = null

const fields = {
  firstName: document.querySelector('#first-name'),
  lastName: document.querySelector('#last-name'),
  telegram: document.querySelector('#telegram'),
  phone: document.querySelector('#phone'),
  email: document.querySelector('#email'),
  direction,
  otherDirection: document.querySelector('#other-direction'),
  motivation,
  portfolioUrl: document.querySelector('#portfolio-url'),
  resume: resumeInput,
  consent: document.querySelector('#consent'),
}

const errorIds = {
  firstName: 'first-name-error',
  lastName: 'last-name-error',
  telegram: 'telegram-error',
  phone: 'phone-error',
  email: 'email-error',
  otherDirection: 'other-direction-error',
  motivation: 'motivation-error',
  portfolioUrl: 'portfolio-url-error',
  resume: 'resume-error',
  consent: 'consent-error',
}

function normalizeTelegram(value) {
  const trimmed = value.trim()
  let username = trimmed
  try {
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const url = new URL(candidate)
    if (['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(url.hostname.toLowerCase())) {
      username = url.pathname.split('/').filter(Boolean)[0] || ''
    }
  } catch {
    username = trimmed
  }
  username = username.replace(/^@/, '')
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? `@${username}` : null
}

function normalizePhone(value) {
  const trimmed = value.trim()
  if (!/^\+|^00/.test(trimmed)) return null
  const normalized = `+${trimmed.replace(/^\+|^00/, '').replace(/[\s().-]/g, '')}`
  return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : null
}

function normalizedDirection() {
  if (direction.value === 'other') return fields.otherDirection.value.trim()
  return direction.value
}

function validWebUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

function getFileType(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') && (!file.type || file.type === 'application/pdf')) return 'application/pdf'
  if (name.endsWith('.docx') && (!file.type || file.type === DOCX_TYPE || file.type === 'application/octet-stream')) return DOCX_TYPE
  return null
}

function validate() {
  const errors = {}
  const firstName = fields.firstName.value.trim()
  const lastName = fields.lastName.value.trim()
  const email = fields.email.value.trim()
  const portfolioUrl = fields.portfolioUrl.value.trim()
  const motivationText = motivation.value.trim()

  if (!firstName) errors.firstName = 'Укажи имя.'
  else if (firstName.length > 80) errors.firstName = 'Имя должно быть короче 80 символов.'
  if (!lastName) errors.lastName = 'Укажи фамилию.'
  else if (lastName.length > 80) errors.lastName = 'Фамилия должна быть короче 80 символов.'
  if (!normalizeTelegram(fields.telegram.value)) errors.telegram = 'Укажи корректный @username или ссылку t.me.'
  if (!normalizePhone(fields.phone.value)) errors.phone = 'Начни с + и укажи код страны и номер.'
  if (email && !fields.email.validity.valid) errors.email = 'Проверь адрес электронной почты.'
  if (direction.value === 'other' && !normalizedDirection()) errors.otherDirection = 'Напиши своё направление.'
  if (normalizedDirection().length > 120) errors.otherDirection = 'Направление должно быть короче 120 символов.'
  if (motivationText.length < 40) errors.motivation = 'Расскажи чуть подробнее — минимум 40 символов.'
  if (motivationText.length > 4000) errors.motivation = 'Сократи письмо до 4000 символов.'
  if (portfolioUrl && !validWebUrl(portfolioUrl)) errors.portfolioUrl = 'Укажи полную ссылку, начинающуюся с https://.'
  if (!selectedFile) errors.resume = 'Добавь резюме в PDF или DOCX.'
  else if (!getFileType(selectedFile)) errors.resume = 'Поддерживаются только PDF и DOCX.'
  else if (selectedFile.size > MAX_FILE_SIZE) errors.resume = 'Файл больше 10 МБ. Выбери файл меньшего размера.'
  else if (selectedFile.size === 0) errors.resume = 'Файл пуст. Выбери другое резюме.'
  if (!fields.consent.checked) errors.consent = 'Нужно согласие на обработку данных для рассмотрения заявки.'

  return errors
}

function clearErrors() {
  Object.entries(errorIds).forEach(([name, id]) => {
    const error = document.getElementById(id)
    error.textContent = ''
    const target = fields[name]
    target?.removeAttribute('aria-invalid')
    target?.removeAttribute('aria-describedby')
    target?.closest('.field, .consent-row')?.classList.remove('has-error')
  })
  summary.hidden = true
  summaryList.replaceChildren()
}

function showErrors(errors) {
  clearErrors()
  Object.entries(errors).forEach(([name, message]) => {
    const id = errorIds[name]
    const target = fields[name]
    if (!id || !target) return
    const error = document.getElementById(id)
    error.textContent = message
    target.setAttribute('aria-invalid', 'true')
    target.setAttribute('aria-describedby', id)
    target.closest('.field, .consent-row')?.classList.add('has-error')

    const item = document.createElement('li')
    const link = document.createElement('a')
    link.href = `#${target.id}`
    link.textContent = message
    link.addEventListener('click', () => setTimeout(() => target.focus(), 0))
    item.append(link)
    summaryList.append(item)
  })
  summary.hidden = false
  summary.focus()
}

function setSubmitting(isSubmitting, message = 'Отправляем…') {
  submitButton.disabled = isSubmitting
  submitButton.setAttribute('aria-busy', String(isSubmitting))
  submitLabel.hidden = isSubmitting
  submitLoading.hidden = !isSubmitting
  submitProgress.textContent = message
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
}

function renderFile(file) {
  const previousFingerprint = selectedFile && `${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`
  const nextFingerprint = `${file.name}:${file.size}:${file.lastModified}`
  if (previousFingerprint !== nextFingerprint) {
    idempotencyKey = crypto.randomUUID()
    preparedUpload = null
  }
  selectedFile = file
  emptyFileState.hidden = true
  selectedFileState.hidden = false
  fileName.textContent = file.name
  fileSize.textContent = formatBytes(file.size)
  fileType.textContent = file.name.toLowerCase().endsWith('.docx') ? 'DOCX' : 'PDF'
  const error = validate().resume
  if (error) showFieldError('resume', error)
  else clearFieldError('resume')
}

function clearFieldError(name) {
  const target = fields[name]
  const error = document.getElementById(errorIds[name])
  if (!target || !error) return
  error.textContent = ''
  target.removeAttribute('aria-invalid')
  target.removeAttribute('aria-describedby')
  target.closest('.field, .consent-row')?.classList.remove('has-error')
}

function showFieldError(name, message) {
  const target = fields[name]
  const error = document.getElementById(errorIds[name])
  if (!target || !error) return
  error.textContent = message
  target.setAttribute('aria-invalid', 'true')
  target.setAttribute('aria-describedby', errorIds[name])
  target.closest('.field, .consent-row')?.classList.add('has-error')
}

async function request(path, options) {
  if (!apiBase) throw new Error('Форма ещё не подключена к серверу. Попробуй позже.')
  let response
  try {
    response = await fetch(`${apiBase}${path}`, options)
  } catch {
    throw new Error('Не удалось связаться с сервером. Проверь интернет и попробуй ещё раз.')
  }
  let body = {}
  try { body = await response.json() } catch { /* keep safe generic error */ }
  if (!response.ok) {
    const error = new Error(body.message || 'Не удалось отправить заявку. Попробуй ещё раз.')
    error.fieldErrors = body.fieldErrors
    throw error
  }
  return body
}

async function prepareResume(file) {
  const fingerprint = `${file.name}:${file.size}:${file.lastModified}`
  if (preparedUpload?.fingerprint === fingerprint) return preparedUpload.uploadId

  setSubmitting(true, 'Готовим загрузку…')
  const intent = await request('/v1/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      mediaType: getFileType(file),
      company: document.querySelector('#company').value,
      startedAt,
    }),
  })

  const uploadBody = new FormData()
  Object.entries(intent.upload.fields).forEach(([key, value]) => uploadBody.append(key, value))
  uploadBody.append('file', file)
  setSubmitting(true, 'Загружаем резюме…')
  let uploadResponse
  try {
    uploadResponse = await fetch(intent.upload.url, { method: 'POST', body: uploadBody })
  } catch {
    throw new Error('Загрузка файла прервалась. Данные формы сохранены — попробуй ещё раз.')
  }
  if (!uploadResponse.ok) throw new Error('Не удалось загрузить резюме. Попробуй ещё раз.')

  preparedUpload = { fingerprint, uploadId: intent.uploadId }
  return intent.uploadId
}

async function submitApplication(uploadId) {
  const payload = {
    uploadId,
    firstName: fields.firstName.value.trim(),
    lastName: fields.lastName.value.trim(),
    telegram: normalizeTelegram(fields.telegram.value),
    phone: normalizePhone(fields.phone.value),
    email: fields.email.value.trim() || null,
    direction: normalizedDirection() || null,
    motivation: motivation.value.trim(),
    portfolioUrl: fields.portfolioUrl.value.trim() || null,
    company: document.querySelector('#company').value,
    startedAt,
  }
  setSubmitting(true, 'Сохраняем заявку…')
  return request('/v1/applications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  })
}

direction.addEventListener('change', () => {
  otherDirectionField.hidden = direction.value !== 'other'
  if (!otherDirectionField.hidden) fields.otherDirection.focus()
})

motivation.addEventListener('input', () => {
  motivationCounter.textContent = `${motivation.value.length} / 4000`
  if (motivation.value.trim().length >= 40) clearFieldError('motivation')
})

resumeInput.addEventListener('change', () => {
  const file = resumeInput.files?.[0]
  if (file) renderFile(file)
})

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, event => {
    event.preventDefault()
    dropZone.classList.add('is-dragging')
  })
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, event => {
    event.preventDefault()
    dropZone.classList.remove('is-dragging')
  })
}
dropZone.addEventListener('drop', event => {
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  const transfer = new DataTransfer()
  transfer.items.add(file)
  resumeInput.files = transfer.files
  renderFile(file)
})

removeFileButton.addEventListener('click', () => {
  selectedFile = null
  preparedUpload = null
  resumeInput.value = ''
  selectedFileState.hidden = true
  emptyFileState.hidden = false
  clearFieldError('resume')
  resumeInput.focus()
})

Object.entries(fields).forEach(([name, element]) => {
  element.addEventListener('input', () => clearFieldError(name))
  element.addEventListener('change', () => clearFieldError(name))
})

fields.telegram.addEventListener('blur', () => {
  const normalized = normalizeTelegram(fields.telegram.value)
  if (normalized) fields.telegram.value = normalized
})
fields.phone.addEventListener('blur', () => {
  const normalized = normalizePhone(fields.phone.value)
  if (normalized) fields.phone.value = normalized
})

form.addEventListener('submit', async event => {
  event.preventDefault()
  if (submitButton.disabled) return
  const errors = validate()
  if (Object.keys(errors).length) {
    showErrors(errors)
    return
  }
  clearErrors()

  try {
    const uploadId = await prepareResume(selectedFile)
    const result = await submitApplication(uploadId)
    if (!result.saved) throw new Error('Сервер не подтвердил сохранение заявки. Попробуй ещё раз.')
    form.hidden = true
    document.querySelector('.form-intro').hidden = true
    successState.hidden = false
    successState.focus()
    preparedUpload = null
  } catch (error) {
    if (error.fieldErrors && Object.keys(error.fieldErrors).length) showErrors(error.fieldErrors)
    else {
      summaryList.replaceChildren()
      const item = document.createElement('li')
      item.textContent = error.message
      summaryList.append(item)
      summary.hidden = false
      summary.focus()
    }
  } finally {
    setSubmitting(false)
  }
})
