import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

/** 位移小于这个值当作「点击」，不当作滑动 */
const TAP_SLOP = 8
/** 松手时超过这个位移才翻页，否则回弹 */
const SWIPE_THRESHOLD = 70

interface PagerOptions {
  onNext: () => void
  onPrev: () => void
  /** 点中间三分之一：退出（不传则不响应） */
  onDismiss?: () => void
  /** 开始横向拖动（用于关掉过渡动画） */
  onDragStart?: () => void
  /** 拖动中（用于跟手位移） */
  onDrag?: (dx: number) => void
  /** 松手但没超过阈值：回弹 */
  onDragCancel?: () => void
  /** 是否允许翻页，比如只有一条记录时不翻 */
  canPage?: boolean
  /** 动画进行中时忽略手势 */
  isBusy?: () => boolean
}

export interface PagerHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
}

/**
 * 翻页手势：左右滑动翻页 + 左/中/右三分区点击。
 * 阅读器和「记忆」的周环共用这一份规则，保证两处手感一致。
 * 事件会 stopPropagation，避免同时触发下层浮层的手势。
 */
export function usePagerGestures(options: PagerOptions): PagerHandlers {
  const startX = useRef(0)
  const startY = useRef(0)
  const lastX = useRef(0)
  const dragging = useRef(false)
  const onInteractive = useRef(false)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (optionsRef.current.isBusy?.()) return
    event.stopPropagation()
    dragging.current = false
    startX.current = event.clientX
    lastX.current = event.clientX
    startY.current = event.clientY
    // 按钮、链接上的点击交给它们自己处理（删除、看照片、换个月份）
    onInteractive.current = !!(event.target as Element).closest('button, a, input, textarea')
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (optionsRef.current.isBusy?.()) return
    event.stopPropagation()
    lastX.current = event.clientX
    const dx = event.clientX - startX.current
    const dy = event.clientY - startY.current

    if (!dragging.current) {
      // 先判断方向：横向为主才算翻页，纵向留给内容自己滚动
      if (Math.abs(dx) < TAP_SLOP || Math.abs(dx) <= Math.abs(dy)) return
      if (optionsRef.current.canPage === false) return
      dragging.current = true
      optionsRef.current.onDragStart?.()
    }
    optionsRef.current.onDrag?.(dx)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation()
    // 浏览器可能把触摸流改成 pointercancel，坐标会变成 0,0，用最后一次移动的坐标
    const cancelled = event.type === 'pointercancel'
    const endX = cancelled ? lastX.current : event.clientX

    if (!dragging.current) {
      if (cancelled || onInteractive.current) return
      // 电子阅读器式分区点击：左三分之一上一页，右三分之一下一页，中间退出
      const third = window.innerWidth / 3
      if (endX < third) optionsRef.current.onPrev()
      else if (endX > third * 2) optionsRef.current.onNext()
      else optionsRef.current.onDismiss?.()
      return
    }

    dragging.current = false
    const dx = endX - startX.current
    if (dx <= -SWIPE_THRESHOLD) optionsRef.current.onNext()
    else if (dx >= SWIPE_THRESHOLD) optionsRef.current.onPrev()
    else optionsRef.current.onDragCancel?.()
  }

  return { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag }
}
