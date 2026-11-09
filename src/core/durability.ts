/**
 * 存储可靠性模块。
 *
 * 网页应用的数据一律落在「本机存储」里（iOS/Android 都是设备磁盘上的数据库文件，
 * 不是云端、不是内存）。但要让它足够可靠，还需要三件事：
 *   1. 申请持久化：让浏览器承诺「不因为长期没打开就清掉」
 *   2. 容量可见：知道用了多少、还剩多少
 *   3. 文字镜像：主库之外再留一份纯文字的副本，主库被清时还能捞回来
 *
 * 镜像只存文字，不存图片（localStorage 只有几 MB）；恢复时会标明「照片需要重新添加」。
 */
import { preferredImageType, type EncodeType } from './image'
import type { Entry, Polarity } from './types'

const MIRROR_KEY = 'mood-journal:mirror:v1'
const META_KEY = 'mood-journal:meta:v1'

export interface MirrorRecord {
  id: string
  title: string
  text: string
  polarity: Polarity
  emotionId: string | null
  createdAt: number
  photoCount: number
}

export interface Mirror {
  savedAt: number
  records: MirrorRecord[]
}

export type StorageBackend = 'idb' | 'ls'

export interface StorageStatus {
  backend: StorageBackend
  /** true = 浏览器已承诺持久化；false = 未承诺；null = 该浏览器不支持 */
  persisted: boolean | null
  usage: number
  quota: number
  mirrorCount: number
  mirrorSavedAt: number | null
  lastExportAt: number | null
  /** 本机照片会用哪种格式编码（Safari 不支持 WebP 编码，会走 JPEG）。 */
  photoType: EncodeType
}

/** 申请持久化存储。返回 null 表示当前浏览器不支持这个 API。 */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    const storage = navigator.storage
    if (!storage || typeof storage.persist !== 'function') return null
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return true
    return await storage.persist()
  } catch {
    return null
  }
}

export async function readStorageStatus(backend: StorageBackend): Promise<StorageStatus> {
  let persisted: boolean | null = null
  let usage = 0
  let quota = 0
  try {
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted()
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate()
      usage = estimate.usage ?? 0
      quota = estimate.quota ?? 0
    }
  } catch {
    /* 拿不到容量信息不影响使用 */
  }
  const mirror = readMirror()
  return {
    backend,
    persisted,
    usage,
    quota,
    mirrorCount: mirror?.records.length ?? 0,
    mirrorSavedAt: mirror?.savedAt ?? null,
    lastExportAt: readMeta().lastExportAt,
    photoType: preferredImageType(),
  }
}

/** 主库每次变动后同步一份文字镜像。写不进去（隐私模式/配额满）不影响主流程。 */
export function writeMirror(entries: Entry[]): void {
  try {
    const payload: Mirror = {
      savedAt: Date.now(),
      records: entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        text: entry.text,
        polarity: entry.polarity,
        emotionId: entry.emotionId,
        createdAt: entry.createdAt,
        photoCount: entry.photos.length,
      })),
    }
    localStorage.setItem(MIRROR_KEY, JSON.stringify(payload))
  } catch {
    /* 忽略 */
  }
}

export function readMirror(): Mirror | null {
  try {
    const raw = localStorage.getItem(MIRROR_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Mirror
    if (!parsed || !Array.isArray(parsed.records)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearMirror(): void {
  try {
    localStorage.removeItem(MIRROR_KEY)
  } catch {
    /* 忽略 */
  }
}

interface Meta {
  lastExportAt: number | null
}

export function readMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return { lastExportAt: null }
    const parsed = JSON.parse(raw) as Partial<Meta>
    return { lastExportAt: typeof parsed.lastExportAt === 'number' ? parsed.lastExportAt : null }
  } catch {
    return { lastExportAt: null }
  }
}

export function markExported(at = Date.now()): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ lastExportAt: at }))
  } catch {
    /* 忽略 */
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}
