// 端到端自检：选心情 → 输入文字/标题 → 加一张图 → 保存 → 我的列表 → 详情。
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
      /* 等浏览器起来 */
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
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: URL_APP })
await sleep(1800)

// 1) 选心情
await evaluate(`document.querySelector('.mood-cell').click()`)
await sleep(350)
await evaluate(`document.querySelectorAll('.mood-chip')[0].click()`)
await sleep(350)

// 2) 写正文与标题（受控输入要走原生 setter + input 事件）
await evaluate(`(() => {
  const setValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  setValue(document.querySelector('.editor'), '早上被闹钟吵醒，赖了十分钟床。\\n出门时雨停了，路上闻到桂花味。\\n下午把拖了两天的方案写完了，心里松了一块。')
  setValue(document.querySelector('.title-input'), '今天还可以')
  return true
})()`)
await sleep(300)

// 3) 造一张图塞进 file input，走真实的压缩 + 缩略图路径
await evaluate(`(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 480
  const ctx = canvas.getContext('2d')
  const grd = ctx.createLinearGradient(0, 0, 640, 480)
  grd.addColorStop(0, '#dcc9a8')
  grd.addColorStop(1, '#8fa88b')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, 640, 480)
  ctx.fillStyle = 'rgba(255,255,255,.85)'
  ctx.beginPath()
  ctx.arc(470, 130, 60, 0, Math.PI * 2)
  ctx.fill()
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'))
  const file = new File([blob], 'photo.png', { type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(file)
  const input = document.querySelector('input[type=file]')
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`)
await sleep(700)
await shot('04-composing')

// 4) 保存
await evaluate(`document.querySelector('.save-btn').click()`)
await sleep(800)
await shot('05-saved-toast')

// 5) 我的列表
await evaluate(`[...document.querySelectorAll('.tab')].at(-1).click()`)
await sleep(700)
await shot('06-mine-list')

// 6) 详情
await evaluate(`document.querySelector('.entry')?.click()`)
await sleep(600)
await shot('07-detail')

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
  const first = all[0]
  return {
    count: all.length,
    first: first ? { title: first.title, moodId: first.moodId, photos: first.photos.length, textLength: first.text.length, createdAt: first.createdAt } : null,
  }
})()`)
console.log('idb state', JSON.stringify(state))

ws.close()
console.log('done')
