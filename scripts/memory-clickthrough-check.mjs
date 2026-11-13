// 月环点空白关闭时，不应该顺带触发背景「我的」页的按钮
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
const tap = async (x, y) => {
  await touch('touchStart', [point(x, y)])
  await sleep(70)
  await touch('touchEnd', [])
  await sleep(900)
}
const state = () =>
  evaluate(`({
    memory: !!document.querySelector('.memory'),
    sheet: !!document.querySelector('.sheet-root[data-open="true"]'),
  })`)

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

// 「通用」行的位置：点它会打开抽屉，用来验证有没有穿透
const rect = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.page.mine .data-row')]
  const target = rows.find((r) => r.textContent.includes('通用'))
  if (!target) return null
  const r = target.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
console.log('通用行坐标:', JSON.stringify(rect))

await evaluate(`[...document.querySelectorAll('.tile')].find((b) => b.textContent.includes('记忆')).click()`)
await sleep(900)
console.log('打开记忆:', JSON.stringify(await state()))

// 点圆环外、且正好压在「通用」行上
await tap(18, rect.y)
console.log('点空白（压在通用行上）:', JSON.stringify(await state()))

ws.close()
