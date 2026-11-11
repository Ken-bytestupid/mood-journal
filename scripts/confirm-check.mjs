// 二次确认自检（稳健版）：删除单条 / 清空全部都必须先弹确认框；取消不生效、确认才执行。
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5180/'
const OUT = process.argv[4] ?? 'D:/Desktop/dsh工作区/_shots'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
if (!page) throw new Error('找不到可调试的页面')

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

const evaluate = async (expression, timeoutMs = 15000) => {
  const result = await Promise.race([
    send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    sleep(timeoutMs).then(() => {
      throw new Error('evaluate 超时')
    }),
  ])
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
}

const dbState = () =>
  evaluate(`new Promise((resolve) => {
    const req = indexedDB.open('mood-journal', 1)
    req.onupgradeneeded = () => {}
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('entries')) { db.close(); resolve(-1); return }
      const tx = db.transaction('entries', 'readonly')
      const all = tx.objectStore('entries').getAll()
      all.onsuccess = () => { const n = all.result.length; db.close(); resolve(n) }
    }
    req.onerror = () => resolve(-2)
  })`)

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.navigate', { url: URL_APP })
await sleep(2500)

// 等 app 建好库（objectStore 存在）
let ready = -1
for (let i = 0; i < 30; i += 1) {
  ready = await dbState()
  if (ready >= 0) break
  await sleep(300)
}
console.log('库就绪，现有条数:', ready)

// 写入两条记录
await evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('mood-journal', 1)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const now = Date.now()
  const rows = [
    { id: 'd1', text: '第一条', title: '一', createdAt: now - 1000 },
    { id: 'd2', text: '第二条', title: '二', createdAt: now - 2000 },
  ].map((row) => ({ ...row, polarity: 'plain', emotionId: null, photos: [], updatedAt: row.createdAt }))
  await new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite')
    for (const row of rows) tx.objectStore('entries').put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
  return rows.length
})()`)

await send('Page.reload')
await sleep(2500)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(800)
console.log('初始条数:', await dbState())

// 1) 点删除 → 必须弹确认框
await evaluate(`document.querySelector('.today-block .entry').click()`)
await sleep(800)
await evaluate(`document.querySelector('.reader-delete').click()`)
await sleep(600)
const dialog = await evaluate(`(() => {
  const root = document.querySelector('.confirm-root')
  if (!root) return null
  return {
    title: root.querySelector('.confirm-title')?.textContent,
    message: root.querySelector('.confirm-message')?.textContent,
    buttons: [...root.querySelectorAll('button')].map((b) => b.textContent.trim()),
  }
})()`)
console.log('删除确认框:', JSON.stringify(dialog))
await shot('confirm-delete')

// 取消 → 记录仍在
await evaluate(`[...document.querySelectorAll('.confirm-actions button')][0].click()`)
await sleep(500)
console.log('取消后条数（期望 2）:', await dbState(), '读器还在:', await evaluate(`!!document.querySelector('.reader-card')`))

// 再点删除 → 确认
await evaluate(`document.querySelector('.reader-delete').click()`)
await sleep(500)
await evaluate(`document.querySelector('.confirm-danger').click()`)
await sleep(1000)
console.log('确认删除后条数（期望 1）:', await dbState(), '读器已关:', await evaluate(`!document.querySelector('.reader-card')`))

// 2) 通用 → 清空全部
await evaluate(`document.querySelector('.page.mine > .data-card .data-row').click()`)
await sleep(800)
await evaluate(`[...document.querySelectorAll('.sheet-root[data-open="true"] .data-row')].find((b) => b.textContent.includes('清空全部记录')).click()`)
await sleep(600)
console.log('清空确认框:', JSON.stringify(await evaluate(`(() => { const r = document.querySelector('.confirm-root'); return r ? { title: r.querySelector('.confirm-title')?.textContent, buttons: [...r.querySelectorAll('button')].map(b => b.textContent.trim()) } : null })()`)))
await shot('confirm-clear')

// 取消 → 仍有一条
await evaluate(`[...document.querySelectorAll('.confirm-actions button')][0].click()`)
await sleep(500)
console.log('取消清空后条数（期望 1）:', await dbState())

// 再清空 → 确认
await evaluate(`[...document.querySelectorAll('.sheet-root[data-open="true"] .data-row')].find((b) => b.textContent.includes('清空全部记录')).click()`)
await sleep(500)
await evaluate(`document.querySelector('.confirm-danger').click()`)
await sleep(1000)
console.log('确认清空后条数（期望 0）:', await dbState())

ws.close()
