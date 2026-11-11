import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Entry } from '../core/types'
import { fullText } from '../core/time'
import { POLARITY_COLOR, POLARITY_LABEL, emotionById } from '../modules/mood/emotions'
import { BlobImage } from './BlobImage'
import { CloseButton } from './CloseButton'
import { MoodFace } from './MoodFace'
import { PhotoViewer } from './PhotoViewer'

interface EntryReaderProps {
  entries: Entry[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  onDelete: (entry: Entry) => void
}

const FLY_DISTANCE = 460
const FLY_MS = 190

/**
 * 翻页式阅读器：屏幕居中的方框，左右滑动切换，方框下方用 1/n 标示位置。
 * 用 pointer 事件，所以手机滑动和桌面拖拽是同一套逻辑。
 */
export function EntryReader({ entries, index, onIndexChange, onClose, onDelete }: EntryReaderProps) {
  const [offset, setOffset] = useState(0)
  const [animate, setAnimate] = useState(true)
  const [photoIndex, setPhotoIndex] = useState<number | null>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const lastX = useRef(0)
  const dragging = useRef(false)
  const onInteractive = useRef(false)
  const busy = useRef(false)

  const entry = entries[index]

  const step = useCallback(
    (delta: number) => {
      if (busy.current) return
      const next = index + delta
      if (next < 0 || next >= entries.length) {
        setAnimate(true)
        setOffset(0)
        return
      }
      busy.current = true
      setAnimate(true)
      setOffset(-delta * FLY_DISTANCE)
      window.setTimeout(() => {
        onIndexChange(next)
        setAnimate(false)
        setOffset(0)
        busy.current = false
        window.setTimeout(() => setAnimate(true), 20)
      }, FLY_MS)
    },
    [entries.length, index, onIndexChange],
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
    dragging.current = false
    startX.current = event.clientX
    lastX.current = event.clientX
    startY.current = event.clientY
    // 按钮、链接上的点击交给它们自己处理（删除、看照片），不当作翻页
    onInteractive.current = !!(event.target as Element).closest('button, a, input, textarea')
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy.current) return
    lastX.current = event.clientX
    const dx = event.clientX - startX.current
    const dy = event.clientY - startY.current

    if (!dragging.current) {
      // 先判断方向：横向为主才算翻页，纵向留给卡片自己滚动
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return
      if (entries.length < 2) return
      dragging.current = true
      setAnimate(false)
    }
    setOffset(dx)
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 浏览器可能会把触摸流改成 pointercancel，此时坐标是 0,0，
    // 直接用它会算出巨大的负位移（表现为"往哪划都往后翻"），所以用最后一次移动的坐标。
    const cancelled = event.type === 'pointercancel'
    const endX = cancelled ? lastX.current : event.clientX

    if (!dragging.current) {
      if (cancelled || onInteractive.current) return

      // 电子阅读器式分区点击：左三分之一上一页，右三分之一下一页，中间退出详情
      const third = window.innerWidth / 3
      if (endX < third) step(-1)
      else if (endX > third * 2) step(1)
      else onClose()
      return
    }

    dragging.current = false
    const dx = endX - startX.current
    const threshold = 70
    if (dx <= -threshold) step(1)
    else if (dx >= threshold) step(-1)
    else {
      setAnimate(true)
      setOffset(0)
    }
  }

  if (!entry) return null

  const emotion = emotionById(entry.emotionId)

  return (
    <div className="reader-root" data-photo-open={photoIndex !== null ? 'true' : 'false'}>
      <div className="reader-backdrop" />
      <div
        className="reader-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="reader-card"
          role="dialog"
          aria-modal="true"
          aria-label="记录详情"
          style={{
            transform: `translateX(${offset}px)`,
            transition: animate ? `transform ${FLY_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)` : 'none',
          }}
        >
          <div className="reader-meta">
            <MoodFace
              polarity={entry.polarity}
              className="reader-face"
              style={{ color: POLARITY_COLOR[entry.polarity] }}
            />
            <span>{POLARITY_LABEL[entry.polarity]}</span>
            {emotion ? (
              <>
                <span>·</span>
                <span>
                  {emotion.emoji} {emotion.label}
                </span>
              </>
            ) : null}
          </div>

          <div className="reader-time">{fullText(entry.createdAt)}</div>
          {entry.title ? <h3 className="reader-title">{entry.title}</h3> : null}
          {entry.text ? <p className="reader-text">{entry.text}</p> : null}
          {entry.photos.length > 0 ? (
            <div className="reader-photos">
              {entry.photos.map((photo, index_) => (
                <button
                  key={index_}
                  type="button"
                  className="reader-photo"
                  aria-label={`查看第 ${index_ + 1} 张照片的原尺寸`}
                  onClick={() => setPhotoIndex(index_)}
                >
                  <BlobImage blob={photo.thumb} alt={`照片 ${index_ + 1}`} />
                </button>
              ))}
            </div>
          ) : null}

          <button type="button" className="reader-delete" onClick={() => onDelete(entry)}>
            删除这条
          </button>
        </div>

        <div className="reader-counter" aria-live="polite">
          {index + 1} / {entries.length}
        </div>
        {entries.length > 1 ? <p className="reader-hint">左右滑动翻页查看</p> : null}
      </div>

      <CloseButton onClick={onClose} />

      {photoIndex !== null ? (
        <PhotoViewer
          photos={entry.photos}
          index={photoIndex}
          onIndexChange={setPhotoIndex}
          onClose={() => setPhotoIndex(null)}
        />
      ) : null}
    </div>
  )
}
