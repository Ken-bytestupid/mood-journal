/**
 * 记录业务模块：唯一负责「一条记录怎么建、怎么删、怎么备份」的地方。
 * 页面不直接碰 core/db。
 */
import { readAll, removeAll, removeOne, writeMany, writeOne } from '../../core/db'
import { readMirror } from '../../core/durability'
import { blobToDataURL, dataURLToBlob } from '../../core/image'
import type { Entry, EntryInput, Photo, Polarity } from '../../core/types'

/** v3：照片从 base64 字符串改成双档 Blob（缩略图 + 查看图）。 */
const BACKUP_VERSION = 3

/** 旧版本（v1）用 moodId 存具体情绪，读出来时升级成 polarity + emotionId。 */
const LEGACY_POLARITY: Record<string, Exclude<Polarity, 'plain'>> = {
  happy: 'positive',
  satisfied: 'positive',
  calm: 'positive',
  excited: 'positive',
  sad: 'negative',
  anxious: 'negative',
  angry: 'negative',
  tired: 'negative',
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function isPolarity(value: unknown): value is Polarity {
  return value === 'positive' || value === 'negative' || value === 'plain'
}

/**
 * 照片兼容三种历史形态：
 *   · v3：{ thumb: Blob, view: Blob, width, height }
 *   · v2：dataURL 字符串（base64）
 *   · 更早：dataURL 字符串，混在同一个数组里
 * 字符串会被还原成 Blob；缩略图缺失时先用查看图顶上（显示大一点，但不丢图）。
 */
/**
 * 照片兼容几种历史形态：
 *   · 现在：{ thumb: Blob, full: Blob, width, height }
 *   · v3  ：{ thumb, view }——原来的 1440 查看图，升级后当作 full 用
 *   · v2 及更早：dataURL 字符串（只有一张，thumb / full 都用它）
 */
async function normalizePhotos(value: unknown): Promise<Photo[]> {
  if (!Array.isArray(value)) return []
  const photos: Photo[] = []

  const toBlob = (input: unknown): Blob | null => {
    if (input instanceof Blob) return input
    if (typeof input === 'string' && input.startsWith('data:')) return dataURLToBlob(input)
    return null
  }

  for (const item of value) {
    if (typeof item === 'string') {
      const blob = toBlob(item)
      if (!blob) continue
      photos.push({ thumb: blob, full: blob, width: 0, height: 0 })
      continue
    }
    if (!item || typeof item !== 'object') continue

    const record = item as { thumb?: unknown; full?: unknown; view?: unknown; width?: unknown; height?: unknown }
    // full 优先；老数据只有 view，就把它当 full
    const full = toBlob(record.full) ?? toBlob(record.view)
    const thumb = toBlob(record.thumb) ?? full
    if (!full || !thumb) continue

    photos.push({
      thumb,
      full,
      width: typeof record.width === 'number' ? record.width : 0,
      height: typeof record.height === 'number' ? record.height : 0,
    })
  }

  return photos
}

/** 把库里可能存在的旧结构补齐成当前结构。 */
async function upgrade(raw: Entry): Promise<Entry> {
  const record = raw as Entry & { moodId?: unknown }
  const legacy = typeof record.moodId === 'string' ? record.moodId : null
  const emotionId = typeof record.emotionId === 'string' ? record.emotionId : legacy
  const polarity = isPolarity(record.polarity) ? record.polarity : legacy ? (LEGACY_POLARITY[legacy] ?? 'plain') : 'plain'

  return {
    ...raw,
    polarity,
    emotionId,
    photos: await normalizePhotos(record.photos),
  }
}

export async function listEntries(): Promise<Entry[]> {
  const all = await readAll()
  return Promise.all(all.map(upgrade))
}

export async function createEntry(input: EntryInput, now = Date.now()): Promise<Entry> {
  const entry: Entry = {
    id: newId(),
    title: input.title.trim(),
    text: input.text.trim(),
    polarity: input.polarity,
    emotionId: input.emotionId,
    photos: input.photos,
    createdAt: now,
    updatedAt: now,
  }
  await writeOne(entry)
  return entry
}

export async function deleteEntry(id: string): Promise<void> {
  await removeOne(id)
}

export async function clearEntries(): Promise<void> {
  await removeAll()
}

/**
 * 备份成 JSON。照片以查看图的 dataURL 写入，保证换设备/换域名也能完整还原
 * （代价是备份文件里照片会按 base64 膨胀 33%，可以接受）。
 */
export async function buildBackupJSON(entries: Entry[]): Promise<string> {
  const payload = {
    app: 'mood-journal',
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    entries: await Promise.all(
      entries.map(async (entry) => ({
        ...entry,
        photos: await Promise.all(entry.photos.map((photo) => blobToDataURL(photo.full))),
      })),
    ),
  }
  return JSON.stringify(payload, null, 2)
}

/** 导入：跳过已存在的 id，返回真正新增的条数。 */
export async function importBackup(text: string, existing: Entry[]): Promise<number> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('这个文件不是有效的 JSON')
  }

  const list = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown }).entries
  if (!Array.isArray(list)) throw new Error('文件里没有找到记录')

  const known = new Set(existing.map((entry) => entry.id))
  const incoming: Entry[] = []
  for (const raw of list) {
    const entry = await normalize(raw)
    if (!entry || known.has(entry.id)) continue
    known.add(entry.id)
    incoming.push(entry)
  }
  if (incoming.length > 0) await writeMany(incoming)
  return incoming.length
}

/** 导入时做宽松校验：缺字段的记录直接跳过，不因为一条坏数据整份失败。 */
async function normalize(raw: unknown): Promise<Entry | null> {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.createdAt !== 'number') return null
  const title = typeof record.title === 'string' ? record.title : ''
  const text = typeof record.text === 'string' ? record.text : ''
  const photos = await normalizePhotos(record.photos)
  if (!title && !text && photos.length === 0) return null

  const legacyMoodId = typeof record.moodId === 'string' ? record.moodId : null
  const polarity = isPolarity(record.polarity)
    ? record.polarity
    : legacyMoodId
      ? (LEGACY_POLARITY[legacyMoodId] ?? 'plain')
      : 'plain'

  return {
    id: record.id,
    title,
    text,
    polarity,
    emotionId: typeof record.emotionId === 'string' ? record.emotionId : legacyMoodId,
    photos,
    createdAt: record.createdAt,
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : record.createdAt,
    context: typeof record.context === 'object' && record.context !== null ? (record.context as Entry['context']) : undefined,
  }
}

/**
 * 从文字镜像里把记录捞回主库。
 * 照片不在镜像里（体积太大），恢复出来的记录需要重新添加图片。
 * 返回真正补回来的条数。
 */
export async function restoreFromMirror(): Promise<number> {
  const mirror = readMirror()
  if (!mirror || mirror.records.length === 0) return 0

  const existing = new Set((await readAll()).map((entry) => entry.id))
  const restored: Entry[] = mirror.records
    .filter((record) => !existing.has(record.id))
    .map((record) => ({
      id: record.id,
      title: record.title,
      text: record.text,
      polarity: record.polarity,
      emotionId: record.emotionId,
      photos: [],
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
    }))

  if (restored.length > 0) await writeMany(restored)
  return restored.length
}
