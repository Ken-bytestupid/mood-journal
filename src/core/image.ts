/**
 * 照片压缩：把手机原图（常见 3–8MB）压成两档 WebP Blob。
 *
 * 为什么这么选（本地实测数据，原图 1773×2364 / 542KB）：
 *   长边 1440 · WebP q0.80 ≈ 102KB  （同尺寸 JPEG q0.82 要 187KB）
 *   长边 480  · WebP q0.72 ≈ 16KB
 * 浏览器不支持 WebP 编码时自动退回 JPEG，参数相应调整。
 *
 * 存 Blob 而不是 base64 dataURL：少 33% 体积，列表渲染也不用解析大字符串。
 */
import type { Photo } from './types'

const VIEW_EDGE = 1440
const THUMB_EDGE = 480
const VIEW_QUALITY = 0.8
const THUMB_QUALITY = 0.72
/** 查看图超过这个大小就再降一档，避免个别高纹理照片撑爆存储。 */
const VIEW_MAX_BYTES = 380 * 1024

type EncodeType = 'image/webp' | 'image/jpeg'

let encodeType: EncodeType | null = null

/** 探测浏览器能不能编码 WebP；不能就用 JPEG。 */
function detectEncodeType(): EncodeType {
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
  const type = detectEncodeType()
  const sourceWidth = img.naturalWidth || img.width
  const sourceHeight = img.naturalHeight || img.height

  const view = drawScaled(img, VIEW_EDGE)
  let viewBlob = await encode(view.canvas, type, VIEW_QUALITY)

  // 个别纹理很碎的照片会偏大：先降质量，再不行缩尺寸
  if (viewBlob.size > VIEW_MAX_BYTES) {
    const lowerQuality = await encode(view.canvas, type, 0.66)
    if (lowerQuality.size < viewBlob.size) viewBlob = lowerQuality
  }
  if (viewBlob.size > VIEW_MAX_BYTES * 1.5) {
    const smaller = drawScaled(img, 1080)
    const retry = await encode(smaller.canvas, type, 0.7)
    if (retry.size < viewBlob.size) viewBlob = retry
  }

  const thumb = drawScaled(img, THUMB_EDGE)
  const thumbBlob = await encode(thumb.canvas, type, THUMB_QUALITY)

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
