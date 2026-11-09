// 编解码自检：mode=webp 走正常路径；mode=jpeg 模拟 Safari（canvas 不支持编码 WebP）。
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5180/'
const MODE = process.argv[4] ?? 'webp'
const OUT = process.argv[5] ?? 'D:/Desktop/dsh工作区/_shots'

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

if (MODE === 'jpeg') {
  // 模拟 WebKit：canvas 不接受 image/webp，回退成 png —— 应用应当据此改用 JPEG
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL
      HTMLCanvasElement.prototype.toDataURL = function (type, quality) {
        if (type === 'image/webp') type = 'image/png'
        return origToDataURL.call(this, type, quality)
      }
      const origToBlob = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        if (type === 'image/webp') type = 'image/png'
        return origToBlob.call(this, callback, type, quality)
      }
    `,
  })
}

await send('Page.navigate', { url: URL_APP })
await sleep(2200)

await evaluate(`(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 2000
  canvas.height = 1500
  const ctx = canvas.getContext('2d')
  const grd = ctx.createLinearGradient(0, 0, 2000, 1500)
  grd.addColorStop(0, '#b9c7a4')
  grd.addColorStop(1, '#5c7a8c')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, 2000, 1500)
  for (let i = 0; i < 4000; i += 1) {
    ctx.fillStyle = 'rgba(' + ((i * 53) % 255) + ',' + ((i * 97) % 255) + ',' + ((i * 31) % 255) + ',0.3)'
    ctx.fillRect(Math.random() * 2000, Math.random() * 1500, 8, 8)
  }
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95))
  const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const input = document.querySelector('.card input[type=file]')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`)

for (let i = 0; i < 40; i += 1) {
  if (!(await evaluate(`!!document.querySelector('.thumb-processing')`))) break
  await sleep(250)
}
await sleep(300)

await evaluate(`(() => {
  const el = document.querySelector('.editor')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '${MODE} 路径测试')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(200)
await evaluate(`document.querySelector('.save-btn').click()`)
await sleep(1200)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(900)

const state = await evaluate(`(async () => {
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
  const rows = [...document.querySelectorAll('.storage-row')].map((row) => row.innerText.replace(/\\s+/g, ' '))
  return {
    entries: all.length,
    thumb: photo ? { type: photo.thumb.type, bytes: photo.thumb.size } : null,
    view: photo ? { type: photo.view.type, bytes: photo.view.size } : null,
    photoFormatRow: rows.find((r) => r.startsWith('照片格式')) ?? null,
    usageRow: rows.find((r) => r.startsWith('已用空间')) ?? null,
  }
})()`)
console.log(MODE, JSON.stringify(state, null, 2))
console.log('console errors:', errors.length ? errors.slice(0, 3) : 'none')

const { data } = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`${OUT}/codec-${MODE}.png`, Buffer.from(data, 'base64'))
console.log('shot', `${OUT}/codec-${MODE}.png`)

ws.close()
