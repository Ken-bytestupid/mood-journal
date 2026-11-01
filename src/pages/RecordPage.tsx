import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { fileToDataURL } from '../core/image'
import { clockText, dateText, weekText } from '../core/time'
import type { Entry, EntryInput, Polarity } from '../core/types'
import { EMOTION_GROUPS, POLARITY_OPTIONS, emotionById } from '../modules/mood/emotions'
import { MoodFace } from '../ui/MoodFace'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'

const DRAFT_KEY = 'mood-journal:draft:v2'
const MAX_PHOTOS = 6

/** 草稿只存文字和心情：照片体积大，切页面会丢，等下一版接后台草稿。 */
interface Draft {
  title: string
  text: string
  polarity: Polarity
  emotionId: string | null
}

const EMPTY_DRAFT: Draft = { title: '', text: '', polarity: 'plain', emotionId: null }

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return { ...EMPTY_DRAFT }
    const parsed = JSON.parse(raw) as Partial<Draft>
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      text: typeof parsed.text === 'string' ? parsed.text : '',
      polarity:
        parsed.polarity === 'positive' || parsed.polarity === 'negative' || parsed.polarity === 'plain'
          ? parsed.polarity
          : 'plain',
      emotionId: typeof parsed.emotionId === 'string' ? parsed.emotionId : null,
    }
  } catch {
    return { ...EMPTY_DRAFT }
  }
}

function saveDraft(draft: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    /* 隐私模式下写不进去就算了，不影响使用 */
  }
}

interface RecordPageProps {
  onSave: (input: EntryInput) => Promise<Entry>
  hidden: boolean
}

