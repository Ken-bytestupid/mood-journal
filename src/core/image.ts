/**
 * 照片压缩：一张原图 → 两档图，都存成 Blob。
 *
 * 两档的用途：
 *   · thumb：长边 480 的缩略图，列表和记录详情都显示它
 *   · full ：**保持原始像素**，只降画质；详情页点缩略图才加载，用于看细节
 *
 * 格式不是写死的，按设备能力来：
 *   · Chrome / Edge / Android / Firefox 支持 canvas 编码 WebP → 用 WebP（同画质约小 45%）
 *   · Safari（含 iPhone 上的所有浏览器，内核都是 WebKit）**不支持** canvas 编码 WebP
 *     （toDataURL('image/webp') 会回退成 PNG，见 caniuse 兼容表），所以自动走 JPEG
 * 两条路产出的图所有现代设备都能解码：WebP 解码从 Safari 14 / Chrome 32 / Firefox 65 起支持，
 * JPEG 更是从 1992 年来的通用格式。
 *
 * full 的体积控制：长边先限制到 2560（手机屏幕够用，原片 4032 会白占一倍体积），
 * 画质起点 q0.62（JPEG 0.58），超过 900KB 依次降画质到 0.5 / 0.42 / 0.34，
 * 只有极端高纹理照片才再退到 2048。
 *
 * 存 Blob 而不是 base64 dataURL：少 33% 体积，列表渲染也不用解析大字符串。
 */
import type { Photo } from './types'

const THUMB_EDGE = 480
/** 原尺寸图的起始画质，以及体积超标时依次尝试的更低画质。 */
const FULL_QUALITY: Record<EncodeType, number> = { 'image/webp': 0.62, 'image/jpeg': 0.58 }
const FULL_QUALITY_STEPS = [0.5, 0.42, 0.34]
/** 原尺寸图的目标上限：再大就继续降画质，实在降不下来才缩尺寸。 */
const FULL_MAX_BYTES = 900 * 1024
/** 原尺寸图的长边上限：手机屏幕用不到更大的像素，先限尺寸能省一半体积。 */
const FULL_MAX_EDGE = 2560
/** 最后的兜底缩尺寸（只有极端高纹理照片会走到）。 */
const FULL_FALLBACK_EDGES = [2048]

export type EncodeType = 'image/webp' | 'image/jpeg'

/** 每种格式的质量：JPEG 有损更明显，取值略低一点也不损失观感。 */
const THUMB_QUALITY: Record<EncodeType, number> = { 'image/webp': 0.72, 'image/jpeg': 0.7 }

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

/**
 * 主入口：一张原始文件 → 缩略图 + 原尺寸图。
 *
 * 原尺寸图长边限制在 2560 像素（小图保持原样），只降画质；体积超 900KB 时依次降画质，
 * 极端情况（高纹理 / 超大图）才退到 2048。
 */
export async function compressPhoto(file: File): Promise<Photo> {
  const img = await loadImage(file)
  const type = preferredImageType()

  const thumb = drawScaled(img, THUMB_EDGE)
  const thumbBlob = await encode(thumb.canvas, type, THUMB_QUALITY[type])

  const original = drawScaled(img, FULL_MAX_EDGE)
  let fullBlob = await encode(original.canvas, type, FULL_QUALITY[type])
  let fullWidth = original.width
  let fullHeight = original.height

  for (const quality of FULL_QUALITY_STEPS) {
    if (fullBlob.size <= FULL_MAX_BYTES) break
    const next = await encode(original.canvas, type, quality)
    if (next.size < fullBlob.size) fullBlob = next
  }

  for (const edge of FULL_FALLBACK_EDGES) {
    if (fullBlob.size <= FULL_MAX_BYTES) break
    const smaller = drawScaled(img, edge)
    const next = await encode(smaller.canvas, type, 0.5)
    if (next.size < fullBlob.size) {
      fullBlob = next
      fullWidth = smaller.width
      fullHeight = smaller.height
    }
  }

  return { thumb: thumbBlob, full: fullBlob, width: fullWidth, height: fullHeight }
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
