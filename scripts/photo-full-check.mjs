// 原尺寸照片自检：注入 3200×2133 的图 → 检查两档的尺寸/体积 → 点开查看器看原图。
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
await send('Page.navigate', { url: URL_APP })
await sleep(2200)

const injected = await evaluate(`(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 3200
  canvas.height = 2133
  const ctx = canvas.getContext('2d')
  const grd = ctx.createLinearGradient(0, 0, 3200, 2133)
  grd.addColorStop(0, '#c8b392')
  grd.addColorStop(0.5, '#7e9c76')
  grd.addColorStop(1, '#38506b')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, 3200, 2133)
  for (let i = 0; i < 12000; i += 1) {
    ctx.fillStyle = 'rgba(' + ((i * 31) % 255) + ',' + ((i * 67) % 255) + ',' + ((i * 101) % 255) + ',0.4)'
    ctx.fillRect(Math.random() * 3200, Math.random() * 2133, 7, 7)
  }
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95))
  const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const input = document.querySelector('.card input[type=file]')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return { sourceBytes: blob.size, sourceW: 3200, sourceH: 2133 }
})()`)
console.log('injected:', JSON.stringify(injected))

for (let i = 0; i < 60; i += 1) {
  if (!(await evaluate(`!!document.querySelector('.thumb-processing')`))) break
  await sleep(300)
}
await sleep(400)

await evaluate(`(() => {
  const el = document.querySelector('.editor')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '原尺寸照片测试')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(200)
await evaluate(`document.querySelector('.save-btn').click()`)
await sleep(1500)

const stored = await evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('mood-journal', 1)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const all = await new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readonly')
    const req = tx.objectStore('entries').getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const latest = all[all.length - 1]
  const photo = latest && latest.photos ? latest.photos[0] : null
  if (!photo) return { error: 'no photo' }
  const thumbBmp = await createImageBitmap(photo.thumb)
  const fullBmp = await createImageBitmap(photo.full)
  return {
    keys: Object.keys(photo),
    thumb: { type: photo.thumb.type, bytes: photo.thumb.size, w: thumbBmp.width, h: thumbBmp.height },
    full: { type: photo.full.type, bytes: photo.full.size, w: fullBmp.width, h: fullBmp.height },
    declared: { w: photo.width, h: photo.height },
  }
})()`)
console.log('stored:', JSON.stringify(stored, null, 2))

// 查看器：从「我的 → 今天」进入阅读器，点缩略图
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(700)
await evaluate(`document.querySelector('.today-block .entry').click()`)
await sleep(700)
await shot('reader-thumb')

await evaluate(`document.querySelector('.reader-photo').click()`)
await sleep(900)
await shot('photo-viewer')

const viewer = await evaluate(`(() => {
  const img = document.querySelector('.photo-viewer-image')
  return {
    open: !!document.querySelector('.photo-viewer'),
    natural: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
    counter: document.querySelector('.photo-viewer-counter')?.textContent?.trim() ?? null,
  }
})()`)
console.log('viewer:', JSON.stringify(viewer, null, 2))

await evaluate(`document.querySelector('.photo-viewer-close').click()`)
await sleep(400)
const closed = await evaluate(`!document.querySelector('.photo-viewer')`)
console.log('viewer closed:', closed)
console.log('console errors:', errors.length ? errors.slice(0, 3) : 'none')

ws.close()
