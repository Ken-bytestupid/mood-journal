// 记忆页：关闭按钮几何 + 点空白回退 + 环内点击翻周
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
const tap = async (x, y) => {
  await touch('touchStart', [point(x, y)])
  await sleep(60)
  await touch('touchEnd', [])
  await sleep(1400)
}
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
}
const state = () =>
  evaluate(`(() => {
    const root = document.querySelector('.memory')
    if (!root) return { open: false }
    return {
      stage: root.dataset.stage,
      caption: document.querySelector('.memory-caption')?.innerText.replace(/\\n/g, ' / ') ?? null,
      week: document.querySelector('.memory-ring.small .memory-item[data-active="true"]')?.textContent ?? null,
    }
  })()`)

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.navigate', { url: URL_APP })
await sleep(2500)

await evaluate(`new Promise((resolve) => {
  const req = indexedDB.deleteDatabase('mood-journal')
  req.onsuccess = () => resolve(true)
  req.onerror = () => resolve(false)
  req.onblocked = () => resolve(false)
})`)
await send('Page.reload')
await sleep(2200)
await evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('mood-journal', 1)
    req.onupgradeneeded = () => {
      const database = req.result
      if (!database.objectStoreNames.contains('entries')) {
        const store = database.createObjectStore('entries', { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const now = Date.now()
  const rows = [
    { id: 't1', title: '午饭', text: '面很好吃', createdAt: now - 3600_000 },
    { id: 't2', title: '散步', text: '江边风很大', createdAt: now - 7200_000 },
    { id: 't3', title: '', text: '下午有点困', createdAt: now - 10800_000 },
  ].map((row) => ({ ...row, polarity: 'plain', emotionId: null, photos: [], updatedAt: row.createdAt }))
  await new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite')
    for (const row of rows) tx.objectStore('entries').put(row)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => reject(tx.error)
  })
})()`)
await send('Page.reload')
await sleep(2500)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(600)
await evaluate(`[...document.querySelectorAll('.tile')].find((b) => b.textContent.includes('记忆')).click()`)
await sleep(900)

// 关闭按钮几何
console.log('几何:', JSON.stringify(await evaluate(`(() => {
  const close = document.querySelector('.memory-close').getBoundingClientRect()
  const ring = document.querySelector('.memory-ring').getBoundingClientRect()
  const tri = document.querySelector('.memory-pointer').getBoundingClientRect()
  return {
    环右端点: Math.round(ring.right),
    按钮中心x: Math.round(close.left + close.width / 2),
    按钮中心y: Math.round(close.top + close.height / 2),
    三角顶: Math.round(tri.top),
  }
})()`)))
await shot('mem-tap-month')

// 点环外空白 → 关闭记忆
await tap(24, 210)
console.log('点月环外空白（期望关闭）:', JSON.stringify(await state()))

// 重新打开 → 进周环 → 点环外空白 → 回月份
await evaluate(`[...document.querySelectorAll('.tile')].find((b) => b.textContent.includes('记忆')).click()`)
await sleep(900)
await evaluate(`document.querySelector('.memory-confirm').click()`)
await sleep(1600)
console.log('周环:', JSON.stringify(await state()))
await tap(24, 210)
await sleep(600)
console.log('点周环外空白（期望保持周环）:', JSON.stringify(await state()))

// 确保在周环 → 点环内右侧 → 下一周
if ((await state()).stage !== 'week') {
  await evaluate(`document.querySelector('.memory-confirm').click()`)
  await sleep(1600)
}
const before = (await state()).week
const ringBox = await evaluate(`(() => { const r = document.querySelector('.memory-ring.small').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
await tap(Math.round(ringBox.x + ringBox.w * 0.78), Math.round(ringBox.y + ringBox.h * 0.5))
console.log('点环内右侧（期望下一周）:', before, '→', (await state()).week)
await shot('mem-tap-week')

// 用「换个月份」回到月环，再进周环（停在当前周 46），进列表
if ((await state()).stage === 'week') {
  await evaluate(`document.querySelector('.memory-back').click()`)
  await sleep(1600)
}
await evaluate(`document.querySelector('.memory-confirm').click()`)
await sleep(1600)
await evaluate(`document.querySelector('.memory-confirm').click()`)
await sleep(1600)
console.log('列表:', JSON.stringify(await state()))
await tap(24, 210)
await sleep(600)
console.log('点列表外空白（期望回周环）:', JSON.stringify(await state()))

// 列表页的关闭按钮仍应在右上角且可点
await evaluate(`document.querySelector('.memory-confirm').click()`)
await sleep(1600)
const closePos = await evaluate(`(() => { const b = document.querySelector('.memory > .overlay-close'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) } })()`)
await evaluate(`document.querySelector('.memory > .overlay-close')?.click()`)
await sleep(700)
console.log('列表页关闭按钮位置:', JSON.stringify(closePos), '点击后:', JSON.stringify(await state()))

ws.close()
