import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Photo } from '../core/types'
import { BlobImage } from './BlobImage'
import { CloseButton } from './CloseButton'

interface PhotoViewerProps {
  photos: Photo[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}

/** 飞页动画时长与阈值，和阅读器保持同一套手感 */
const FLY_MS = 200
const SWIPE_X = 50
/** 向下拖过这个距离就关闭 */
const DISMISS_Y = 110
/** 判定为拖动的最小位移 */
const SLOP = 8

/**
 * 照片预览：三张并排（上一张 / 当前 / 下一张），左右滑动跟手切换；
 * 点图片外的空白关闭；按住图片向下拖也能关闭（iOS 相册那种）。
 */
export function PhotoViewer({ photos, index, onIndexChange, onClose }: PhotoViewerProps) {
  const [dx, setDx] = useState(0)
  const [dy, setDy] = useState(0)
  const [animate, setAnimate] = useState(true)
  const dragging = useRef(false)
  const axis = useRef<'x' | 'y' | null>(null)
  const start = useRef({ x: 0, y: 0 })
  const last = useRef({ x: 0, y: 0 })
  const busy = useRef(false)
  const trackRef = useRef<HTMLDivElement>(null)

  const photo = photos[index]
  const canPrev = index > 0
  const canNext = index < photos.length - 1

  const step = useCallback(
    (delta: number) => {
      if (busy.current) return
      const next = index + delta
      if (next < 0 || next >= photos.length) {
        setAnimate(true)
        setDx(0)
        return
      }
      busy.current = true
      setAnimate(true)
      const width = trackRef.current?.clientWidth ? trackRef.current.clientWidth / 3 : window.innerWidth
      setDx(-delta * width)
      window.setTimeout(() => {
        onIndexChange(next)
        setAnimate(false)
        setDx(0)
        window.setTimeout(() => {
          setAnimate(true)
          busy.current = false
        }, 20)
      }, FLY_MS)
    },
    [index, onIndexChange, photos.length],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, step])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy.current) return
    dragging.current = true
    axis.current = null
    start.current = { x: event.clientX, y: event.clientY }
    last.current = { x: event.clientX, y: event.clientY }
    setAnimate(false)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    last.current = { x: event.clientX, y: event.clientY }
    const mx = event.clientX - start.current.x
    const my = event.clientY - start.current.y
    if (!axis.current) {
      if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return
      axis.current = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
    }
    if (axis.current === 'x') {
      // 到头了加阻力，手感更自然
      const atEdge = (!canPrev && mx > 0) || (!canNext && mx < 0)
      setDx(atEdge ? mx * 0.3 : mx)
      return
    }
    // 只有向下拖才跟手（向上拖不动）
    if (my > 0) setDy(my)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    const cancelled = event.type === 'pointercancel'
    const endX = cancelled ? last.current.x : event.clientX
    const endY = cancelled ? last.current.y : event.clientY

    if (axis.current === 'x') {
      const mx = endX - start.current.x
      if (mx <= -SWIPE_X && canNext) step(1)
      else if (mx >= SWIPE_X && canPrev) step(-1)
      else {
        setAnimate(true)
        setDx(0)
      }
      return
    }

    if (axis.current === 'y') {
      const my = endY - start.current.y
      if (my > DISMISS_Y) {
        setAnimate(true)
        setDy(window.innerHeight)
        window.setTimeout(onClose, FLY_MS)
      } else {
        setAnimate(true)
        setDy(0)
      }
      return
    }

    // 只是点了一下：点在图片之外就关闭（只看中间那张，避免取错元素）
    const image = trackRef.current
      ?.querySelector('.photo-viewer-slide:nth-child(2) .photo-viewer-image')
      ?.getBoundingClientRect()
    const inside =
      image != null &&
      endX >= image.left &&
      endX <= image.right &&
      endY >= image.top &&
      endY <= image.bottom
    if (!inside) onClose()
  }

  if (!photo) return null

  const slides = [index - 1, index, index + 1]

  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="查看照片">
      <div
        className="photo-viewer-backdrop"
        style={{ opacity: Math.max(0.25, 1 - dy / 420) }}
        onClick={onClose}
      />

      <div
        className="photo-viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="photo-viewer-track"
          ref={trackRef}
          style={{
            transform: `translate3d(calc(-33.3333% + ${dx}px), ${dy}px, 0) scale(${Math.max(
              0.86,
              1 - Math.abs(dy) / 1800,
            )})`,
            transition: animate ? `transform ${FLY_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)` : 'none',
            opacity: Math.max(0, 1 - Math.abs(dy) / 620),
          }}
        >
          {slides.map((slideIndex) =>
            slideIndex >= 0 && slideIndex < photos.length ? (
              <div className="photo-viewer-slide" key={slideIndex}>
                <BlobImage blob={photos[slideIndex].full} alt="照片" className="photo-viewer-image" />
              </div>
            ) : (
              <div className="photo-viewer-slide" key={slideIndex} />
            ),
          )}
        </div>
      </div>

      <CloseButton onClick={onClose} />

      {photos.length > 1 ? (
        <div className="photo-viewer-counter">
          {index + 1} / {photos.length}
        </div>
      ) : null}
    </div>
  )
}
