// 年份滚轮自检（每次显示 5 行版）：打开、拖动换年、点击行、确认
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
const touch = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points })
const point = (x, y) => ({ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 })
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
}
const wheelState = () =>
  evaluate(`(() => {
    const stage = document.querySelector('.wheel-stage')
    if (!stage) return { open: false }
    const box = stage.getBoundingClientRect()
    const rows = [...stage.querySelectorAll('.wheel-item')].map((el) => {
      const r = el.getBoundingClientRect()
      return { text: el.textContent.trim(), visible: r.bottom > box.top && r.top < box.bottom }
    })
    const confirm = document.querySelector('.wheel-root .memory-confirm')?.textContent?.trim()
    return { open: true, rows, visibleCount: rows.filter((r) => r.visible).length, confirm }
  })()`)

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
await evaluate(`document.querySelector('.memory-hole-year').click()`)
await sleep(400)
console.log('打开滚轮:', JSON.stringify(await wheelState()))
await shot('year-wheel')

// 拖拽：向上拖 44px（下一岁）
const box = await evaluate(`(() => { const r = document.querySelector('.wheel-stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
await touch('touchStart', [point(box.x, box.y)])
for (let i = 1; i <= 8; i += 1) {
  await touch('touchMove', [point(box.x, box.y - (44 * i) / 8)])
  await sleep(16)
}
await sleep(100)
await touch('touchEnd', [])
await sleep(500)
console.log('上拖 44px 后:', JSON.stringify(await wheelState()))

// 点「当前 +2 年」那一行
await evaluate(`(() => {
  const confirm = document.querySelector('.wheel-root .memory-confirm').textContent.trim()
  const current = parseInt(confirm, 10)
  const target = current + 2
  const rows = [...document.querySelectorAll('.wheel-stage .wheel-item')]
  const row = rows.find((r) => r.textContent.trim() === target + ' 年')
  row?.click()
})()`)
await sleep(600)
console.log('点 +2 行:', JSON.stringify(await wheelState()))

// 确认
await evaluate(`document.querySelector('.wheel-root .memory-confirm').click()`)
await sleep(900)
console.log('确认后:', JSON.stringify(await evaluate(`({
  wheelOpen: !!document.querySelector('.wheel-root'),
  caption: document.querySelector('.memory-caption')?.innerText.replace(/\\n/g, ' / '),
  yearInRing: document.querySelector('.memory-hole-year')?.textContent,
})`)))
await shot('year-applied')

ws.close()
