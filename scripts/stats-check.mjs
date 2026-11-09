// 统计自检：直接往 IndexedDB 里塞跨天的记录，确认三个统计框与心情分布仍然正确。
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5180/'
const OUT = process.argv[4] ?? 'D:/Desktop/dsh工作区/_shots/stats.png'

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

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: URL_APP })
await sleep(2200)

// 清空后写入固定数据：今天 2 条（积极/消极），昨天 1 条（只是记录），前天 1 条（积极）
const seeded = await evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('mood-journal', 1)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  await new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite')
    tx.objectStore('entries').clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  const day = 86400000
  const now = Date.now()
  const rows = [
    { id: 'a', text: '今天积极', polarity: 'positive', emotionId: 'happy', createdAt: now - 1000 },
    { id: 'b', text: '今天消极', polarity: 'negative', emotionId: 'sad', createdAt: now - 2000 },
    { id: 'c', text: '昨天只是记录', polarity: 'plain', emotionId: null, createdAt: now - day },
    { id: 'd', text: '前天积极', polarity: 'positive', emotionId: 'calm', createdAt: now - day * 2 },
    { id: 'e', text: '四天前消极', polarity: 'negative', emotionId: null, createdAt: now - day * 4 },
  ].map((row) => ({ ...row, title: '', photos: [], updatedAt: row.createdAt }))

  await new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite')
    for (const row of rows) tx.objectStore('entries').put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return rows.length
})()`)
console.log('seeded rows:', seeded)

await send('Page.reload')
await sleep(2200)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(900)

const stats = await evaluate(`(() => ({
  stats: [...document.querySelectorAll('.stat')].map((s) => s.innerText.replace(/\\s+/g, ' ')),
  moodStrip: document.querySelector('.mood-strip-head')?.innerText.replace(/\\s+/g, ' ') ?? null,
  dayGroups: [...document.querySelectorAll('.day-head')].map((d) => d.innerText.replace(/\\s+/g, ' ')),
  entries: document.querySelectorAll('.entry').length,
}))()`)
console.log(JSON.stringify(stats, null, 2))
console.log('console errors:', errors.length ? errors.slice(0, 3) : 'none')

const { data } = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(OUT, Buffer.from(data, 'base64'))
console.log('shot', OUT)

ws.close()
