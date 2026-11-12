// 年份滚轮：拖动过程中是否连续（放大跟随、行数不缺口）
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
import { writeFileSync } from 'node:fs'

const rowsInfo = () =>
  evaluate(`(() => {
    const stage = document.querySelector('.wheel-stage')
    if (!stage) return { open: false }
    const box = stage.getBoundingClientRect()
    const centerY = box.top + box.height / 2
    const rows = [...stage.querySelectorAll('.wheel-item')].map((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return {
        text: el.textContent.trim(),
        font: Math.round(parseFloat(cs.fontSize)),
        opacity: Number(cs.opacity).toFixed(2),
        visible: r.bottom > box.top && r.top < box.bottom,
        distanceToCenter: Math.round(Math.abs(r.top + r.height / 2 - centerY)),
      }
    })
    const center = rows.slice().sort((a, b) => a.distanceToCenter - b.distanceToCenter)[0]
    return { open: true, center, visibleCount: rows.filter((r) => r.visible).length, rows }
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

const box = await evaluate(`(() => { const r = document.querySelector('.wheel-stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
console.log('静止时:', JSON.stringify(await rowsInfo()))

// 慢慢往上拖 220px（5 行），过程中取样
await touch('touchStart', [point(box.x, box.y)])
for (let i = 1; i <= 44; i += 1) {
  await touch('touchMove', [point(box.x, box.y - (220 * i) / 44)])
  await sleep(16)
  if (i === 22) {
    const mid = await rowsInfo()
    console.log('拖到中途（约 2.5 行）:', JSON.stringify({ center: mid.center, visibleCount: mid.visibleCount }))
    await shot('wheel-dragging')
  }
}
const late = await rowsInfo()
console.log('拖到最后（约 5 行）:', JSON.stringify({ center: late.center, visibleCount: late.visibleCount, texts: late.rows.map((r) => r.text) }))
await touch('touchEnd', [])
await sleep(600)
const settled = await rowsInfo()
console.log('松开后:', JSON.stringify({ center: settled.center, visibleCount: settled.visibleCount }))

ws.close()
