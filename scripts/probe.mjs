// 只求值一段表达式，用于排查样式/布局。
const PORT = Number(process.argv[2] ?? 9229)
const EXPR = process.argv[3] ?? '1+1'

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

const result = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true })
if (result.exceptionDetails) console.log('EXCEPTION', JSON.stringify(result.exceptionDetails))
else console.log(JSON.stringify(result.result.value, null, 2))

ws.close()
