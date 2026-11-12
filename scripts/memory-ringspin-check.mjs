// 验证：翻周到末尾后继续点，圆环顺着转（不会原路返回）
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
  await sleep(50)
  await touch('touchEnd', [])
  await sleep(620)
}
const ring = () =>
  evaluate(`(() => {
    const track = document.querySelector('.memory-ring .memory-ring-track')
    const week = document.querySelector('.memory-ring .memory-item[data-active="true"]')?.textContent ?? null
    if (!track) return { spin: null, week }
    const m = /rotate\\((-?[\\d.]+)deg\\)/.exec(track.style.transform)
    return { spin: m ? Number(m[1]) : null, week }
  })()`)

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.navigate', { url: URL_APP })
for (let i = 0; i < 40; i += 1) {
  const ready = await evaluate(`document.querySelectorAll('.tab').length === 2`)
  if (ready) break
  await sleep(250)
}
await sleep(400)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(600)
await evaluate(`[...document.querySelectorAll('.tile')].find((b) => b.textContent.includes('记忆')).click()`)
await sleep(900)
await evaluate(`document.querySelector('.memory-confirm').click()`)
await sleep(1800)

console.log('起点:', JSON.stringify(await ring()))

const startSpin = (await ring()).spin
console.log('起点 spin:', startSpin)

const forward = []
for (let i = 1; i <= 8; i += 1) {
  await tap(340, 720)
  const s = await ring()
  forward.push(s)
  console.log(`第 ${i} 次点右侧 → 第 ${s.week} 周，spin = ${s.spin}`)
}
const forwardAll = [startSpin, ...forward.map((s) => s.spin)]
const forwardSteps = forwardAll.slice(1).map((v, i) => v - forwardAll[i])
console.log('每步角度变化:', JSON.stringify(forwardSteps))
console.log('是否始终同方向（全部 -60）:', forwardSteps.every((d) => d === -60) ? '是 ✓' : '否 ✗')

const back = []
for (let i = 1; i <= 8; i += 1) {
  await tap(50, 720)
  back.push(await ring())
}
const backAll = [forwardAll[forwardAll.length - 1], ...back.map((s) => s.spin)]
const backSteps = backAll.slice(1).map((v, i) => v - backAll[i])
console.log('反向每步角度变化:', JSON.stringify(backSteps))
console.log('反向是否始终同方向（全部 +60）:', backSteps.every((d) => d === 60) ? '是 ✓' : '否 ✗')

ws.close()
