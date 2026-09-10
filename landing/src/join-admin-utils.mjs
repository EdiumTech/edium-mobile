export function telegramHref(value) {
  if (!value) return null
  return `https://t.me/${value.replace(/^@/, '')}`
}

export function phoneHref(value) {
  return value ? `tel:${value}` : null
}
