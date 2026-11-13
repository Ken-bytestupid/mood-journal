// 启动耗时对比：有 Service Worker（缓存优先） vs 绕过 SW（相当于每次都走网络）
const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5181/'

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

const measure = async (label) => {
  const started = Date.now()
  await send('Page.reload', { ignoreCache: false })
  // 等首屏有内容（#root 里出现 .page）
  for (let i = 0; i < 200; i += 1) {
    const painted = await evaluate(`!!document.querySelector('#root .page')`)
    if (painted) break
    await sleep(50)
  }
  const elapsed = Date.now() - started
  const paint = await evaluate(`(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    const nav = performance.getEntriesByType('navigation')[0]
    return {
      fcp: fcp ? Math.round(fcp.startTime) : null,
      domInteractive: nav ? Math.round(nav.domInteractive) : null,
      domComplete: nav ? Math.round(nav.domComplete) : null,
    }
  })()`)
  console.log(`${label}: 首屏出现 ${elapsed}ms | FCP ${paint.fcp}ms | DOMInteractive ${paint.domInteractive}ms`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

// 第一次正常加载，让 SW 安装并缓存
await send('Page.navigate', { url: URL_APP })
await sleep(3000)
await evaluate(`navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true)`)
await sleep(1500)
console.log('Service Worker:', await evaluate(`navigator.serviceWorker.controller ? '已接管' : '未接管'`))

// 模拟手机弱网：400ms 延迟、500kbps 下行
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 400,
  downloadThroughput: (500 * 1024) / 8,
  uploadThroughput: (200 * 1024) / 8,
})

await measure('弱网 + SW 缓存优先')
await measure('弱网 + SW 缓存优先（第二次）')

// 绕过 SW，相当于旧版「导航走网络优先」
await send('Network.setBypassServiceWorker', { bypass: true })
await measure('弱网 + 绕过 SW（旧行为）')

ws.close()
