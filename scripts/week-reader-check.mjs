// 「本周 / 今天 / 翻页阅读器」自检。
// 为了有跨天的本周数据，把页面里的 Date.now() 往后挪 3 天（相当于今天是周四）。
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

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
  console.log('shot', name)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

// 把「现在」往后挪 3 天，让本周有多个自然日
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    const __offset = 3 * 86400000
    const __realNow = Date.now.bind(Date)
    Date.now = () => __realNow() + __offset
  `,
})

await send('Page.navigate', { url: URL_APP })
await sleep(2200)

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
    { id: 'w1', text: '今天上午把方案交了，轻松。', title: '交稿', polarity: 'positive', emotionId: 'happy', createdAt: now - 3600000 },
    { id: 'w2', text: '下午有个会开得有点久。', title: '', polarity: 'plain', emotionId: null, createdAt: now - 7200000 },
    { id: 'w3', text: '昨天走了很远的路。', title: '走路', polarity: 'positive', emotionId: 'calm', createdAt: now - day },
    { id: 'w4', text: '前天有点烦。', title: '', polarity: 'negative', emotionId: 'anxious', createdAt: now - day * 2 },
    { id: 'w5', text: '三天前睡得很好。', title: '睡饱', polarity: 'positive', emotionId: 'satisfied', createdAt: now - day * 3 },
  ].map((row) => ({ ...row, photos: [], updatedAt: row.createdAt }))

  await new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite')
    for (const row of rows) tx.objectStore('entries').put(row)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return rows.length
})()`)
console.log('seeded:', seeded)

await send('Page.reload')
await sleep(2200)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(900)
await shot('week-today')

const header = await evaluate(`(() => ({
  brand: document.querySelector('.page-brand')?.textContent ?? null,
  statBoxes: document.querySelectorAll('.stat').length,
  tiles: [...document.querySelectorAll('.tile')].map((t) => t.innerText.replace(/\\s+/g, ' ')),
  todayRows: document.querySelectorAll('.today-block .entry').length,
  moodStrip: document.querySelector('.mood-strip-head')?.innerText.replace(/\\s+/g, ' ') ?? null,
}))()`)
console.log('header:', JSON.stringify(header, null, 2))

// 打开「本周」
await evaluate(`document.querySelector('.tile').click()`)
await sleep(800)
await shot('week-sheet')

const week = await evaluate(`(() => {
  const panel = document.querySelector('.sheet-root[data-open="true"] .sheet-panel')
  return {
    title: panel?.querySelector('.sheet-title')?.textContent ?? null,
    groups: [...panel.querySelectorAll('.day-head')].map((d) => d.innerText.replace(/\\s+/g, ' ')),
    rows: panel.querySelectorAll('.entry').length,
  }
})()`)
console.log('week:', JSON.stringify(week, null, 2))

// 点第一条 → 阅读器
await evaluate(`document.querySelector('.sheet-root[data-open="true"] .entry').click()`)
await sleep(700)
await shot('reader-1')

const reader1 = await evaluate(`(() => {
  const card = document.querySelector('.reader-card')
  return {
    open: !!card,
    counter: document.querySelector('.reader-counter')?.textContent?.trim() ?? null,
    title: card?.querySelector('.reader-title')?.textContent ?? null,
  }
})()`)
console.log('reader#1:', JSON.stringify(reader1, null, 2))

// 模拟左滑：按下 → 拖动 → 松开
const swipe = async (fromX, toX, y = 420) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y, button: 'left', clickCount: 1 })
  await sleep(60)
  for (const x of [fromX + (toX - fromX) * 0.4, fromX + (toX - fromX) * 0.8, toX]) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' })
    await sleep(40)
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y, button: 'left', clickCount: 1 })
  await sleep(450)
}

await swipe(300, 90)
await shot('reader-2')

const reader2 = await evaluate(`(() => ({
  counter: document.querySelector('.reader-counter')?.textContent?.trim() ?? null,
  title: document.querySelector('.reader-title')?.textContent ?? null,
  body: document.querySelector('.reader-text')?.textContent ?? null,
}))()`)
console.log('reader#2 after swipe:', JSON.stringify(reader2, null, 2))

// 再往右滑回上一条
await swipe(90, 300)
const reader3 = await evaluate(`document.querySelector('.reader-counter')?.textContent?.trim() ?? null`)
console.log('reader#3 after swipe back:', reader3)

console.log('console errors:', errors.length ? errors.slice(0, 3) : 'none')
ws.close()
