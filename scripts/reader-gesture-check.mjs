// 阅读器手势自检：整屏任意位置左右滑动都能翻页；卡片内纵向拖动不翻页；点空白关闭。
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

const drag = async (fromX, fromY, toX, toY) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', clickCount: 1 })
  await sleep(70)
  for (const t of [0.35, 0.7, 1]) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: fromX + (toX - fromX) * t,
      y: fromY + (toY - fromY) * t,
      button: 'left',
    })
    await sleep(45)
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', clickCount: 1 })
  await sleep(500)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: URL_APP })
await sleep(2200)

await evaluate(`(async () => {
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
  const now = Date.now()
  const rows = [
    { id: 'g1', text: '第一条', title: '一', polarity: 'positive', emotionId: 'happy', createdAt: now - 1000 },
    { id: 'g2', text: '第二条', title: '二', polarity: 'negative', emotionId: 'sad', createdAt: now - 2000 },
    { id: 'g3', text: '第三条', title: '三', polarity: 'plain', emotionId: null, createdAt: now - 3000 },
  ].map((row) => ({ ...row, photos: [], updatedAt: row.createdAt }))
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

const geometry = await evaluate(`(() => {
  const card = document.querySelector('.reader-card').getBoundingClientRect()
  return { cardTop: card.top, cardBottom: card.bottom, cardLeft: card.left, cardRight: card.right }
})()`)
console.log('card rect:', JSON.stringify(geometry))

const counter = () => evaluate(`document.querySelector('.reader-counter')?.textContent?.trim() ?? null`)
console.log('start:', await counter())

// 1) 在卡片上方空白处左右滑 → 应该翻页
const yOutside = Math.max(60, geometry.cardTop - 80)
await drag(320, yOutside, 80, yOutside)
const afterOutsideSwipe = await counter()
console.log('swipe outside card (y=' + yOutside + '):', afterOutsideSwipe)
const selection = await evaluate(`window.getSelection() ? window.getSelection().toString() : ''`)
console.log('text selected during swipe:', JSON.stringify(selection))

const { data } = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${OUT}/reader-fullscreen-swipe.png`, Buffer.from(data, 'base64'))
console.log('shot reader-fullscreen-swipe')

// 2) 在卡片内纵向拖 → 不应翻页
const midX = 195
const midY = (geometry.cardTop + geometry.cardBottom) / 2
await drag(midX, midY, midX, midY - 120)
const afterVertical = await counter()
console.log('vertical drag inside card:', afterVertical)

// 3) 点空白处 → 关闭
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 60, y: yOutside, button: 'left', clickCount: 1 })
await sleep(60)
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 60, y: yOutside, button: 'left', clickCount: 1 })
await sleep(400)
const closed = await evaluate(`!document.querySelector('.reader-card')`)
console.log('tap outside closes reader:', closed)

console.log('console errors:', errors.length ? errors.slice(0, 3) : 'none')
ws.close()
