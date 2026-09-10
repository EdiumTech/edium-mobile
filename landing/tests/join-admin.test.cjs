const assert = require('node:assert/strict')
const test = require('node:test')
const { pathToFileURL } = require('node:url')
const path = require('node:path')

const helpersUrl = pathToFileURL(path.join(__dirname, '../src/join-admin-utils.mjs')).href

test('optional candidate contacts do not produce broken links', async () => {
  const { phoneHref, telegramHref } = await import(helpersUrl)
  assert.equal(telegramHref(null), null)
  assert.equal(phoneHref(''), null)
})

test('candidate contacts are converted to safe link targets', async () => {
  const { phoneHref, telegramHref } = await import(helpersUrl)
  assert.equal(telegramHref('@demo_candidate'), 'https://t.me/demo_candidate')
  assert.equal(telegramHref('demo_candidate'), 'https://t.me/demo_candidate')
  assert.equal(phoneHref('+79990000000'), 'tel:+79990000000')
})
