// 用 CDP 驱动无头 Edge：测量布局、截图、模拟点击。仅开发自检用。
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5180/'
const OUT = process.argv[4] ?? 'D:/Desktop/dsh工作区/_shots'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 还没起来 */
    }
    await sleep(250)
  }
  throw new Error('找不到可调试的页面')
}

const page = await target()
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

function send(method, params = {}) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
  console.log('shot', name)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
})
await send('Page.navigate', { url: URL_APP })
await sleep(1800)

const measure = await evaluate(`(() => {
  const doc = document.documentElement
  const app = document.querySelector('.app')
  const card = document.querySelector('.card')
  const topbar = document.querySelector('.topbar')
  const rect = (el) => el ? (({ x, y, width, height }) => ({ x, y, width, height }))(el.getBoundingClientRect()) : null
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth: doc.clientWidth,
    scrollWidth: doc.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    app: rect(app),
    topbar: rect(topbar),
    card: rect(card),
    dpr: window.devicePixelRatio,
  }
})()`)
console.log(JSON.stringify(measure, null, 2))

await shot('01-record')

// 心情选择弹层
await evaluate(`document.querySelector('.mood-cell').click()`)
await sleep(500)
await shot('02-mood-sheet')
await evaluate(`document.querySelector('.sheet-backdrop').click()`)
await sleep(400)

// 我的页
await evaluate(`[...document.querySelectorAll('.tab')].at(-1).click()`)
await sleep(500)
await shot('03-mine-empty')

ws.close()
console.log('done')
