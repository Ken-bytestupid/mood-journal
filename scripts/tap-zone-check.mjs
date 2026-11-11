// 分区点击自检：左三分之一上一页、右三分之一下一页、中间退出详情、× 也能关闭。
const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5180/'

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
const counter = () => evaluate(`document.querySelector('.reader-counter')?.textContent?.trim() ?? null`)
const open = () => evaluate(`!!document.querySelector('.reader-card')`)
const tap = async (x, y) => {
  const point = [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }]
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point })
  await sleep(60)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(650)
}
const reopen = async () => {
  await evaluate(`document.querySelector('.today-block .entry').click()`)
  await sleep(700)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.navigate', { url: URL_APP })
await sleep(2200)

// 先塞三条今天的记录，保证有得翻
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
    { id: 'z1', text: '第一条', title: '一', createdAt: now - 1000 },
    { id: 'z2', text: '第二条', title: '二', createdAt: now - 2000 },
    { id: 'z3', text: '第三条', title: '三', createdAt: now - 3000 },
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
await reopen()

console.log('start:', await counter())
await tap(330, 420)
console.log('点右侧三分之一（期望 +1）:', await counter())
await tap(330, 420)
console.log('再点右侧（期望 +1）:', await counter())
await tap(60, 420)
console.log('点左侧三分之一（期望 -1）:', await counter())

await tap(195, 420)
console.log('点中间·卡片上（期望关闭）: 读器开着=', await open(), 'counter=', await counter())

await reopen()
console.log('重新打开:', await counter())
await tap(195, 150)
console.log('点中间·卡片外（期望关闭）: 读器开着=', await open())

await reopen()
await evaluate(`document.querySelector('.overlay-close').click()`)
await sleep(500)
console.log('点右上角 ×（期望关闭）: 读器开着=', await open())

ws.close()
