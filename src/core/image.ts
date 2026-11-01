/** 把用户选的照片压小再存：手机原图动辄 5MB，直接进 IndexedDB 会拖慢列表。 */

const MAX_EDGE = 1600
const QUALITY = 0.82

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

/** 读成 JPEG dataURL，长边不超过 MAX_EDGE。 */
export async function fileToDataURL(file: File): Promise<string> {
  const img = await loadImage(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持图片处理')
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', QUALITY)
}
