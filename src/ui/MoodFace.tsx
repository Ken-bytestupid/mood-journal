import type { CSSProperties } from 'react'
import type { Polarity } from '../core/types'

interface MoodFaceProps {
  polarity: Polarity
  className?: string
  style?: CSSProperties
}

/**
 * 手绘感的小脸：
 *  - 积极：弯眼 + 上弯嘴
 *  - 消极：弯眼 + 下弯嘴
 *  - 只是记录：点眼 + 平嘴（不表态，所以不画表情）
 */
export function MoodFace({ polarity, className, style }: MoodFaceProps) {
  const mouth =
    polarity === 'positive' ? 'M16 29 Q24 39 32 29' : polarity === 'negative' ? 'M16 34 Q24 26 32 34' : 'M16 32 H32'
  const plain = polarity === 'plain'

  return (
    <svg className={className ?? 'mood-face'} viewBox="0 0 48 48" aria-hidden="true" style={style}>
      <g fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
        {plain ? (
          <>
            <circle cx="17.5" cy="20" r="1.9" fill="currentColor" stroke="none" />
            <circle cx="30.5" cy="20" r="1.9" fill="currentColor" stroke="none" />
          </>
        ) : (
          <>
            <path d="M14 20 Q17.5 15.5 21 20" />
            <path d="M27 20 Q30.5 15.5 34 20" />
          </>
        )}
        <path d={mouth} />
      </g>
    </svg>
  )
}
