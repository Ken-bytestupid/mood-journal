// 诊断：记录一次右滑期间的指针事件序列，看 endDrag 为什么判定成"点击空白"。
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
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.navigate', { url: URL_APP })
await sleep(2200)

await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(700)
await evaluate(`document.querySelector('.today-block .entry').click()`)
await sleep(700)

console.log('counter before:', await evaluate(`document.querySelector('.reader-counter')?.textContent?.trim()`))
console.log('card rect:', await evaluate(`JSON.stringify(document.querySelector('.reader-card').getBoundingClientRect())`))

await evaluate(`(() => {
  window.__log = []
  const rec = (event) => {
    window.__log.push({
      type: event.type,
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
      target: event.target && event.target.className ? String(event.target.className).slice(0, 40) : event.target?.tagName,
      pointerType: event.pointerType,
    })
  }
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    document.addEventListener(type, rec, true)
  }
  return true
})()`)

const point = (x, y) => [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }]
const y = 420
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(80, y) })
await sleep(60)
for (const t of [0.3, 0.6, 1]) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(80 + 240 * t, y) })
  await sleep(40)
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(700)

const log = await evaluate(`window.__log`)
console.log('pointer events:', JSON.stringify(log, null, 2))
console.log('counter after:', await evaluate(`document.querySelector('.reader-counter')?.textContent?.trim() ?? null`))

ws.close()
