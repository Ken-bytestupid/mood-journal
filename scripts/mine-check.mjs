// 我的页：存储状态卡 + 文字镜像自检。
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5180/'
const OUT = process.argv[4] ?? 'D:/Desktop/dsh工作区/_shots/storage.png'

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
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: URL_APP })
await sleep(2000)

// 写一条记录，触发主库 + 镜像
await evaluate(`(() => {
  const el = document.querySelector('.editor')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '测试存储镜像的写入')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(200)
await evaluate(`document.querySelector('.save-btn').click()`)
await sleep(900)

await evaluate(`[...document.querySelectorAll('.tab')].at(-1).click()`)
await sleep(800)
await send('Page.captureScreenshot', { format: 'png' }).then(({ data }) => {
  writeFileSync(OUT, Buffer.from(data, 'base64'))
  console.log('shot', OUT)
})

const state = await evaluate(`(() => {
  const raw = localStorage.getItem('mood-journal:mirror:v1')
  const mirror = raw ? JSON.parse(raw) : null
  const rowText = [...document.querySelectorAll('.storage-row')].map((row) => row.innerText.replace(/\\s+/g, ' '))
  return {
    mirrorRecords: mirror ? mirror.records.length : 0,
    mirrorSample: mirror && mirror.records[0] ? mirror.records[0].text : null,
    storageRows: rowText,
    badge: document.querySelector('.storage-badge')?.textContent ?? null,
    note: document.querySelector('.storage-note')?.textContent ?? null,
  }
})()`)
console.log(JSON.stringify(state, null, 2))

ws.close()
