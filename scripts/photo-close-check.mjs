// 关闭预览过程中：详情一直在、缩略图先不显示，结束后缩略图出现
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
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
}
const state = () =>
  evaluate(`(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      return getComputedStyle(el).visibility
    }
    return {
      viewer: !!document.querySelector('.photo-viewer'),
      详情标题: vis('.reader-title'),
      缩略图: [...document.querySelectorAll('.reader-photo')].map((el) => getComputedStyle(el).visibility),
      缩略图张数: document.querySelectorAll('.reader-photo').length,
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
await sleep(400)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(700)
await evaluate(`document.querySelector('.today-block .entry')?.click()`)
await sleep(800)
await evaluate(`document.querySelectorAll('.reader-photo')[0]?.click()`)
await sleep(700)
console.log('打开预览:', JSON.stringify(await state()))

// 点空白触发关闭
await evaluate(`(() => {
  const stage = document.querySelector('.photo-viewer-stage')
  stage.dispatchEvent(new PointerEvent('pointerdown', { clientX: 16, clientY: 120, bubbles: true }))
  stage.dispatchEvent(new PointerEvent('pointerup', { clientX: 16, clientY: 120, bubbles: true }))
})()`)
await sleep(120)
console.log('缩小动画 120ms:', JSON.stringify(await state()))
await shot('photo-closing')
await sleep(120)
console.log('缩小动画 240ms:', JSON.stringify(await state()))
await sleep(260)
console.log('动画结束:', JSON.stringify(await state()))
await shot('photo-closed')

ws.close()
