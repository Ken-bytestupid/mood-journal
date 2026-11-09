// 找未被使用的 CSS 类名：把 styles.css 里的 .class 与 src 下 tsx/ts 里出现的字符串比对。
import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'D:/Desktop/dsh工作区/mood-journal/src'

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const files = walk(SRC)
const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
const code = files
  .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

// 只看选择器部分（去掉声明块），避免把属性值里的 0.5 之类当成类名
const selectors = css.replace(/\{[^{}]*\}/g, '{}')
const classes = new Set([...selectors.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))

const unused = [...classes].filter((name) => !new RegExp(`\\b${name}\\b`).test(code)).sort()
console.log(`CSS 类名总数: ${classes.size}`)
console.log(`疑似未使用 (${unused.length}):`)
for (const name of unused) console.log('  .' + name)
