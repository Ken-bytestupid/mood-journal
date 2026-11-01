/**
 * 心情：只分积极 / 消极 / 不表态。
 * 「只是记录」是明确的一种选择，不是「没选」——很多人打开就是想记点事，没有情绪。
 */
export type Polarity = 'positive' | 'negative' | 'plain'

/** 一种具体情绪：挂在这条记录上的 emoji 标记，不参与积极/消极的粗分类判断。 */
export interface Emotion {
  id: string
  label: string
  emoji: string
  /** 选了它就自动把心情设成这一组：挂 😢 的人不用再点一次「消极」。 */
  polarity: Exclude<Polarity, 'plain'>
}

/** 一条记录。 */
export interface Entry {
  id: string
  title: string
  text: string
  /** 粗分类：积极 / 消极 / 只是记录。 */
  polarity: Polarity
  /** 具体情绪标记，可为空。 */
  emotionId: string | null
  /** 压缩后的 dataURL；本机存储，不上传。 */
  photos: string[]
  createdAt: number
  updatedAt: number
  /**
   * 记录当时的环境快照。以后接天气 / 地点时往这里加字段，
   * 历史记录不会被新字段影响。
   */
  context?: {
    weather?: string | null
  }
}

/** 新建记录时的输入。 */
export interface EntryInput {
  title: string
  text: string
  polarity: Polarity
  emotionId: string | null
  photos: string[]
}
