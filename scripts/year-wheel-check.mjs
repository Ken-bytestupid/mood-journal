// 年份滚轮自检：点年份打开、滚动选中、确认后圆环跳到该年
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5180/'
const OUT = process.argv[4] ?? 'D:/Desktop/dsh工作区/_shots'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})
let seq = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) reject(new Error(JSON.stringify(m.error)))
    else resolve(m.result)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.navigate', { url: URL_APP })
for (let i = 0; i < 40; i += 1) {
  if (await evaluate(`document.querySelectorAll('.tab').length === 2`)) break
  await sleep(250)
}
await sleep(400)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(600)
await evaluate(`[...document.querySelectorAll('.tile')].find((b) => b.textContent.includes('记忆')).click()`)
await sleep(900)

console.log('月份环标题:', await evaluate(`document.querySelector('.memory-caption')?.innerText.replace(/\\n/g, ' / ')`))

// 点年份打开滚轮
await evaluate(`document.querySelector('.memory-hole-year').click()`)
await sleep(500)
console.log('滚轮打开:', await evaluate(`(() => {
  const root = document.querySelector('.wheel-root')
  if (!root) return { open: false }
  const active = [...root.querySelectorAll('.wheel-item')].find((b) => b.dataset.active === 'true')
  return { open: true, active: active?.textContent, count: root.querySelectorAll('.wheel-item').length }
})()`))
await shot('year-wheel')

// 滚到 2030
await evaluate(`(() => {
  const list = document.querySelector('.wheel-list')
  list.scrollTop = (2030 - 1970) * 44
  list.dispatchEvent(new Event('scroll', { bubbles: true }))
})()`)
await sleep(400)
console.log('滚到 2030:', await evaluate(`(() => {
  const active = [...document.querySelectorAll('.wheel-item')].find((b) => b.dataset.active === 'true')
  return { active: active?.textContent, confirm: document.querySelector('.wheel-root .memory-confirm')?.textContent }
})()`))
await shot('year-wheel-2030')

// 确认
await evaluate(`document.querySelector('.wheel-root .memory-confirm').click()`)
await sleep(900)
console.log('确认后:', await evaluate(`(() => ({
  wheelOpen: !!document.querySelector('.wheel-root'),
  caption: document.querySelector('.memory-caption')?.innerText.replace(/\\n/g, ' / '),
  yearInRing: document.querySelector('.memory-hole-year')?.textContent,
}))()`))
await shot('year-applied')

ws.close()
