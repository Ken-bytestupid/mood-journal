// 离线自检：首屏加载 → 切断网络 → 重新加载，看应用是否还在。
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5181/'
const OUT = process.argv[4] ?? 'D:/Desktop/dsh工作区/_shots/offline.png'

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
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: false })
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

// 1) 首次在线加载，等 Service Worker 激活
await send('Page.navigate', { url: URL_APP })
await sleep(2000)
const swState = await evaluate(`(async () => {
  const reg = await navigator.serviceWorker.ready
  return { scope: reg.scope, state: reg.active ? reg.active.state : null, controlled: !!navigator.serviceWorker.controller }
})()`)
console.log('service worker:', JSON.stringify(swState))

const cached = await evaluate(`(async () => {
  const names = await caches.keys()
  const out = {}
  for (const name of names) {
    const cache = await caches.open(name)
    out[name] = (await cache.keys()).map((req) => new URL(req.url).pathname)
  }
  return out
})()`)
console.log('cache contents:', JSON.stringify(cached, null, 2))

// 2) 断网，重新加载
await send('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
})
await sleep(300)
await send('Page.reload', { ignoreCache: false })
await sleep(2500)

const afterOffline = await evaluate(`(() => ({
  editor: !!document.querySelector('.editor'),
  tabbar: !!document.querySelector('.tabbar'),
  moodCell: !!document.querySelector('.mood-cell'),
  text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 80),
}))()`)
console.log('after offline reload:', JSON.stringify(afterOffline))

const { data } = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(OUT, Buffer.from(data, 'base64'))
console.log('shot saved:', OUT)

// 3) 恢复网络
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
})

ws.close()
console.log(afterOffline.editor && afterOffline.tabbar ? 'PASS 离线可用' : 'FAIL 离线打不开')
