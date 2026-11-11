import { clockText } from '../core/time'
import type { Entry } from '../core/types'
import { POLARITY_COLOR, emotionById } from '../modules/mood/emotions'
import { BlobImage } from './BlobImage'
import { MoodFace } from './MoodFace'

/** 列表里的一行。今天 / 本周 / 记忆 共用同一套外观。 */
export function EntryRow({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  const emotion = emotionById(entry.emotionId)
  return (
    <button type="button" className="entry" onClick={onOpen}>
      <span className="entry-mood" style={{ color: POLARITY_COLOR[entry.polarity] }}>
        {emotion ? (
          <span className="entry-emoji">{emotion.emoji}</span>
        ) : (
          <MoodFace polarity={entry.polarity} className="entry-face" />
        )}
      </span>
      <span className="entry-main">
        <span className="entry-top">
          <span className="entry-time">{clockText(entry.createdAt)}</span>
          {entry.title ? <span className="entry-title">{entry.title}</span> : null}
        </span>
        {entry.text ? <span className="entry-text">{entry.text}</span> : null}
        {entry.photos.length > 0 ? (
          <span className="entry-photos">
            {entry.photos.slice(0, 3).map((photo, index) => (
              <BlobImage key={index} blob={photo.thumb} alt={`照片 ${index + 1}`} />
            ))}
          </span>
        ) : null}
      </span>
    </button>
  )
}
