import { useEffect, useState } from 'react'

interface BlobImageProps {
  blob: Blob
  alt: string
  className?: string
}

/**
 * Blob 转 object URL 显示，卸载时释放。
 * 直接 <img src={dataURL}> 会一直持有大字符串，列表里几十张就明显卡。
 */
export function BlobImage({ blob, alt, className }: BlobImageProps) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  if (!url) return null
  return <img src={url} alt={alt} className={className} loading="lazy" decoding="async" />
}
