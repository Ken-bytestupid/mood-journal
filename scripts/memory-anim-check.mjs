// 验证：点环外翻周时，圆环是转过去的（有过渡动画），不是瞬移
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
const touch = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points })
const point = (x, y) => ({ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 })

const rotation = () =>
  evaluate(`(() => {
    const track = document.querySelector('.memory-ring .memory-ring-track')
    if (!track) return null
    const m = new DOMMatrixReadOnly(getComputedStyle(track).transform)
    return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI)
  })()`)

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.navigate', { url: URL_APP })
await sleep(2400)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(600)
await evaluate(`[...document.querySelectorAll('.tile')].find((b) => b.textContent.includes('记忆')).click()`)
await sleep(900)
await evaluate(`document.querySelector('.memory-confirm').click()`)
await sleep(1800)

const before = await rotation()
await touch('touchStart', [point(340, 720)])
await sleep(50)
await touch('touchEnd', [])
await sleep(80)
const mid = await rotation()
await sleep(700)
const after = await rotation()
console.log('周环旋转角度: 点之前', before, '| 80ms 时', mid, '| 稳定后', after)
console.log('是否在动画中（中间值应介于两端）:', mid !== before && mid !== after ? '是' : '否（瞬移）')

ws.close()
