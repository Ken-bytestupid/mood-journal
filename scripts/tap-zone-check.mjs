// 分区点击自检：左三分之一上一页、右三分之一下一页、中间点空白关闭、中间点卡片不关闭。
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
const counter = () => evaluate(`document.querySelector('.reader-counter')?.textContent?.trim() ?? null`)
const tap = async (x, y) => {
  const point = [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }]
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point })
  await sleep(60)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(600)
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

const card = await evaluate(`(() => { const r = document.querySelector('.reader-card').getBoundingClientRect(); return { top: r.top, bottom: r.bottom } })()`)
console.log('card:', JSON.stringify(card), 'start:', await counter())

await tap(330, 420)
console.log('点右侧三分之一（期望 +1）:', await counter())

await tap(330, 420)
console.log('再点右侧（期望 +1）:', await counter())

await tap(60, 420)
console.log('点左侧三分之一（期望 -1）:', await counter())

await tap(195, 420)
console.log('点中间·卡片上（期望不变）:', await counter(), '读器开着:', await evaluate(`!!document.querySelector('.reader-card')`))

await tap(195, 150)
console.log('点中间·卡片外（期望关闭）:', await evaluate(`!!document.querySelector('.reader-card')`))

ws.close()
