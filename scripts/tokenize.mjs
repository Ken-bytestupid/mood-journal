// 把 styles.css 里散落的颜色 / 字号 / 圆角 / 间距收进 CSS 变量。
// 默认只报告；--write 才写入。
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = 'D:/Desktop/dsh工作区/mood-journal/src/styles.css'
const WRITE = process.argv.includes('--write')

let css = readFileSync(FILE, 'utf8')

const COLOR_MAP = [
  ['rgba(40, 32, 22, 0.1)', 'var(--shadow-app)'],
  ['rgba(0, 0, 0, 0.55)', 'var(--badge-bg)'],
  ['rgba(18, 16, 14, 0.42)', 'var(--scrim-soft)'],
  ['rgba(18, 16, 14, 0.55)', 'var(--scrim)'],
  ['rgba(12, 11, 10, 0.45)', 'var(--scrim-dialog)'],
  ['rgba(10, 9, 8, 0.92)', 'var(--scrim-strong)'],
  ['rgba(255, 255, 255, 0.14)', 'var(--glass)'],
  ['rgba(0, 0, 0, 0.2)', 'var(--shadow-sheet)'],
  ['rgba(0, 0, 0, 0.28)', 'var(--shadow-dialog)'],
  ['rgba(0, 0, 0, 0.32)', 'var(--shadow-reader)'],
  ['#f7f4ee', 'var(--on-scrim)'],
  ['#f4f1ea', 'var(--on-scrim-soft)'],
  ['#fff', 'var(--on-solid)'],
]

const TEXT_SIZES = ['10.5', '11', '11.5', '12', '12.5', '13', '13.5', '14', '14.5', '15', '15.5', '16', '16.5', '17', '19', '20', '21', '22']
const RADII = ['8', '9', '12', '14', '16', '18', '20', '22']
// 只把 4px 以上、偶数网格上的间距收进 token（1/2/3/5/7/9/11 这类微调保留字面量）
const SPACES = ['4', '6', '8', '10', '12', '14', '16', '18', '20', '22', '24', '26', '30']

const textName = (v) => `--text-${v.replace('.', '-')}`
const spaceName = (v) => `--space-${v}`

// :root 里的变量定义区域不参与替换
const rootMatch = css.match(/:root\s*\{[\s\S]*?\}/)
const rootBlock = rootMatch ? rootMatch[0] : ''
const body = css.replace(rootBlock, (m) => `@@ROOT@@${' '.repeat(m.length - 8)}`)

let out = body

for (const [literal, token] of COLOR_MAP) {
  out = out.split(literal).join(token)
}

// 字号
for (const size of TEXT_SIZES) {
  const re = new RegExp(`(font-size:\\s*)${size.replace('.', '\\.')}px`, 'g')
  out = out.replace(re, `$1var(${textName(size)})`)
}

// 圆角（单值或简写里的每个 px）
for (const r of RADII) {
  out = out.replace(new RegExp(`border-radius:\\s*${r}px`, 'g'), `border-radius: var(--radius-${r})`)
  out = out.replace(new RegExp(`(border-radius:[^;]*?)\\b${r}px\\b`, 'g'), `$1var(--radius-${r})`)
}
out = out.replace(/border-radius:\s*999px/g, 'border-radius: var(--radius-pill)')

// 间距：padding / margin / gap 及其长写
const SPACING_PROPS = 'padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left|gap|row-gap|column-gap'
for (const s of SPACES) {
  const token = `var(${spaceName(s)})`
  const re = new RegExp(`((?:${SPACING_PROPS}):[^;]*?)\\b${s}px\\b`, 'g')
  out = out.replace(re, `$1${token}`)
}

// 字体栈
out = out.replace(
  /font-family:\s*system-ui, -apple-system, 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei', sans-serif;/g,
  'font-family: var(--font-ui);',
)

// 还原 :root
out = out.replace(/@@ROOT@@\s*/, rootBlock)

const changed = (a, b) => a.split('\n').filter((line, i) => line !== b.split('\n')[i]).length
console.log(`颜色替换: ${COLOR_MAP.length} 类`)
console.log(`字号 token: ${TEXT_SIZES.length} 个；圆角: ${RADII.length + 1} 个；间距: ${SPACES.length} 个`)
console.log(`预计改动行数: ${changed(css, out)}`)

if (!WRITE) {
  console.log('\n（只报告，未写入。加 --write 才会改文件）')
  process.exit(0)
}
writeFileSync(FILE, out, 'utf8')
console.log('已写入', FILE)
