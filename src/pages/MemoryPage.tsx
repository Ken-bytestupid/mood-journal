import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isoWeek, isoWeekKey } from '../core/time'
import type { Entry } from '../core/types'

interface MemoryPageProps {
  entries: Entry[]
  onClose: () => void
}

const MONTH_STEP = 360 / 12
/** 手指转动多少度，圆盘才转多少度（越小越「钝」，越容易停在想要的格子上） */
const SENSITIVITY = 0.55

type Stage = 'month' | 'week'
type Phase = 'idle' | 'dragging' | 'busy'
type Fade = '' | 'out' | 'in'

interface WeekItem {
  key: string
  week: number
  enabled: boolean
}

const mod = (value: number, n: number) => ((value % n) + n) % n

/** 最短角差，处理 ±180° 跳变 */
function angleDelta(current: number, previous: number): number {
  let delta = current - previous
  while (delta > 180) delta -= 360
  while (delta < -180) delta += 360
  return delta
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t)
const easeIn = (t: number) => t * t

/**
 * 「记忆」最小演示：月份环 → 周环，中间用一次快门闭合/打开做转场，
 * 合上时大环模糊淡出，重新打开时小环从模糊里浮现。
 * 目前只做到「选到周」，记录列表和详情后续复用现有组件接入。
 */
