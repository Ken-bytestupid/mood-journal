// ErrorBoundary 验证：区块崩溃不影响整页；整页崩溃不影响另一个页面。
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

const tabState = () =>
  evaluate(`(() => ({
    fallbacks: [...document.querySelectorAll('.error-fallback-title')].map((n) => n.textContent),
    tabbar: !!document.querySelector('.tabbar'),
    tabs: document.querySelectorAll('.tab').length,
    editor: !!document.querySelector('.editor'),
    todayBlock: !!document.querySelector('.today-block'),
    moodStrip: !!document.querySelector('.mood-strip'),
  }))()`)

const waitForApp = async (label) => {
  for (let i = 0; i < 40; i += 1) {
    const ok = await evaluate(`document.querySelectorAll('.tab').length === 2`)
    if (ok) return
    await sleep(250)
  }
  throw new Error(`${label}: 应用没渲染出来`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

const state = tabState

// 1) 区块级崩溃：心情分布炸掉，其余照常
await send('Page.navigate', { url: URL_APP + '?crash=stats' })
await waitForApp('crash=stats')
await sleep(500)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(900)
console.log('区块崩溃后:', JSON.stringify(await state()))
const { data } = await send('Page.captureScreenshot', { format: 'png' })
const fs = await import('node:fs')
fs.writeFileSync(`${OUT}/boundary-block.png`, Buffer.from(data, 'base64'))

// 切到记录页应正常
await evaluate(`document.querySelectorAll('.tab')[0].click()`)
await sleep(600)
console.log('切到记录页是否可用:', JSON.stringify(await evaluate(`({ editor: !!document.querySelector('.editor'), topbar: !!document.querySelector('.topbar') })`)))

// 2) 整页崩溃：我的页面炸掉，记录页和底部导航仍然可用
await send('Page.navigate', { url: URL_APP + '?crash=mine' })
await waitForApp('crash=mine')
await sleep(500)
console.log('整页崩溃后（默认在记录页）:', JSON.stringify(await state()))
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(700)
console.log('点「我的」之后:', JSON.stringify(await state()))
const shot2 = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(`${OUT}/boundary-page.png`, Buffer.from(shot2.data, 'base64'))
await evaluate(`document.querySelectorAll('.tab')[0].click()`)
await sleep(600)
console.log('再切回记录页:', JSON.stringify(await evaluate(`({ editor: !!document.querySelector('.editor') })`)))

ws.close()
