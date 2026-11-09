import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Entry } from '../core/types'
import { fullText } from '../core/time'
import { POLARITY_COLOR, POLARITY_LABEL, emotionById } from '../modules/mood/emotions'
import { BlobImage } from './BlobImage'
import { MoodFace } from './MoodFace'

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
  const startX = useRef(0)
  const dragging = useRef(false)
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
    if (entries.length < 2 || busy.current) return
    dragging.current = true
    startX.current = event.clientX
    setAnimate(false)
    // 抓住指针，手指滑出卡片范围也能收到后续事件
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    setOffset(event.clientX - startX.current)
  }

  const endDrag = () => {
    if (!dragging.current) return
    dragging.current = false
    const threshold = 70
    if (offset <= -threshold) step(1)
    else if (offset >= threshold) step(-1)
    else {
      setAnimate(true)
      setOffset(0)
    }
  }

  if (!entry) return null

  const emotion = emotionById(entry.emotionId)

  return (
    <div className="reader-root">
      <button type="button" className="reader-backdrop" aria-label="关闭" onClick={onClose} />
      <div className="reader-stage">
        <div
          className="reader-card"
          role="dialog"
          aria-modal="true"
          aria-label="记录详情"
          style={{
            transform: `translateX(${offset}px)`,
            transition: animate ? `transform ${FLY_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)` : 'none',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
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
              {entry.photos.map((photo, photoIndex) => (
                <BlobImage key={photoIndex} blob={photo.view} alt={`照片 ${photoIndex + 1}`} />
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
      </div>
    </div>
  )
}
