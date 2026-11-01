// 压缩基准：拿一张真实手机照片，比较不同分辨率与编码格式的实际体积和耗时。
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5180/'
const OUT = process.argv[4] ?? 'D:/Desktop/dsh工作区/_shots/bench.json'

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
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
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

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: URL_APP })
await sleep(1500)

const expression = `(async () => {
  const img = new Image()
  img.src = '/_bench-sample.jpg'
  await img.decode()

  const canvasOf = (edge) => {
    const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, w, h)
    return { canvas, w, h }
  }

  const encode = async (canvas, type, quality) => {
    const t0 = performance.now()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality))
    const ms = Math.round(performance.now() - t0)
    return { type: blob.type, bytes: blob.size, ms }
  }

  const support = {
    webp: document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'),
    avif: document.createElement('canvas').toDataURL('image/avif').startsWith('data:image/avif'),
  }

  const rows = []
  for (const edge of [1600, 1440, 1080, 720, 480]) {
    const { canvas, w, h } = canvasOf(edge)
    rows.push({
      edge,
      size: w + 'x' + h,
      jpeg82: await encode(canvas, 'image/jpeg', 0.82),
      jpeg70: await encode(canvas, 'image/jpeg', 0.7),
      webp80: await encode(canvas, 'image/webp', 0.8),
      webp70: await encode(canvas, 'image/webp', 0.7),
      avif55: await encode(canvas, 'image/avif', 0.55),
    })
  }

  const res = await fetch('/_bench-sample.jpg')
  const original = await res.blob()

  return {
    original: { w: img.naturalWidth, h: img.naturalHeight, bytes: original.size },
    support,
    rows,
  }
})()`

const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
if (result.exceptionDetails) {
  console.error('EXCEPTION', JSON.stringify(result.exceptionDetails, null, 2))
  process.exit(1)
}

const data = result.result.value
writeFileSync(OUT, JSON.stringify(data, null, 2))

const kb = (bytes) => (bytes / 1024).toFixed(0) + 'KB'
console.log(`原图 ${data.original.w}x${data.original.h}  ${kb(data.original.bytes)}`)
console.log(`浏览器编码支持: webp=${data.support.webp} avif=${data.support.avif}`)
console.log('')
console.log('尺寸      JPEG82   JPEG70   WebP80   WebP70   AVIF55   (体积/耗时ms)')
for (const row of data.rows) {
  const fmt = (item) => `${kb(item.bytes)}/${item.ms}`
  console.log(
    `${row.size.padEnd(9)} ${fmt(row.jpeg82).padEnd(8)} ${fmt(row.jpeg70).padEnd(8)} ${fmt(row.webp80).padEnd(8)} ${fmt(row.webp70).padEnd(8)} ${fmt(row.avif55)}`,
  )
}

ws.close()
