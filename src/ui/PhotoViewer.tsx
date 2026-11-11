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

const SWIPE = 60

/** 点缩略图后打开的原尺寸查看器：整屏、双指缩放交给系统，左右滑动看下一张。 */
export function PhotoViewer({ photos, index, onIndexChange, onClose }: PhotoViewerProps) {
  const [offset, setOffset] = useState(0)
  const [animate, setAnimate] = useState(true)
  const startX = useRef(0)
  const dragging = useRef(false)
  const photo = photos[index]

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft') onIndexChange(Math.max(0, index - 1))
      else if (event.key === 'ArrowRight') onIndexChange(Math.min(photos.length - 1, index + 1))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [index, onClose, onIndexChange, photos.length])

  const settle = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    setAnimate(true)
    setOffset(0)
    if (offset <= -SWIPE && index < photos.length - 1) onIndexChange(index + 1)
    else if (offset >= SWIPE && index > 0) onIndexChange(index - 1)
  }, [index, offset, onIndexChange, photos.length])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (photos.length < 2) return
    dragging.current = true
    startX.current = event.clientX
    setAnimate(false)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    setOffset(event.clientX - startX.current)
  }

  if (!photo) return null

  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="查看照片">
      <button type="button" className="photo-viewer-backdrop" aria-label="关闭" onClick={onClose} />
      <div
        className="photo-viewer-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={settle}
        onPointerCancel={settle}
        onClick={(event) => {
          // 点图片以外的空白（黑边）就关掉
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div
          className="photo-viewer-frame"
          style={{
            transform: `translateX(${offset}px)`,
            transition: animate ? 'transform 0.18s cubic-bezier(0.22, 0.61, 0.36, 1)' : 'none',
          }}
        >
          <BlobImage blob={photo.full} alt="照片" className="photo-viewer-image" />
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
