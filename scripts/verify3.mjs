// 改版自检：三选一心情、此刻的心情弹层、旧数据升级、列表与详情。
import { writeFileSync } from 'node:fs'

const PORT = Number(process.argv[2] ?? 9229)
const URL_APP = process.argv[3] ?? 'http://127.0.0.1:5180/'
const OUT = process.argv[4] ?? 'D:/Desktop/dsh工作区/_shots'

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
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: URL_APP })
await sleep(1800)

await shot('11-record-default')

// 心情三选一
await evaluate(`document.querySelector('.mood-cell').click()`)
await sleep(450)
await shot('12-polarity-sheet')
await evaluate(`document.querySelectorAll('.polarity-option')[2].click()`)
await sleep(400)

// 此刻的心情
await evaluate(`document.querySelector('.mood-pill').click()`)
await sleep(450)
await shot('13-emotion-sheet')
await evaluate(`document.querySelectorAll('.mood-chip')[5].click()`)
await sleep(400)

// 写点东西并保存（验证 polarity 跟着情绪走）
await evaluate(`(() => {
  const setValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  setValue(document.querySelector('.editor'), '临时抱佛脚改完了方案，心里有点发毛。')
  setValue(document.querySelector('.title-input'), '焦虑的晚上')
  return true
})()`)
await sleep(300)
await shot('14-record-emotion')
await evaluate(`document.querySelector('.save-btn').click()`)
await sleep(800)

// 列表 + 详情
await evaluate(`[...document.querySelectorAll('.tab')].at(-1).click()`)
await sleep(700)
await shot('15-mine-list')
await evaluate(`document.querySelector('.entry')?.click()`)
await sleep(600)
await shot('16-detail')

const state = await evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('mood-journal', 1)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const all = await new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readonly')
    const req = tx.objectStore('entries').getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return all.map((e) => ({ polarity: e.polarity, emotionId: e.emotionId, moodId: e.moodId, title: e.title }))
})()`)
console.log('stored', JSON.stringify(state))

ws.close()
console.log('done')