/** 记录页：打开就能写。心情只问「积极 / 消极 / 只是记录」，别的都放到旁边。 */
export function RecordPage({ onSave, hidden }: RecordPageProps) {
  const toast = useToast()
  const [draft] = useState(loadDraft)
  const [title, setTitle] = useState(draft.title)
  const [text, setText] = useState(draft.text)
  const [polarity, setPolarity] = useState<Polarity>(draft.polarity)
  const [emotionId, setEmotionId] = useState<string | null>(draft.emotionId)
  const [photos, setPhotos] = useState<string[]>([])
  const [polarityOpen, setPolarityOpen] = useState(false)
  const [emotionOpen, setEmotionOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 工具栏时钟：分钟级，10 秒刷一次就够，不必每秒重渲染
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    saveDraft({ title, text, polarity, emotionId })
  }, [title, text, polarity, emotionId])

  // 保存成功后按钮自己亮一下就够了，不再弹 toast 挡住输入区
  useEffect(() => {
    if (!savedFlash) return
    const timer = window.setTimeout(() => setSavedFlash(false), 1600)
    return () => window.clearTimeout(timer)
  }, [savedFlash])

  const emotion = emotionById(emotionId)

  const choosePolarity = useCallback((value: Polarity) => {
    setPolarity(value)
    // 「只是记录」等于明确不挂情绪标记，顺手清掉已选的具体情绪
    if (value === 'plain') setEmotionId(null)
    setPolarityOpen(false)
  }, [])

  const chooseEmotion = useCallback((id: string) => {
    const picked = emotionById(id)
    if (picked) {
      setEmotionId(picked.id)
      // 挂了具体情绪就不用再点一次积极/消极，直接跟着走
      setPolarity(picked.polarity)
    }
    setEmotionOpen(false)
  }, [])

  const pickPhotos = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ''
      if (files.length === 0) return
      const room = MAX_PHOTOS - photos.length
      if (room <= 0) {
        toast(`一条记录最多 ${MAX_PHOTOS} 张照片`)
        return
      }
      try {
        const picked = await Promise.all(files.slice(0, room).map((file) => fileToDataURL(file)))
        setPhotos((prev) => [...prev, ...picked])
      } catch (error) {
        toast(error instanceof Error ? error.message : '图片处理失败')
      }
    },
    [photos.length, toast],
  )

  const handleSave = useCallback(async () => {
    if (saving) return
    if (!text.trim() && !title.trim() && photos.length === 0) {
      toast('写一句话再保存吧')
      return
    }
    setSaving(true)
    try {
      await onSave({ title, text, polarity, emotionId, photos })
      setTitle('')
      setText('')
      setPolarity('plain')
      setEmotionId(null)
      setPhotos([])
      saveDraft({ ...EMPTY_DRAFT })
      setSavedFlash(true)
      textRef.current?.blur()
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存失败，稍后再试')
    } finally {
      setSaving(false)
    }
  }, [emotionId, onSave, photos, polarity, saving, text, title, toast])

  return (
    <div className="page record" hidden={hidden}>
      <header className="topbar">
        <button
          type="button"
          className="mood-cell"
          data-polarity={polarity}
          onClick={() => setPolarityOpen(true)}
          aria-label={`这次的心情：${polarity === 'plain' ? '只是记录' : polarity === 'positive' ? '积极' : '消极'}，点击修改`}
        >
          <MoodFace polarity={polarity} />
          <span className="mood-cell-hint">
            {polarity === 'plain' ? '只是记录' : polarity === 'positive' ? '积极' : '消极'}
          </span>
        </button>

        <div className="toolbar-cell">
          <div className="clock">
            <span className="clock-date">
              {dateText(now)} · {weekText(now)}
            </span>
            <span className="clock-time">{clockText(now)}</span>
          </div>
          <button
            type="button"
            className="weather-slot"
            onClick={() => toast('天气还没接上，留着位置了')}
          >
            <span className="weather-dot" />
            天气
          </button>
        </div>
      </header>

      <section className="card">
        <textarea
          ref={textRef}
          className="editor"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="请输入文本…"
          aria-label="记录正文"
          enterKeyHint="enter"
        />

        <div className="photo-row">
          {photos.map((src, index) => (
            <div className="thumb" key={`${index}-${src.slice(-12)}`}>
              <img src={src} alt={`照片 ${index + 1}`} />
              <button
                type="button"
                className="thumb-remove"
                aria-label={`删除照片 ${index + 1}`}
                onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <button
              type="button"
              className="thumb-add"
              aria-label="添加照片"
              onClick={() => fileRef.current?.click()}
            >
              +
            </button>
          ) : null}
        </div>

        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pickPhotos} />

        <div className="card-divider" />

        <div className="card-actions">
          <button
            type="button"
            className="mood-pill"
            data-filled={emotion ? 'true' : 'false'}
            onClick={() => setEmotionOpen(true)}
            aria-label={emotion ? `此刻的心情：${emotion.label}，点击修改` : '此刻的心情'}
          >
            {emotion ? (
              <span className="mood-pill-emoji">{emotion.emoji}</span>
            ) : (
              <MoodFace polarity="plain" className="mood-pill-face" />
            )}
            <span className="mood-pill-label">{emotion ? emotion.label : '此刻的心情'}</span>
          </button>

          <input
            className="title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="添加标题"
            aria-label="标题"
            maxLength={40}
          />

          <button
            type="button"
            className="save-btn"
            data-saved={savedFlash ? 'true' : 'false'}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '保存中' : savedFlash ? '已保存' : '保存'}
          </button>
        </div>
      </section>

      <Sheet open={polarityOpen} onClose={() => setPolarityOpen(false)} title="这次的心情">
        <div className="polarity-list">
          {POLARITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="polarity-option"
              data-polarity={option.value}
              data-selected={polarity === option.value ? 'true' : 'false'}
              onClick={() => choosePolarity(option.value)}
            >
              <MoodFace polarity={option.value} className="polarity-face" />
              <span className="polarity-text">
                <span className="polarity-label">{option.label}</span>
                <span className="polarity-hint">{option.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet
        open={emotionOpen}
        onClose={() => setEmotionOpen(false)}
        title="此刻的心情"
        footer={
          emotionId ? (
            <button
              type="button"
              className="btn-ghost"
              style={{ width: '100%' }}
              onClick={() => {
                setEmotionId(null)
                setEmotionOpen(false)
              }}
            >
              清除已选情绪
            </button>
          ) : undefined
        }
      >
        {EMOTION_GROUPS.map((group) => (
          <section className="mood-group" key={group.polarity}>
            <div className="mood-group-head">
              <span className="mood-group-title">{group.title}</span>
              <span className="mood-group-hint">{group.hint}</span>
            </div>
            <div className="mood-chips">
              {group.emotions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="mood-chip"
                  data-selected={emotionId === item.id ? 'true' : 'false'}
                  onClick={() => chooseEmotion(item.id)}
                >
                  <span className="mood-chip-emoji">{item.emoji}</span>
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </Sheet>
    </div>
  )
}
