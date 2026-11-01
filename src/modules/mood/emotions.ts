import type { Emotion, Polarity } from '../../core/types'

/**
 * 具体情绪清单：4 积极 + 4 消极。
 * 它是「此刻的心情」那个 emoji 标记的来源，点一下给记录盖个章，不打断写字。
 */
export const EMOTIONS: Emotion[] = [
  { id: 'happy', label: '开心', emoji: '😄', polarity: 'positive' },
  { id: 'satisfied', label: '满足', emoji: '😌', polarity: 'positive' },
  { id: 'calm', label: '平静', emoji: '🙂', polarity: 'positive' },
  { id: 'excited', label: '期待', emoji: '🤩', polarity: 'positive' },
  { id: 'sad', label: '难过', emoji: '😢', polarity: 'negative' },
  { id: 'anxious', label: '焦虑', emoji: '😰', polarity: 'negative' },
  { id: 'angry', label: '生气', emoji: '😠', polarity: 'negative' },
  { id: 'tired', label: '疲惫', emoji: '😪', polarity: 'negative' },
]

export interface EmotionGroup {
  polarity: Exclude<Polarity, 'plain'>
  title: string
  hint: string
  emotions: Emotion[]
}

export const EMOTION_GROUPS: EmotionGroup[] = [
  {
    polarity: 'positive',
    title: '积极',
    hint: '此刻让你觉得还不错',
    emotions: EMOTIONS.filter((emotion) => emotion.polarity === 'positive'),
  },
  {
    polarity: 'negative',
    title: '消极',
    hint: '不好受的也可以写下来',
    emotions: EMOTIONS.filter((emotion) => emotion.polarity === 'negative'),
  },
]

export interface PolarityOption {
  value: Polarity
  label: string
  hint: string
}

/** 左上角那个脸点开只有这三项，一屏点完。 */
export const POLARITY_OPTIONS: PolarityOption[] = [
  { value: 'positive', label: '积极', hint: '此刻感觉还不错' },
  { value: 'negative', label: '消极', hint: '此刻有点不好受' },
  { value: 'plain', label: '只是记录', hint: '没什么情绪，就是想记一下' },
]

export const POLARITY_LABEL: Record<Polarity, string> = {
  positive: '积极',
  negative: '消极',
  plain: '只是记录',
}

/** 三种心情对应的颜色变量，列表、详情、统计条共用一套。 */
export const POLARITY_COLOR: Record<Polarity, string> = {
  positive: 'var(--pos)',
  negative: 'var(--neg)',
  plain: 'var(--muted)',
}

export function emotionById(id: string | null | undefined): Emotion | null {
  if (!id) return null
  return EMOTIONS.find((emotion) => emotion.id === id) ?? null
}
