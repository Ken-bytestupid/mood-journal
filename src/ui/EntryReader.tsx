import { useCallback, useEffect, useRef, useState } from 'react'
import type { Entry } from '../core/types'
import { fullText } from '../core/time'
import { POLARITY_COLOR, POLARITY_LABEL, emotionById } from '../modules/mood/emotions'
import { BlobImage } from './BlobImage'
import { CloseButton } from './CloseButton'
import { MoodFace } from './MoodFace'
import { PhotoViewer } from './PhotoViewer'
import { usePagerGestures } from './usePagerGestures'

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
  const [photoOrigin, setPhotoOrigin] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null,
  )
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

  // 翻页手势与「记忆」共用同一份规则（左右滑动 + 三分区点击）
  const pager = usePagerGestures({
    isBusy: () => busy.current,
    canPage: entries.length > 1,
    onDragStart: () => setAnimate(false),
    onDrag: (dx) => setOffset(dx),
    onDragCancel: () => {
      setAnimate(true)
      setOffset(0)
    },
    onNext: () => step(1),
    onPrev: () => step(-1),
    onDismiss: onClose,
  })

  if (!entry) return null

  const emotion = emotionById(entry.emotionId)

  return (
    <div className="reader-root" data-photo-open={photoIndex !== null ? 'true' : 'false'}>
      <div className="reader-backdrop" />
      <div className="reader-stage" {...pager}>
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
                  onClick={(event) => {
                    // 记住缩略图位置，关闭预览时缩回这里
                    const rect = event.currentTarget.getBoundingClientRect()
                    setPhotoOrigin({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
                    setPhotoIndex(index_)
                  }}
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
          origin={photoOrigin}
          onIndexChange={setPhotoIndex}
          onClose={() => setPhotoIndex(null)}
        />
      ) : null}
    </div>
  )
}
