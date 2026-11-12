// 照片预览自检：左右滑动跟手切换 / 点空白关闭 / 向下拖关闭 / 图片缩放留白
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
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
}
const viewer = () =>
  evaluate(`(() => {
    const root = document.querySelector('.photo-viewer')
    if (!root) return { open: false }
    const track = document.querySelector('.photo-viewer-track')
    const img = document.querySelectorAll('.photo-viewer-image')[1]
    const ir = img?.getBoundingClientRect()
    return {
      open: true,
      counter: document.querySelector('.photo-viewer-counter')?.textContent?.replace(/\\s/g, '') ?? null,
      transform: track?.style.transform ?? null,
      img: ir ? { w: Math.round(ir.width), h: Math.round(ir.height), top: Math.round(ir.top), left: Math.round(ir.left) } : null,
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

// 造一条带三张照片的记录
await evaluate(`new Promise((resolve) => {
  const req = indexedDB.deleteDatabase('mood-journal')
  req.onsuccess = () => resolve(true)
  req.onerror = () => resolve(false)
  req.onblocked = () => resolve(false)
})`)
await send('Page.reload')
await sleep(2000)
await evaluate(`(async () => {
  const make = async (color) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 900
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1200, 900)
    ctx.fillStyle = 'rgba(255,255,255,.75)'
    ctx.font = 'bold 160px sans-serif'
    ctx.fillText(color, 80, 500)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9))
    return blob
  }
  const colors = ['#c2703e', '#3e7cc2', '#4a9c62']
  const photos = []
  for (const c of colors) {
    const full = await make(c)
    photos.push({ thumb: full, full, width: 1200, height: 900 })
  }
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
  const entry = { id: 'p1', title: '三张照片', text: '测试', polarity: 'plain', emotionId: null, photos, createdAt: now - 1000, updatedAt: now - 1000 }
  await new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite')
    tx.objectStore('entries').put(entry)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => reject(tx.error)
  })
})()`)
await send('Page.reload')
await sleep(2000)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(700)
await evaluate(`document.querySelector('.today-block .entry')?.click()`)
await sleep(800)
await evaluate(`document.querySelectorAll('.reader-photo')[0]?.click()`)
await sleep(700)
console.log('打开预览:', JSON.stringify(await viewer()))
await shot('photo-viewer')

// 横向拖动：过程中要看得到位移
const mid = { x: 195, y: 422 }
await touch('touchStart', [point(mid.x + 120, mid.y)])
for (let i = 1; i <= 10; i += 1) {
  await touch('touchMove', [point(mid.x + 120 - 18 * i, mid.y)])
  await sleep(16)
}
console.log('拖动中:', JSON.stringify(await viewer()))
await touch('touchEnd', [])
await sleep(500)
console.log('松手后:', JSON.stringify(await viewer()))

// 点空白关闭（并观察缩小动画）
await evaluate(`(() => {
  const ev = new PointerEvent('pointerdown', { clientX: 20, clientY: 120, bubbles: true })
  document.querySelector('.photo-viewer-stage').dispatchEvent(ev)
  const up = new PointerEvent('pointerup', { clientX: 20, clientY: 120, bubbles: true })
  document.querySelector('.photo-viewer-stage').dispatchEvent(up)
})()`)
await sleep(110)
console.log(
  '关闭动画中:',
  JSON.stringify(
    await evaluate(`(() => {
      const frames = [...document.querySelectorAll('.photo-viewer-frame')]
      const animated = frames.filter((el) => el.style.transform && el.style.transform !== '')
      return {
        open: !!document.querySelector('.photo-viewer'),
        animatedCount: animated.length,
        shift: animated[0]?.style.transform ?? null,
      }
    })()`),
  ),
)
await sleep(450)
console.log('点空白后:', JSON.stringify(await viewer()))

// 重新打开 → 向下拖关闭
await evaluate(`document.querySelectorAll('.reader-photo')[0]?.click()`)
await sleep(700)
await touch('touchStart', [point(195, 380)])
for (let i = 1; i <= 12; i += 1) {
  await touch('touchMove', [point(195, 380 + 18 * i)])
  await sleep(16)
}
await touch('touchEnd', [])
await sleep(700)
console.log('向下拖后:', JSON.stringify(await viewer()))

ws.close()