export function MemoryPage({ entries, onClose }: MemoryPageProps) {
  const baseYear = useMemo(() => new Date().getFullYear(), [])
  const [stage, setStage] = useState<Stage>('month')
  const [phase, setPhase] = useState<Phase>('idle')
  const [fade, setFade] = useState<Fade>('')
  const [spin, setSpin] = useState(0)
  const [weekSpin, setWeekSpin] = useState(0)
  const [shutter, setShutter] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef({ active: false, lastAngle: 0, moved: 0 })
  const shutterRef = useRef(0)
  const phaseRef = useRef<Phase>('idle')

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  // 每个月 / 每周的记录数（用来置灰没有记录的选项）
  const { byMonth, byWeek, demoMode } = useMemo(() => {
    const months = new Map<number, number>()
    const weeks = new Map<string, number>()
    for (const entry of entries) {
      const date = new Date(entry.createdAt)
      months.set(date.getMonth(), (months.get(date.getMonth()) ?? 0) + 1)
      const key = isoWeekKey(entry.createdAt)
      weeks.set(key, (weeks.get(key) ?? 0) + 1)
    }
    return { byMonth: months, byWeek: weeks, demoMode: entries.length === 0 }
  }, [entries])

  // 月份环当前指向：数字按草图顺时针排，所以「往后走」是逆时针拖动
  const monthSlots = Math.round(-spin / MONTH_STEP)
  const monthIndex = mod(monthSlots, 12)
  const year = baseYear + Math.floor(monthSlots / 12)

  // 选中月份里包含的所有 ISO 周（跨月的那一周两边都会出现）
  const weeks = useMemo<WeekItem[]>(() => {
    const list: WeekItem[] = []
    const seen = new Set<string>()
    const days = new Date(year, monthIndex + 1, 0).getDate()
    for (let day = 1; day <= days; day += 1) {
      const ts = new Date(year, monthIndex, day).getTime()
      const { week } = isoWeek(ts)
      const key = isoWeekKey(ts)
      if (seen.has(key)) continue
      seen.add(key)
      list.push({ key, week, enabled: demoMode || byWeek.has(key) })
    }
    return list
  }, [year, monthIndex, byWeek, demoMode])

  const weekStep = weeks.length > 0 ? 360 / weeks.length : 360
  const weekSlots = Math.round(-weekSpin / weekStep)
  const weekIndex = weeks.length > 0 ? mod(weekSlots, weeks.length) : 0

  const monthEnabled = useCallback(
    (index: number) => demoMode || byMonth.has(index),
    [byMonth, demoMode],
  )

  /** 吸附：落在没有记录的格子上时，找最近的可用格子 */
  const snapSlot = useCallback((slots: number, count: number, enabled: (index: number) => boolean) => {
    if (count === 0) return slots
    if (enabled(mod(slots, count))) return slots
    for (let step = 1; step <= count; step += 1) {
      if (enabled(mod(slots + step, count))) return slots + step
      if (enabled(mod(slots - step, count))) return slots - step
    }
    return slots
  }, [])

  const animateShutter = useCallback((to: number, duration: number) => {
    return new Promise<void>((resolve) => {
      const from = shutterRef.current
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        const eased = to === 1 ? easeIn(t) : easeOut(t)
        const value = from + (to - from) * eased
        shutterRef.current = value
        setShutter(value)
        if (t < 1) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
  }, [])

  /** 快门闭合 → 换场 → 打开（换场时大环模糊淡出，小环从模糊里浮现） */
  const transition = useCallback(
    async (apply: () => void) => {
      if (phaseRef.current === 'busy') return
      setPhase('busy')
      setFade('out')
      await animateShutter(1, 260)
      apply()
      setFade('in')
      await new Promise((resolve) => window.setTimeout(resolve, 120))
      setFade('')
      void animateShutter(0, 320)
      window.setTimeout(() => setPhase('idle'), 320)
    },
    [animateShutter],
  )

  /** 松手只做吸附；真正「选中」靠下面的按钮 */
  const release = useCallback(() => {
    if (!drag.current.active) return
    drag.current.active = false
    drag.current.moved = 0
    if (phaseRef.current === 'busy') return

    if (stage === 'month') {
      const target = snapSlot(monthSlots, 12, monthEnabled)
      setSpin(-target * MONTH_STEP)
      return
    }

    const target = snapSlot(weekSlots, weeks.length, (index) => weeks[index]?.enabled ?? false)
    setWeekSpin(-target * weekStep)
  }, [monthEnabled, monthSlots, snapSlot, stage, weekSlots, weekStep, weeks])

  /** 点「选这个月」才换场到周环 */
  const confirmMonth = () => {
    if (stage !== 'month') return
    void transition(() => {
      setStage('week')
      setWeekSpin(0)
    })
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (phase === 'busy') return
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    drag.current.active = true
    drag.current.moved = 0
    drag.current.lastAngle = (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI
    setPhase('dragging')
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active || phaseRef.current === 'busy') return
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const angle = (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI
    const delta = angleDelta(angle, drag.current.lastAngle)
    drag.current.lastAngle = angle
    drag.current.moved += delta
    const applied = delta * SENSITIVITY
    if (stage === 'month') setSpin((value) => value + applied)
    else setWeekSpin((value) => value + applied)
  }

  const onPointerUp = () => release()

  const goBack = () => {
    if (stage !== 'week') return
    void transition(() => setStage('month'))
  }

  const monthName = `${year} 年 ${monthIndex + 1} 月`
  const week = weeks[weekIndex]

  return (
    <div
      className="memory"
      ref={rootRef}
      data-stage={stage}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <button type="button" className="memory-close" aria-label="关闭" onClick={onClose}>
        ×
      </button>

      <div className="memory-year">{year}</div>

      <div className="memory-stage">
        <div className="memory-pointer" aria-hidden="true" />
        {stage === 'month' ? (
          <div className="memory-ring" data-fade={fade} data-dragging={phase === 'dragging' ? 'true' : 'false'}>
            <div className="memory-ring-track" style={{ transform: `rotate(${spin}deg)` }}>
              {Array.from({ length: 12 }, (_, index) => {
                // 数字按草图顺时针排（1 在顶、2 在右上）；文字再反向转回来保持正立
                const a = index * MONTH_STEP
                const upright = -(spin + a)
                return (
                  <span
                    key={index}
                    className="memory-item"
                    data-active={index === monthIndex ? 'true' : 'false'}
                    data-disabled={monthEnabled(index) ? 'false' : 'true'}
                    style={{ transform: `rotate(${a}deg) translateY(-118px) rotate(${upright}deg)` }}
                  >
                    {index + 1}
                  </span>
                )
              })}
            </div>
            <div className="memory-hole" aria-hidden="true" />
          </div>
        ) : (
          <div className="memory-ring small" data-fade={fade} data-dragging={phase === 'dragging' ? 'true' : 'false'}>
            <div className="memory-ring-track" style={{ transform: `rotate(${weekSpin}deg)` }}>
              {weeks.map((item, index) => {
                const a = index * weekStep
                const upright = -(weekSpin + a)
                return (
                  <span
                    key={item.key}
                    className="memory-item"
                    data-active={index === weekIndex ? 'true' : 'false'}
                    data-disabled={item.enabled ? 'false' : 'true'}
                    style={{ transform: `rotate(${a}deg) translateY(-80px) rotate(${upright}deg)` }}
                  >
                    {item.week}
                  </span>
                )
              })}
            </div>
            <div className="memory-hole" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="memory-caption">
        {stage === 'month' ? (
          <>
            <strong>{monthName}</strong>
            <span>{demoMode ? '演示模式：全部可选' : `${byMonth.get(monthIndex) ?? 0} 条记录`}</span>
          </>
        ) : (
          <>
            <strong>
              {monthName} · 第 {week?.week ?? '—'} 周
            </strong>
            <span>{demoMode ? '演示模式：全部可选' : `${week ? (byWeek.get(week.key) ?? 0) : 0} 条记录`}</span>
          </>
        )}
      </div>

      {stage === 'month' ? (
        <button type="button" className="memory-confirm" onClick={confirmMonth}>
          选这个月
        </button>
      ) : (
        <button type="button" className="memory-back" onClick={goBack} aria-label="回到月份">
          ↩ 换个月份
        </button>
      )}

      <p className="memory-hint">
        {stage === 'month' ? '在屏幕上滑动旋转 · 点「选这个月」确认' : '滑动挑选周 · 松开吸附'}
      </p>

      <div className="memory-shutter" aria-hidden="true">
        <div
          className="memory-veil"
          style={{
            ['--hole' as string]: `${Math.round((1 - shutter) * 300)}px`,
            opacity: Math.min(1, shutter * 2.2),
          }}
        />
        <div
          className="memory-blades"
          style={{
            opacity: Math.min(1, Math.max(0, (shutter - 0.45) * 2.4)),
            transform: `scale(${0.2 + shutter * 0.95}) rotate(${shutter * 30}deg)`,
          }}
        >
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <span key={angle} style={{ transform: `rotate(${angle + shutter * 34}deg)` }} />
          ))}
        </div>
      </div>
    </div>
  )
}
