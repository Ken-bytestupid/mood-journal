// 「记忆」演示自检：转盘方向 / 数字正立 / 按钮确认选月 / 周环 / 年份进位。
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
    const active = document.querySelector('.memory-item[data-active="true"]')
    return {
      stage: root.dataset.stage,
      year: document.querySelector('.memory-year')?.textContent,
      caption: document.querySelector('.memory-caption')?.innerText.replace(/\\n/g, ' / '),
      active: active?.textContent ?? null,
      // 正立的判定：元素的最终旋转应接近 0
      activeRotation: active ? (() => {
        const m = new DOMMatrixReadOnly(getComputedStyle(active).transform)
        return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI)
      })() : null,
      confirm: !!document.querySelector('.memory-confirm'),
      back: !!document.querySelector('.memory-back'),
    }
  })()`)

/** 绕屏幕中心沿圆弧拖动 degrees 度（负 = 逆时针） */
const dragArc = async (degrees, radius = 180) => {
  const cx = 195
  const cy = 422
  const point = (deg) => {
    const rad = (deg * Math.PI) / 180
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) }
  }
  const start = point(-90)
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...start, radiusX: 6, radiusY: 6, force: 1, id: 1 }],
  })
  const steps = 20
  for (let i = 1; i <= steps; i += 1) {
    const p = point(-90 + (degrees * i) / steps)
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...p, radiusX: 6, radiusY: 6, force: 1, id: 1 }],
    })
    await sleep(16)
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Page.navigate', { url: URL_APP })
await sleep(2500)

await evaluate(`document.querySelectorAll('.tab')[1].click()`)
await sleep(700)
await evaluate(`[...document.querySelectorAll('.tile')].find((b) => b.textContent.includes('记忆')).click()`)
await sleep(900)
console.log('打开:', JSON.stringify(await state()))
await shot('mem-month')

// 逆时针拖 110°（灵敏度 0.55 → 约 60°，也就是两格）
await dragArc(-110)
await sleep(700)
console.log('逆时针拖 110°:', JSON.stringify(await state()))
await shot('mem-rotated')

// 用按钮确认选月
await evaluate(`document.querySelector('.memory-confirm').click()`)
await sleep(1500)
console.log('点「选这个月」:', JSON.stringify(await state()))
await shot('mem-week')

// 周环上转一下
await dragArc(-40)
await sleep(700)
console.log('转周环:', JSON.stringify(await state()))

// 回退
await evaluate(`document.querySelector('.memory-back').click()`)
await sleep(1500)
console.log('回退:', JSON.stringify(await state()))

// 逆时针拖 790°（灵敏度后约 434° ≈ 14 格）验证年份进位
await dragArc(-790)
await sleep(700)
console.log('大幅逆时针:', JSON.stringify(await state()))

ws.close()
