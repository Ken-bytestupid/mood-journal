// 深色模式、emoji 面板、保存按钮反馈、心情配色检查。
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
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })

await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
await send('Page.navigate', { url: URL_APP })
await sleep(1600)
await shot('08-record-dark')

await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
await sleep(400)

await evaluate(`document.querySelector('.emoji-btn').click()`)
await sleep(400)
await shot('09-emoji-popover')
await evaluate(`document.querySelector('.emoji-pop button').click()`)
await sleep(300)

await evaluate(`document.querySelector('.mood-cell').click()`)
await sleep(350)
await evaluate(`document.querySelectorAll('.mood-chip')[4].click()`)
await sleep(350)
const colors = await evaluate(`(() => {
  const cell = document.querySelector('.mood-cell')
  return {
    polarity: cell.getAttribute('data-polarity'),
    color: getComputedStyle(cell).color,
    hint: cell.querySelector('.mood-cell-hint').textContent,
  }
})()`)
console.log('mood cell', JSON.stringify(colors))

await evaluate(`(() => {
  const el = document.querySelector('.editor')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, '测试一下保存按钮的反馈')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(250)
await evaluate(`document.querySelector('.save-btn').click()`)
await sleep(350)
await shot('10-saved-flash')

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
  return { count: all.length, moods: all.map((e) => e.moodId) }
})()`)
console.log('idb', JSON.stringify(state))

ws.close()
console.log('done')
