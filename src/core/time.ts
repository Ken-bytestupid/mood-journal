/** 时间展示与分组。所有展示都以浏览器本地时区为准。 */

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const DAY_MS = 86_400_000

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 19:53 —— 工具栏与记录内显示的分钟级时间。 */
export function clockText(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 10月31日 */
export function dateText(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 周五 */
export function weekText(ts: number): string {
  return WEEK[new Date(ts).getDay()] ?? ''
}

/** 2026-10-31 —— 用于分组 key。 */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 10月31日 周五 */
function dayTitle(ts: number): string {
  return `${dateText(ts)} ${weekText(ts)}`
}

/** 本周从周一开始。 */
export function startOfWeek(now = Date.now()): number {
  const base = new Date(startOfDay(now))
  const offset = (base.getDay() + 6) % 7
  base.setDate(base.getDate() - offset)
  return base.getTime()
}

const WEEKDAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/** 星期五 —— 「本周」列表里的分组标题 */
export function weekDayLabel(ts: number): string {
  return WEEKDAY_NAMES[new Date(ts).getDay()] ?? ''
}

/** 10月31日 周五 19:53 */
export function fullText(ts: number): string {
  return `${dayTitle(ts)} ${clockText(ts)}`
}

export interface DayGroup<T> {
  key: string
  /** 当天第一笔记录的时间，用来排序和显示日期 */
  ts: number
  items: T[]
}

/** 按天倒序分组，组内也按时间倒序。 */
export function groupByDay<T extends { createdAt: number }>(items: T[]): DayGroup<T>[] {
  const map = new Map<string, DayGroup<T>>()
  for (const item of items) {
    const key = dayKey(item.createdAt)
    const group = map.get(key)
    if (group) group.items.push(item)
    else map.set(key, { key, ts: item.createdAt, items: [item] })
  }
  return [...map.values()].sort((a, b) => b.ts - a.ts)
}

/** 连续记录天数：以今天（今天没写则从昨天）为起点往前数。 */
export function streakDays(timestamps: number[], now = Date.now()): number {
  if (timestamps.length === 0) return 0
  const days = new Set(timestamps.map(dayKey))
  let cursor = startOfDay(now)
  if (!days.has(dayKey(cursor))) {
    cursor -= DAY_MS
    if (!days.has(dayKey(cursor))) return 0
  }
  let streak = 0
  while (days.has(dayKey(cursor))) {
    streak += 1
    cursor -= DAY_MS
  }
  return streak
}
