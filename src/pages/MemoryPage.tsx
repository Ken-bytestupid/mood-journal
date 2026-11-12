import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { dateText, groupByDay, isoWeek, isoWeekKey, weekDayLabel } from '../core/time'
import type { Entry } from '../core/types'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { CloseButton } from '../ui/CloseButton'
import { EntryReader } from '../ui/EntryReader'
import { EntryRow } from '../ui/EntryRow'

interface MemoryPageProps {
  entries: Entry[]
  onClose: () => void
  onDelete?: (id: string) => Promise<void>
}

const MONTH_STEP = 360 / 12
/** 手指转动多少度，圆盘才转多少度（越小越「钝」，越容易停在想要的格子上） */
const SENSITIVITY = 0.55

type Stage = 'month' | 'week' | 'list'
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
export function MemoryPage({ entries, onClose, onDelete }: MemoryPageProps) {
  const baseYear = useMemo(() => new Date().getFullYear(), [])
  const [stage, setStage] = useState<Stage>('month')
  const [phase, setPhase] = useState<Phase>('idle')
  const [fade, setFade] = useState<Fade>('')
  // 打开时指针就停在「现在」这个月（月份按逆时针拖动前进，所以初始 spin 取负）
  const [spin, setSpin] = useState(() => -new Date().getMonth() * MONTH_STEP)
  const [weekSpin, setWeekSpin] = useState(0)
  const [shutter, setShutter] = useState(0)
  const [readerIndex, setReaderIndex] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Entry | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | null>(null)

  /** 屏幕中央的短提示，1.6 秒后自动消失 */
  const showNotice = useCallback((message: string) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    setNotice(message)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 1600)
  }, [])

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
  }, [])

  const rootRef = useRef<HTMLDivElement>(null)
  const drag = useRef({ active: false, lastAngle: 0, moved: 0, startX: 0, startY: 0, lastX: 0, lastY: 0 })
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
  const week = weeks[weekIndex]

  // 这一周自己的记录（列表页用）
  const weekEntries = useMemo(() => {
    if (!week) return []
    return entries
      .filter((entry) => isoWeekKey(entry.createdAt) === week.key)
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [entries, week])

  /** 列表按天分组，带星期标题 */
  const weekGroups = useMemo(() => groupByDay(weekEntries), [weekEntries])

  const monthEnabled = useCallback(
    (index: number) => demoMode || byMonth.has(index),
    [byMonth, demoMode],
  )
  const monthHasRecords = monthEnabled(monthIndex)
  const weekHasRecords = week?.enabled ?? false

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

  const goBack = () => {
    if (stage !== 'week') return
    void transition(() => setStage('month'))
  }

  /** 点圆环内左右半边 = 上/下一周（保留点击切换的手感） */
  const stepWeek = useCallback(
    (delta: number) => {
      if (weeks.length === 0) return
      const next = mod(weekIndex + delta, weeks.length)
      setWeekSpin(-next * weekStep)
    },
    [weekIndex, weekStep, weeks.length],
  )

  /** 松手：吸附到最近一格；只点了一下则按「点在环内还是环外」决定行为 */
  const release = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!drag.current.active) return
      const cancelled = event.type === 'pointercancel'
      const x = cancelled ? drag.current.lastX : event.clientX
      const y = cancelled ? drag.current.lastY : event.clientY
      const moved = Math.abs(drag.current.moved)
      const distance = Math.hypot(x - drag.current.startX, y - drag.current.startY)
      drag.current.active = false
      drag.current.moved = 0
      if (phaseRef.current === 'busy') return

      // 先吸附
      if (stage === 'month') setSpin(-Math.round(monthSlots) * MONTH_STEP)
      else setWeekSpin(-Math.round(weekSlots) * weekStep)

      // 拖动过就不算点击
      if (moved > 6 || distance > 10) return

      const ring = rootRef.current?.querySelector('.memory-ring')
      const rect = ring?.getBoundingClientRect()
      const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
      const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
      const radius = rect ? rect.width / 2 : 0
      const outside = Math.hypot(x - cx, y - cy) > radius + 12

      // 点环外空白：上一级
      if (outside) {
        if (stage === 'month') onClose()
        else goBack()
        return
      }

      // 点环内左右半边：上/下一周
      if (stage === 'week') stepWeek(x < cx ? -1 : 1)
    },
    [goBack, monthSlots, onClose, stage, stepWeek, weekSlots, weekStep],
  )

  /** 点「选这个月」才换场到周环；周环默认停在当前这一周 */
  const confirmMonth = () => {
    if (stage !== 'month') return
    if (!monthHasRecords) {
      showNotice('这个月没有记录，到有记录的月份看看吧')
      return
    }
    const nowKey = isoWeekKey(Date.now())
    const current = weeks.findIndex((item) => item.key === nowKey)
    void transition(() => {
      setStage('week')
      setWeekSpin(current >= 0 ? -current * weekStep : 0)
    })
  }

  /** 点「看这一周」进入这一周的列表 */
  const confirmWeek = () => {
    if (stage !== 'week') return
    if (!weekHasRecords) {
      showNotice('这一周没有记录，换个星期看看吧')
      return
    }
    void transition(() => setStage('list'))
  }

  const backToWeeks = () => {
    if (stage !== 'list') return
    void transition(() => setStage('week'))
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (phase === 'busy') return
    // 按钮上的点击交给按钮自己处理，不算空白区点击
    if ((event.target as Element).closest('button, a, input, textarea')) {
      drag.current.active = false
      return
    }
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    drag.current.active = true
    drag.current.moved = 0
    drag.current.startX = event.clientX
    drag.current.startY = event.clientY
    drag.current.lastX = event.clientX
    drag.current.lastY = event.clientY
    drag.current.lastAngle = (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI
    setPhase('dragging')
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active || phaseRef.current === 'busy') return
    drag.current.lastX = event.clientX
    drag.current.lastY = event.clientY
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

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => release(event)

  const monthName = `${year} 年 ${monthIndex + 1} 月`

  // 月环与周环共用同一套转盘手势；列表页和详情浮层不接收本层手势
  const rootHandlers =
    readerIndex !== null || stage === 'list'
      ? {}
      : { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }

  return (
    <div className="memory" ref={rootRef} data-stage={stage} {...rootHandlers}>
      {stage === 'list' ? <CloseButton onClick={onClose} /> : null}

      <div className="memory-stage" hidden={stage === 'list'}>
        <CloseButton onClick={onClose} className="memory-close" />
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
            <span className="memory-hole-year">{year}</span>
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

        {/* 快门只盖住圆环这一块，背景里的「我的」保持可见 */}
        <div className="memory-shutter" aria-hidden="true">
          <div
            className="memory-veil"
            style={{
              ['--hole' as string]: `${Math.round((1 - shutter) * 170)}px`,
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

      {stage === 'list' ? (
        <>
          {/* 点列表以外的空白：回上一级（周环） */}
          <button type="button" className="memory-list-backdrop" aria-label="返回周环" onClick={backToWeeks} />
          <div className="memory-list" data-fade={fade}>
            <div className="memory-list-head">
              <span>
                {monthName} · 第 {week?.week ?? '—'} 周
              </span>
              <button type="button" className="memory-confirm" onClick={backToWeeks} aria-label="返回周环">
                ↩ 返回
              </button>
            </div>
          {weekGroups.length === 0 ? (
            <p className="memory-empty">这一周还没有记录</p>
          ) : (
            weekGroups.map((group) => (
              <section className="day-group" key={group.key}>
                <div className="day-head">
                  <span className="day-label">{weekDayLabel(group.ts)}</span>
                  <span className="day-date">{dateText(group.ts)}</span>
                </div>
                {group.items.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    onOpen={() => setReaderIndex(weekEntries.indexOf(entry))}
                  />
                ))}
              </section>
            ))
          )}
          </div>
        </>
      ) : (
        <>
          <div className="memory-caption">
            {stage === 'month' ? (
              <>
                <strong>{monthName}</strong>
                <span>{demoMode ? '演示模式：全部可选' : `${byMonth.get(monthIndex) ?? 0} 条记录`}</span>
              </>
            ) : (
              <>
                <strong>
                  {year} 年 · 第 {week?.week ?? '—'} 周
                </strong>
                <span>{demoMode ? '演示模式：全部可选' : `${week ? (byWeek.get(week.key) ?? 0) : 0} 条记录`}</span>
              </>
            )}
          </div>

          {stage === 'month' ? (
            <button
              type="button"
              className={monthHasRecords ? 'memory-confirm' : 'memory-confirm is-empty'}
              onClick={confirmMonth}
            >
              {monthHasRecords ? '选这个月' : '本月无记录'}
            </button>
          ) : (
            <div className="memory-actions">
              <button type="button" className="memory-back" onClick={goBack} aria-label="回到月份">
                ↩ 换个月份
              </button>
              <button
                type="button"
                className={weekHasRecords ? 'memory-confirm' : 'memory-confirm is-empty'}
                onClick={confirmWeek}
              >
                {weekHasRecords ? '看这一周' : '本周无记录'}
              </button>
            </div>
          )}

          <p className="memory-hint">
            {stage === 'month' ? '在屏幕上滑动旋转 · 点「选这个月」确认' : '滑动挑选周 · 点「看这一周」翻记录'}
          </p>
        </>
      )}

      {notice ? (
        <div className="memory-notice" role="status">
          {notice}
        </div>
      ) : null}

      {readerIndex !== null && weekEntries[readerIndex] ? (
        <EntryReader
          entries={weekEntries}
          index={readerIndex}
          onIndexChange={setReaderIndex}
          onClose={() => setReaderIndex(null)}
          onDelete={(entry) => setPendingDelete(entry)}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这条记录？"
        message="删除后不能恢复，照片也会一起删掉。"
        confirmLabel="删除"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete
          setPendingDelete(null)
          if (!target || !onDelete) return
          setReaderIndex(null)
          void onDelete(target.id)
        }}
      />
    </div>
  )
}
