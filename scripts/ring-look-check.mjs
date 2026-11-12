// 圆环外观样张：浅色 / 深色 / 关闭按钮两种位置
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
const tap = async (x, y) => {
  await touch('touchStart', [point(x, y)])
  await sleep(60)
  await touch('touchEnd', [])
  await sleep(700)
}
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

const openMemory = async () => {
  await send('Page.navigate', { url: URL_APP })
  for (let i = 0; i < 40; i += 1) {
    if (await evaluate(`document.querySelectorAll('.tab').length === 2`)) break
    await sleep(250)
  }
  await sleep(400)
  await evaluate(`document.querySelectorAll('.tab')[1].click()`)
  await sleep(600)
  await evaluate(`[...document.querySelectorAll('.tile')].find((b) => b.textContent.includes('记忆')).click()`)
  await sleep(900)
}

// 浅色：默认（选中月 = 本月）
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
await openMemory()
await shot('ring-light-a')

// 浅色：转一格（用旋转手势，避免触发「点空白退出」），看「有记录但未选中」的浅灰
const cx = 195
const cy = 422
const at = (deg) => point(cx + 150 * Math.cos((deg * Math.PI) / 180), cy + 150 * Math.sin((deg * Math.PI) / 180))
await touch('touchStart', [at(-90)])
for (let i = 1; i <= 12; i += 1) {
  await touch('touchMove', [at(-90 + (60 * i) / 12)])
  await sleep(16)
}
await touch('touchEnd', [])
await sleep(700)
await shot('ring-light-b')

// 深色
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
await openMemory()
await shot('ring-dark')

// 变体 B：关闭按钮跟着选中块一起上移
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
await openMemory()
await evaluate(`(() => {
  const btn = document.querySelector('.memory-close')
  if (btn) btn.style.top = '-52px'
})()`)
await sleep(300)
await shot('ring-light-close-moved')

ws.close()
