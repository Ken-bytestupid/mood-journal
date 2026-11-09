// 照片压缩自检：注入一张大图 → 等压缩 → 保存 → 检查库里存的是不是双档 Blob。
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
const consoleErrors = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
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

// 1) 旧数据（dataURL 照片）兼容性：先看「我的」
await evaluate(`[...document.querySelectorAll('.tab')].at(-1).click()`)
await sleep(800)
await shot('photo-legacy-list')

const legacy = await evaluate(`(() => {
  const imgs = [...document.querySelectorAll('.entry-photos img')]
  return { thumbs: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length }
})()`)
console.log('legacy list photos:', JSON.stringify(legacy))

// 2) 回记录页，注入一张 3200×2133 的模拟照片
await evaluate(`[...document.querySelectorAll('.tab')][0].click()`)
await sleep(500)

const injected = await evaluate(`(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 3200
  canvas.height = 2133
  const ctx = canvas.getContext('2d')
  const grd = ctx.createLinearGradient(0, 0, 3200, 2133)
  grd.addColorStop(0, '#c9b28a')
  grd.addColorStop(0.5, '#7f9f7a')
  grd.addColorStop(1, '#3d5a73')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, 3200, 2133)
  // 加点纹理，模拟真实照片的高频细节
  for (let i = 0; i < 9000; i += 1) {
    ctx.fillStyle = 'rgba(' + ((i * 37) % 255) + ',' + ((i * 71) % 255) + ',' + ((i * 113) % 255) + ',0.35)'
    ctx.fillRect(Math.random() * 3200, Math.random() * 2133, 6, 6)
  }
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95))
  const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const input = document.querySelector('.card input[type=file]')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return { sourceBytes: blob.size }
})()`)
console.log('injected source:', JSON.stringify(injected))

// 3) 等压缩结束（「处理中」占位消失）
for (let i = 0; i < 40; i += 1) {
  const busy = await evaluate(`!!document.querySelector('.thumb-processing')`)
  if (!busy) break
  await sleep(250)
}
await sleep(300)
await shot('photo-composing')

// 4) 保存
await evaluate(`(() => {
  const el = document.querySelector('.editor')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '带照片的一条记录')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(200)
await evaluate(`document.querySelector('.save-btn').click()`)
await sleep(1200)

await evaluate(`[...document.querySelectorAll('.tab')].at(-1).click()`)
await sleep(900)
await shot('photo-saved-list')

// 5) 检查存储里的真实结构
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
  return {
    entries: all.length,
    photoKind: photo ? Object.prototype.toString.call(photo) : null,
    thumb: photo ? { type: photo.thumb.type, bytes: photo.thumb.size, isBlob: photo.thumb instanceof Blob } : null,
    view: photo ? { type: photo.view.type, bytes: photo.view.size, isBlob: photo.view instanceof Blob } : null,
    width: photo ? photo.width : null,
    height: photo ? photo.height : null,
    estimate: await navigator.storage.estimate(),
  }
})()`)
console.log('stored photo:', JSON.stringify(stored, null, 2))
console.log('console errors:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'none')

ws.close()
