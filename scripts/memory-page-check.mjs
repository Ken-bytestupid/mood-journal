// 周环翻页 + 触摸隔离自检：点分区/左右滑动翻周、中间退出、详情里滑动不带动周环。
import { writeFileSync } from 'node:fs'

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
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'))
}
const state = () =>
  evaluate(`(() => {
    const root = document.querySelector('.memory')
    if (!root) return { open: false }
    return {
      stage: root.dataset.stage,
      caption: document.querySelector('.memory-caption')?.innerText.replace(/\\n/g, ' / ') ?? null,
      week: document.querySelector('.memory-ring.small .memory-item[data-active="true"]')?.textContent ?? null,
      reader: document.querySelector('.reader-counter')?.textContent?.trim() ?? null,
    }
  })()`)

const touch = async (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points })
const point = (x, y) => ({ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 })

const tap = async (x, y) => {
  await touch('touchStart', [point(x, y)])
  await sleep(60)
  await touch('touchEnd', [])
  await sleep(600)
}

const swipe = async (fromX, toX, y) => {
  await touch('touchStart', [point(fromX, y)])
  const steps = 12
  for (let i = 1; i <= steps; i += 1) {
    await touch('touchMove', [point(fromX + ((toX - fromX) * i) / steps, y)])
    await sleep(16)
  }
  await touch('touchEnd', [])
  await sleep(600)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.navigate', { url: URL_APP })
await sleep(2500)

// 清库并写入三条今天的记录
await evaluate(`new Promise((resolve) => {
  const req = indexedDB.deleteDatabase('mood-journal')
  req.onsuccess = () => resolve(true)
  req.onerror = () => resolve(false)
  req.onblocked = () => resolve(false)
})`)
await send('Page.reload')
await sleep(2200)
await evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('mood-journal', 1)
    req.onupgradeneeded = () => {
      const database = req.result
      if (!database.objectStoreNames.contains('entries')) {
        const store = database.createObjectStore('entries', { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { recursive: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const now = Date.now()
  const rows = [
    { id: 'p1', title: '午饭', text: '面很好吃', createdAt: now - 3600_000 },
    { id: 'p2', title: '散步', text: '江边风很大', createdAt: now - 7200_000 },
    { id: 'p3', title: '', text: '下午有点困', createdAt: now - 10800_000 },
  ].map((row) => ({ ...row, polarity: 'plain', emotionId: null, photos: [], updatedAt: row.createdAt }))
  await new Promise((resolve, reject) => {
    const tx = db.transaction('entries', 'readwrite')
    for (const row of rows) tx.objectStore('entries').put(row)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => reject(tx.error)
  })
})()`)
await send('Page.reload')
await sleep(2500)
await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(600)
await evaluate(`[...document.querySelectorAll('.tile')].find((b) => b.textContent.includes('记忆')).click()`)
await sleep(900)
await evaluate(`document.querySelector('.memory-confirm').click()`)
await sleep(1600)
console.log('进入周环:', JSON.stringify(await state()))
await shot('week-page-start')

// 右三分之一点击 = 下一周
await tap(330, 320)
console.log('点右侧（期望下一周，数字变大）:', JSON.stringify(await state()))

// 左滑 = 下一周
await swipe(320, 180, 320)
console.log('左滑（期望再下一周）:', JSON.stringify(await state()))

// 右滑 = 上一周
await swipe(180, 320, 320)
console.log('右滑（期望回上一周）:', JSON.stringify(await state()))

// 中间点击 = 退出到月份
await tap(195, 320)
await sleep(1200)
console.log('点中间（期望回月份环）:', JSON.stringify(await state()))

// 回到周环 → 列表 → 打开详情，验证滑动只影响详情
await evaluate(`document.querySelector('.memory-confirm').click()`)
await sleep(1600)
const weekBefore = (await state()).week
await evaluate(`document.querySelector('.memory-confirm').click()`)
await sleep(1600)
await evaluate(`document.querySelector('.memory-list .entry')?.click()`)
await sleep(900)
console.log('打开详情:', JSON.stringify(await state()))
await swipe(320, 170, 400)
console.log('详情里左滑（期望翻到 2/3，周不变）:', JSON.stringify(await state()), '周前后:', weekBefore)

ws.close()
