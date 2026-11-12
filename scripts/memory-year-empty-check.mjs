// 换年份后「本月无记录」状态是否正确
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
const state = () =>
  evaluate(`(() => {
    const btn = document.querySelector('.memory-stage .memory-confirm') ?? document.querySelector('.memory-confirm')
    return {
      caption: document.querySelector('.memory-caption')?.innerText.replace(/\\n/g, ' / ') ?? null,
      button: btn?.textContent?.trim() ?? null,
      empty: btn?.classList.contains('is-empty') ?? null,
      year: document.querySelector('.memory-hole-year')?.textContent ?? null,
    }
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

// 造两条本月记录
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
    { id: 'y1', title: '本月', text: '一条记录', createdAt: now - 3600_000 },
    { id: 'y2', title: '本月', text: '另一条', createdAt: now - 7200_000 },
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
console.log('今年本月:', JSON.stringify(await state()))

// 换到 2029（空年）
await evaluate(`document.querySelector('.memory-hole-year').click()`)
await sleep(400)
await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.wheel-stage .wheel-item')]
  rows.find((r) => r.textContent.trim() === '2029 年')?.click()
})()`)
await sleep(700)
await evaluate(`document.querySelector('.wheel-root .memory-confirm').click()`)
await sleep(1000)
console.log('换到 2029:', JSON.stringify(await state()))

// 换回 2026
await evaluate(`document.querySelector('.memory-hole-year').click()`)
await sleep(400)
await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.wheel-stage .wheel-item')]
  rows.find((r) => r.textContent.trim() === '2026 年')?.click()
})()`)
await sleep(700)
await evaluate(`document.querySelector('.wheel-root .memory-confirm').click()`)
await sleep(1000)
console.log('换回 2026:', JSON.stringify(await state()))

ws.close()
