// 放大截取「mood & memory」那一行，用来判断字形是否清晰。
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] ?? 9229)
const OUT = process.argv[3] ?? 'D:/Desktop/dsh工作区/_shots/brand.png'

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

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: 'http://127.0.0.1:5180/' })
await sleep(2000)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(700)

const rect = await evaluate(`(() => {
  const el = document.querySelector('.page-brand')
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})()`)

const { data } = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: Math.max(0, rect.x - 6), y: Math.max(0, rect.y - 6), width: rect.width + 12, height: rect.height + 12, scale: 5 },
})
writeFileSync(OUT, Buffer.from(data, 'base64'))
console.log('shot', OUT, JSON.stringify(rect))

ws.close()
