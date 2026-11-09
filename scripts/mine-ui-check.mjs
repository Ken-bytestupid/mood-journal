// 「我的」改版自检：副标题换成品牌语、通用入口折叠存储/备份。
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
const errors = []
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
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

const shot = async (name) => {
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
await sleep(2200)

await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(900)

const top = await evaluate(`(() => ({
  brand: document.querySelector('.page-brand')?.textContent ?? null,
  oldSubtitle: document.querySelector('.page-sub')?.textContent ?? null,
  storageCardInPage: !!document.querySelector('.page.mine > .storage-card'),
  bottomRows: [...document.querySelectorAll('.page.mine > .data-card .data-row')].map((r) => r.innerText.replace(/\\s+/g, ' ')),
  stats: [...document.querySelectorAll('.stat')].map((s) => s.innerText.replace(/\\s+/g, ' ')),
}))()`)
console.log('top:', JSON.stringify(top, null, 2))
await shot('mine-clean')

await evaluate(`document.querySelector('.page.mine > .data-card .data-row').click()`)
await sleep(700)

const sheet = await evaluate(`(() => {
  const panel = document.querySelector('.sheet-root[data-open="true"] .sheet-panel')
  if (!panel) return { open: false }
  return {
    open: true,
    title: panel.querySelector('.sheet-title')?.textContent ?? null,
    rows: [...panel.querySelectorAll('.storage-row')].map((r) => r.innerText.replace(/\\s+/g, ' ')),
    actions: [...panel.querySelectorAll('.data-row')].map((r) => r.innerText.replace(/\\s+/g, ' ')),
  }
})()`)
console.log('sheet:', JSON.stringify(sheet, null, 2))
await shot('mine-general')

console.log('console errors:', errors.length ? errors.slice(0, 3) : 'none')
ws.close()
