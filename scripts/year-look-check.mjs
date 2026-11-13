// 年份字体与滚轮玻璃质感的样张
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

const open = async (scheme) => {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
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
}

await open('light')
console.log(
  '浅色·环内年份颜色:',
  await evaluate(`getComputedStyle(document.querySelector('.memory-hole-year')).color`),
)
await shot('year-ring-light')

await evaluate(`document.querySelector('.memory-hole-year').click()`)
await sleep(500)
console.log(
  '滚轮面板背景:',
  await evaluate(`getComputedStyle(document.querySelector('.wheel-panel')).backgroundColor`),
)
console.log(
  'backdrop-filter:',
  await evaluate(`getComputedStyle(document.querySelector('.wheel-panel')).backdropFilter`),
)
await shot('year-wheel-glass-light')

await open('dark')
await shot('year-ring-dark')

ws.close()
