// 页码下面的提示行：位置与样式检查（固定 390×844 视口）。
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5180/'
const OUT = process.argv[4] ?? 'D:/Desktop/dsh工作区/_shots/reader-hint.png'

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
await send('Page.navigate', { url: URL_APP })
await sleep(2200)

await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(700)
await evaluate(`document.querySelector('.today-block .entry').click()`)
await sleep(700)

const metrics = await evaluate(`(() => {
  const hint = document.querySelector('.reader-hint')
  const counter = document.querySelector('.reader-counter')
  const card = document.querySelector('.reader-card').getBoundingClientRect()
  const h = hint.getBoundingClientRect()
  const c = counter.getBoundingClientRect()
  const cs = getComputedStyle(hint)
  const ks = getComputedStyle(counter)
  return {
    viewport: window.innerWidth + 'x' + window.innerHeight,
    hint: hint.textContent,
    style: { size: cs.fontSize, color: cs.color, spacing: cs.letterSpacing, opacity: cs.opacity },
    counterStyle: { size: ks.fontSize, color: ks.color, spacing: ks.letterSpacing, opacity: ks.opacity },
    hintCenterX: Math.round(h.left + h.width / 2),
    counterCenterX: Math.round(c.left + c.width / 2),
    cardCenterX: Math.round(card.left + card.width / 2),
    gapCounterToHint: Math.round(h.top - c.bottom),
    gapCardBottomToHint: Math.round(h.top - card.bottom),
  }
})()`)
console.log(JSON.stringify(metrics, null, 2))

const { data } = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(OUT, Buffer.from(data, 'base64'))
console.log('shot', OUT)

ws.close()
