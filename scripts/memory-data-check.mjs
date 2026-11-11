// 「记忆」带数据的验证：月 → 周 → 列表（复用 EntryRow）→ 阅读器 → 删除确认。
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
await sleep(2500)

// 写入三条今天的记录（同一个月、同一周）
await evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('mood-journal', 1)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const now = Date.now()
  const rows = [
    { id: 'm1', title: '午饭', text: '面很好吃', createdAt: now - 3600_000 },
    { id: 'm2', title: '散步', text: '江边风很大', createdAt: now - 7200_000 },
    { id: 'm3', title: '', text: '下午有点困', createdAt: now - 10800_000 },
  ].map((row) => ({ ...row, polarity: 'plain', emotionId: null, photos: [], updatedAt: row.createdAt }))
  await new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite')
    for (const row of rows) tx.objectStore('entries').put(row)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => reject(tx.error)
  })
  return rows.length
})()`)

await send('Page.reload')
await sleep(2500)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(600)
await evaluate(`[...document.querySelectorAll('.tile')].find((b) => b.textContent.includes('记忆')).click()`)
await sleep(900)
console.log('打开（应停在当前月）:', await evaluate(`document.querySelector('.memory-caption')?.innerText.replace(/\\n/g, ' / ')`))
await shot('mem-current')

await evaluate(`document.querySelector('.memory-confirm').click()`)
await sleep(1500)
console.log('周环:', await evaluate(`document.querySelector('.memory-caption')?.innerText.replace(/\\n/g, ' / ')`))

await evaluate(`document.querySelector('.memory-confirm').click()`)
await sleep(1500)
console.log('列表行数:', await evaluate(`document.querySelectorAll('.memory-list .entry').length`))
await shot('mem-list')

// 点第一行打开阅读器
await evaluate(`document.querySelector('.memory-list .entry').click()`)
await sleep(900)
console.log('阅读器:', await evaluate(`document.querySelector('.reader-counter')?.textContent?.trim() ?? null`))
await shot('mem-reader')

// 阅读器里点删除 → 二次确认
await evaluate(`document.querySelector('.reader-delete').click()`)
await sleep(600)
console.log('确认框:', await evaluate(`document.querySelector('.confirm-title')?.textContent ?? null`))
await evaluate(`[...document.querySelectorAll('.confirm-actions button')][0].click()`)
await sleep(500)

console.log('取消后行数:', await evaluate(`document.querySelectorAll('.memory-list .entry').length`))
await evaluate(`document.querySelector('.reader-close')?.click()`)
await sleep(500)
console.log('关闭阅读器后行数:', await evaluate(`document.querySelectorAll('.memory-list .entry').length`))

ws.close()
