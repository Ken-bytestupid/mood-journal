/**
 * 照片压缩：把手机原图（常见 3–8MB）压成两档图，存成 Blob。
 *
 * 格式不是写死的，按设备能力来：
 *   · Chrome / Edge / Android / Firefox 支持 canvas 编码 WebP → 用 WebP（同画质约小 45%）
 *   · Safari（含 iPhone 上的所有浏览器，内核都是 WebKit）**不支持** canvas 编码 WebP
 *     （toDataURL('image/webp') 会回退成 PNG，见 caniuse 兼容表），所以自动走 JPEG
 * 两条路产出的图所有现代设备都能解码：WebP 解码从 Safari 14 / Chrome 32 / Firefox 65 起支持，
 * JPEG 更是从 1992 年来的通用格式。
 *
 * 实测体积（原图 1773×2364 / 542KB）：
 *   1440 · WebP q0.80 ≈ 102KB ／ JPEG q0.78 ≈ 170KB
 *    480 · WebP q0.72 ≈  16KB ／ JPEG q0.70 ≈  22KB
 *
 * 存 Blob 而不是 base64 dataURL：少 33% 体积，列表渲染也不用解析大字符串。
 */
import type { Photo } from './types'

const VIEW_EDGE = 1440
const THUMB_EDGE = 480
/** 查看图超过这个大小就再降一档，避免个别高纹理照片撑爆存储。 */
const VIEW_MAX_BYTES = 380 * 1024

export type EncodeType = 'image/webp' | 'image/jpeg'

/** 每种格式的质量：JPEG 有损更明显，取值略低一点也不损失观感。 */
const QUALITY: Record<EncodeType, { view: number; thumb: number }> = {
  'image/webp': { view: 0.8, thumb: 0.72 },
  'image/jpeg': { view: 0.78, thumb: 0.7 },
}

let encodeType: EncodeType | null = null

/**
 * 探测本机能不能编码 WebP。
 * 不能（Safari / 老 Firefox）就退回 JPEG——这是兼容性的兜底，不是降级方案。
 */
export function preferredImageType(): EncodeType {
  if (encodeType) return encodeType
  try {
    const probe = document.createElement('canvas')
    probe.width = 1
    probe.height = 1
    encodeType = probe.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
  } catch {
    encodeType = 'image/jpeg'
  }
  return encodeType
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('这张图片读不出来'))
    }
    img.src = url
  })
}

interface Scaled {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

function drawScaled(img: HTMLImageElement, maxEdge: number): Scaled {
  const sourceWidth = img.naturalWidth || img.width
  const sourceHeight = img.naturalHeight || img.height
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持图片处理')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)
  return { canvas, width, height }
}

function encode(canvas: HTMLCanvasElement, type: EncodeType, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('图片编码失败'))
      },
      type,
      quality,
    )
  })
}

/** 主入口：一张原始文件 → 缩略图 + 查看图。 */
export async function compressPhoto(file: File): Promise<Photo> {
  const img = await loadImage(file)
  const type = preferredImageType()
  const sourceWidth = img.naturalWidth || img.width
  const sourceHeight = img.naturalHeight || img.height

  const quality = QUALITY[type]
  const view = drawScaled(img, VIEW_EDGE)
  let viewBlob = await encode(view.canvas, type, quality.view)

  // 个别纹理很碎的照片会偏大：先降质量，再不行缩尺寸
  if (viewBlob.size > VIEW_MAX_BYTES) {
    const lowerQuality = await encode(view.canvas, type, Math.max(0.55, quality.view - 0.14))
    if (lowerQuality.size < viewBlob.size) viewBlob = lowerQuality
  }
  if (viewBlob.size > VIEW_MAX_BYTES * 1.5) {
    const smaller = drawScaled(img, 1080)
    const retry = await encode(smaller.canvas, type, quality.view - 0.1)
    if (retry.size < viewBlob.size) viewBlob = retry
  }

  const thumb = drawScaled(img, THUMB_EDGE)
  const thumbBlob = await encode(thumb.canvas, type, quality.thumb)

  return { thumb: thumbBlob, view: viewBlob, width: sourceWidth, height: sourceHeight }
}

/** 备份/导入用：dataURL ↔ Blob。 */
export function dataURLToBlob(dataURL: string): Blob {
  const [head, body] = dataURL.split(',')
  const mime = /:(.*?);/.exec(head ?? '')?.[1] ?? 'image/jpeg'
  const binary = atob(body ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}
