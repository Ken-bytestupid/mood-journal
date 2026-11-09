// 用真实触摸事件测试翻页方向（模拟手机）。左滑应 +1，右滑应 -1。
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5180/'
const OUT = process.argv[4] ?? 'D:/Desktop/dsh工作区/_shots'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) throw new Error('找不到可调试的页面')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let seq = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  }
})

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

const counter = () => evaluate(`document.querySelector('.reader-counter')?.textContent?.trim() ?? null`)

const touchSwipe = async (fromX, toX, y) => {
  const point = (x) => [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }]
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(fromX) })
  await sleep(50)
  for (const t of [0.25, 0.5, 0.75, 1]) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: point(fromX + (toX - fromX) * t),
    })
    await sleep(35)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(600)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.navigate', { url: URL_APP })
await sleep(2200)

await evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('mood-journal', 1)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  await new Promise((resolve) => {
    const tx = db.transaction('entries', 'readwrite')
    tx.objectStore('entries').clear()
    tx.oncomplete = resolve
  })
  const now = Date.now()
  const rows = [
    { id: 't1', text: '第一条', title: '一', createdAt: now - 1000 },
    { id: 't2', text: '第二条', title: '二', createdAt: now - 2000 },
    { id: 't3', text: '第三条', title: '三', createdAt: now - 3000 },
  ].map((row) => ({ ...row, polarity: 'plain', emotionId: null, photos: [], updatedAt: row.createdAt }))
  await new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite')
    for (const row of rows) tx.objectStore('entries').put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return rows.length
})()`)

await send('Page.reload')
await sleep(2200)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(700)
await evaluate(`document.querySelector('.today-block .entry').click()`)
await sleep(700)

console.log('start:', await counter())
const y = 420

await touchSwipe(320, 80, y)
console.log('左滑后（期望 +1）:', await counter())

await touchSwipe(320, 80, y)
console.log('再左滑（期望 +1）:', await counter())

await touchSwipe(80, 320, y)
console.log('右滑（期望 -1）:', await counter())

await touchSwipe(80, 320, y)
console.log('再右滑（期望 -1）:', await counter())

console.log('console errors:', errors.length ? errors.slice(0, 3) : 'none')

const { data } = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${OUT}/swipe-touch.png`, Buffer.from(data, 'base64'))
console.log('shot swipe-touch')

ws.close()
