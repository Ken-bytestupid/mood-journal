// 直接调用 app 的 compressPhoto，量一下真实输出体积
const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5180/'

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

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: URL_APP })
for (let i = 0; i < 40; i += 1) {
  if (await evaluate(`document.querySelectorAll('.tab').length === 2`)) break
  await sleep(250)
}

const result = await evaluate(`(async () => {
  const { compressPhoto, preferredImageType } = await import('/src/core/image.ts')

  const make = async (w, h, noisy) => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    const grad = ctx.createLinearGradient(0, 0, w, h)
    grad.addColorStop(0, '#8aa4c8')
    grad.addColorStop(0.5, '#d8c3a5')
    grad.addColorStop(1, '#4b5d52')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
    if (noisy) {
      for (let i = 0; i < 30000; i += 1) {
        ctx.fillStyle = 'rgba(' + ((i * 37) % 255) + ',' + ((i * 91) % 255) + ',' + ((i * 53) % 255) + ',0.5)'
        ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3)
      }
    }
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95))
    return new File([blob], 'photo.jpg', { type: 'image/jpeg' })
  }

  const kb = (n) => Math.round(n / 1024)
  const out = { 编码格式: preferredImageType(), 结果: [] }
  for (const spec of [
    { label: '1200×900 平滑', w: 1200, h: 900, noisy: false },
    { label: '4032×3024 平滑（12MP）', w: 4032, h: 3024, noisy: false },
    { label: '4032×3024 高纹理（12MP）', w: 4032, h: 3024, noisy: true },
  ]) {
    const file = await make(spec.w, spec.h, spec.noisy)
    const t0 = performance.now()
    const photo = await compressPhoto(file)
    const ms = Math.round(performance.now() - t0)
    out.结果.push({
      场景: spec.label,
      原图: kb(file.size) + ' KB',
      缩略图: kb(photo.thumb.size) + ' KB',
      原尺寸图: kb(photo.full.size) + ' KB',
      输出像素: photo.width + '×' + photo.height,
      压缩耗时: ms + ' ms',
    })
  }
  return out
})()`)

console.log('编码格式:', result.编码格式)
for (const row of result.结果) console.log(JSON.stringify(row, null, 0))

ws.close()
