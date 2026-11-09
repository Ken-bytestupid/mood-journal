import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  formatBytes,
  markExported,
  readStorageStatus,
  type StorageBackend,
  type StorageStatus,
} from '../core/durability'
import { clockText, dayKey, dayTitle, fullText, groupByDay, startOfDay, streakDays } from '../core/time'
import type { Entry, Polarity } from '../core/types'
import { buildBackupJSON } from '../modules/entries/store'
import { POLARITY_COLOR, POLARITY_LABEL, emotionById } from '../modules/mood/emotions'
import { BlobImage } from '../ui/BlobImage'
import { MoodFace } from '../ui/MoodFace'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'

/** 本周从周一开始。 */
function startOfWeek(now: number): number {
  const base = new Date(startOfDay(now))
  const offset = (base.getDay() + 6) % 7
  base.setDate(base.getDate() - offset)
  return base.getTime()
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

interface MinePageProps {
  entries: Entry[]
  loading: boolean
  hidden: boolean
  backend: StorageBackend
  onDelete: (id: string) => Promise<void>
  onClear: () => Promise<void>
  onImport: (text: string) => Promise<number>
  onRestore: () => Promise<number>
}

/** 我的页：历史记录、简单统计、备份。「记录」页只负责写，看历史都在这儿。 */
export function MinePage({ entries, loading, hidden, backend, onDelete, onClear, onImport, onRestore }: MinePageProps) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<Entry | null>(null)
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [generalOpen, setGeneralOpen] = useState(false)

  useEffect(() => {
    let alive = true
    void readStorageStatus(backend).then((next) => {
      if (alive) setStatus(next)
    })
    return () => {
      alive = false
    }
  }, [backend, entries.length])

  // 打开「通用」时刷新一次存储状态，避免看到旧数字
  useEffect(() => {
    if (!generalOpen) return
    void readStorageStatus(backend).then(setStatus)
  }, [generalOpen, backend])

  const refreshStatus = async () => {
    setStatus(await readStorageStatus(backend))
  }

  const groups = useMemo(() => groupByDay(entries), [entries])

  const streak = useMemo(() => streakDays(entries.map((entry) => entry.createdAt)), [entries])

  const weekCount = useMemo(() => {
    const weekStart = startOfWeek(Date.now())
    return entries.filter((entry) => entry.createdAt >= weekStart).length
  }, [entries])

  const counts = useMemo(() => {
    const tally: Record<Polarity, number> = { positive: 0, negative: 0, plain: 0 }
    for (const entry of entries) tally[entry.polarity] += 1
    return tally
  }, [entries])

  const classified = counts.positive + counts.negative

  /** 导出优先走系统分享（iOS 上可以直接存进「文件」App / iCloud 云盘），不支持再退回下载。 */
  const exportBackup = async () => {
    if (entries.length === 0) {
      toast('还没有记录可以导出')
      return
    }
    const name = `随记-${dayKey(Date.now())}.json`
    const file = new File([await buildBackupJSON(entries)], name, { type: 'application/json' })
    const shareApi = navigator as Navigator & {
      canShare?: (data: ShareData) => boolean
      share?: (data: ShareData) => Promise<void>
    }

    if (shareApi.canShare?.({ files: [file] }) && typeof shareApi.share === 'function') {
      try {
        await shareApi.share({ files: [file], title: '随记备份' })
        markExported()
        await refreshStatus()
        toast('已保存到你选择的位置')
        return
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
        /* 分享失败就退回下载 */
      }
    }

    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    markExported()
    await refreshStatus()
    toast('已导出备份文件')
  }

  const restoreMirror = async () => {
    if (!window.confirm('从本机文字镜像恢复？图片不会回来，需要重新添加。')) return
    const added = await onRestore()
    await refreshStatus()
    toast(added > 0 ? `已恢复 ${added} 条记录` : '没有可恢复的记录')
  }

  const importBackupFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const added = await onImport(text)
      await refreshStatus()
      toast(added > 0 ? `已导入 ${added} 条记录` : '没有新的记录')
    } catch (error) {
      toast(error instanceof Error ? error.message : '导入失败')
    }
  }

  const clearAll = async () => {
    if (entries.length === 0) {
      toast('现在就是空的')
      return
    }
    if (!window.confirm('清空全部记录？建议先导出备份，这一步不能撤销。')) return
    await onClear()
    await refreshStatus()
    toast('已清空')
  }

  const deleteSelected = async () => {
    if (!selected) return
    if (!window.confirm('删除这条记录？')) return
    await onDelete(selected.id)
    setSelected(null)
    toast('已删除')
  }

  return (
    <div className="page mine" hidden={hidden}>
      <header className="page-head">
        <h1>我的</h1>
        <p className="page-brand">
          mood <span className="brand-amp">&amp;</span> memory
        </p>
      </header>

      <section className="stats">
        <div className="stat">
          <div className="stat-value">{entries.length}</div>
          <div className="stat-label">记录总数</div>
        </div>
        <div className="stat">
          <div className="stat-value">{streak}</div>
          <div className="stat-label">连续天数</div>
        </div>
        <div className="stat">
          <div className="stat-value">{weekCount}</div>
          <div className="stat-label">本周</div>
        </div>
      </section>

      <section className="mood-strip">
        <div className="mood-strip-head">
          <span>心情分布</span>
          <span>
            积极 {counts.positive} · 消极 {counts.negative} · 只是记录 {counts.plain}
          </span>
        </div>
        <div className="mood-bar">
          <span
            style={{
              width: classified === 0 ? '0%' : `${(counts.positive / classified) * 100}%`,
              background: 'var(--pos)',
            }}
          />
          <span
            style={{
              width: classified === 0 ? '0%' : `${(counts.negative / classified) * 100}%`,
              background: 'var(--neg)',
            }}
          />
        </div>
      </section>

      {status && status.mirrorCount > 0 && entries.length === 0 ? (
        <div className="recover">
          <span>本机还留着一份文字备份（{status.mirrorCount} 条），可以恢复，图片需要重新添加。</span>
          <button type="button" className="recover-btn" onClick={restoreMirror}>
            恢复
          </button>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="empty">
          <svg className="empty-illustration" viewBox="0 0 96 96" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="22" y="14" width="52" height="68" rx="8" />
              <path d="M34 34h28M34 46h28M34 58h16" />
            </g>
          </svg>
          {loading ? '正在读取记录…' : '还没有记录，去「记录」写第一条吧'}
        </div>
      ) : (
        groups.map((group) => (
          <section className="day-group" key={group.key}>
            <div className="day-head">
              <span className="day-label">{group.label}</span>
              <span className="day-date">{dayTitle(group.ts)}</span>
            </div>
            {group.items.map((entry) => {
              const emotion = emotionById(entry.emotionId)
              return (
                <button type="button" className="entry" key={entry.id} onClick={() => setSelected(entry)}>
                  <span className="entry-mood" style={{ color: POLARITY_COLOR[entry.polarity] }}>
                    {emotion ? (
                      <span className="entry-emoji">{emotion.emoji}</span>
                    ) : (
                      <MoodFace polarity={entry.polarity} className="entry-face" />
                    )}
                  </span>
                  <span className="entry-main">
                    <span className="entry-top">
                      <span className="entry-time">{clockText(entry.createdAt)}</span>
                      {entry.title ? <span className="entry-title">{entry.title}</span> : null}
                    </span>
                    {entry.text ? <span className="entry-text">{entry.text}</span> : null}
                    {entry.photos.length > 0 ? (
                      <span className="entry-photos">
                        {entry.photos.slice(0, 3).map((photo, index) => (
                          <BlobImage key={index} blob={photo.thumb} alt={`照片 ${index + 1}`} />
                        ))}
                      </span>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </section>
        ))
      )}

      <section className="data-card">
        <button type="button" className="data-row" onClick={() => setGeneralOpen(true)}>
          通用
          <small>存储 · 备份 · 清空 ›</small>
        </button>
      </section>

      <Sheet
        open={generalOpen}
        onClose={() => setGeneralOpen(false)}
        title="通用"
        footer={
          <button type="button" className="btn-ghost" style={{ width: '100%' }} onClick={() => setGeneralOpen(false)}>
            关闭
          </button>
        }
      >
        <section className="storage-card">
          <div className="storage-head">
            <span>数据与存储</span>
            <span className="storage-badge">{backend === 'idb' ? '本机数据库' : '兼容模式'}</span>
          </div>
          <div className="storage-rows">
            <div className="storage-row">
              <span>持久化</span>
              <span>
                {status === null
                  ? '读取中…'
                  : status.persisted === true
                    ? '已申请'
                    : status.persisted === false
                      ? '未授权'
                      : '不支持'}
              </span>
            </div>
            <div className="storage-row">
              <span>已用空间</span>
              <span>
                {status
                  ? `${formatBytes(status.usage)}${status.quota > 0 ? ` / ${formatBytes(status.quota)}` : ''}`
                  : '读取中…'}
              </span>
            </div>
            <div className="storage-row">
              <span>文字镜像</span>
              <span>
                {status
                  ? `${status.mirrorCount} 条 · ${status.mirrorSavedAt ? timeAgo(status.mirrorSavedAt) : '—'}`
                  : '读取中…'}
              </span>
            </div>
            <div className="storage-row">
              <span>照片格式</span>
              <span>
                {status === null
                  ? '读取中…'
                  : status.photoType === 'image/webp'
                    ? 'WebP（更省空间）'
                    : 'JPEG（兼容模式）'}
              </span>
            </div>
            <div className="storage-row">
              <span>上次导出</span>
              <span>{status?.lastExportAt ? timeAgo(status.lastExportAt) : '从未'}</span>
            </div>
          </div>
          <p className="storage-note">
            {status?.persisted === true
              ? '浏览器已承诺不会因为长期闲置而清理你的数据。'
              : '还没有拿到持久化承诺：把应用「添加到主屏幕」后，系统才会长期保留这些记录。'}
          </p>
        </section>

        <section className="data-card">
          <button type="button" className="data-row" onClick={exportBackup}>
            导出备份
            <small>存成 JSON 文件</small>
          </button>
          <button type="button" className="data-row" onClick={() => fileRef.current?.click()}>
            导入备份
            <small>合并，不会覆盖已有</small>
          </button>
          <button type="button" className="data-row danger" onClick={clearAll}>
            清空全部记录
            <small>不可撤销</small>
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importBackupFile} />
        </section>
      </Sheet>

      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="这条记录"
        footer={
          <div className="sheet-actions">
            <button type="button" className="btn-ghost" onClick={() => setSelected(null)}>
              关闭
            </button>
            <button type="button" className="btn-danger" onClick={deleteSelected}>
              删除
            </button>
          </div>
        }
      >
        {selected ? (
          <>
            <div className="detail-meta">
              <MoodFace
                polarity={selected.polarity}
                className="detail-face"
                style={{ color: POLARITY_COLOR[selected.polarity] }}
              />
              <span>{POLARITY_LABEL[selected.polarity]}</span>
              {emotionById(selected.emotionId) ? (
                <>
                  <span>·</span>
                  <span>
                    {emotionById(selected.emotionId)?.emoji} {emotionById(selected.emotionId)?.label}
                  </span>
                </>
              ) : null}
              <span>·</span>
              <span>{fullText(selected.createdAt)}</span>
            </div>
            {selected.title ? <h3 className="detail-title">{selected.title}</h3> : null}
            {selected.text ? <p className="detail-text">{selected.text}</p> : null}
            {selected.photos.length > 0 ? (
              <div className="detail-photos">
                {selected.photos.map((photo, index) => (
                  <BlobImage key={index} blob={photo.view} alt={`照片 ${index + 1}`} />
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </div>
  )
}
