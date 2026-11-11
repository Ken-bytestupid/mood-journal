import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  formatBytes,
  markExported,
  readStorageStatus,
  type StorageBackend,
  type StorageStatus,
} from '../core/durability'
import { clockText, dateText, dayKey, groupByDay, startOfWeek, streakDays, weekDayLabel } from '../core/time'
import type { Entry, Polarity } from '../core/types'
import { buildBackupJSON } from '../modules/entries/store'
import { POLARITY_COLOR, emotionById } from '../modules/mood/emotions'
import { BlobImage } from '../ui/BlobImage'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EntryReader } from '../ui/EntryReader'
import { MoodFace } from '../ui/MoodFace'
import { Sheet } from '../ui/Sheet'
import { useToast } from '../ui/Toast'

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

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

/** 列表里的一行。今天 / 本周 共用同一套外观。 */
function EntryRow({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  const emotion = emotionById(entry.emotionId)
  return (
    <button type="button" className="entry" onClick={onOpen}>
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
}

/**
 * 我的页：只看「今天」的记录，统计收进按钮和副标题里。
 * 「本周」抽屉里按星期分组；点开任意一条进居中的翻页阅读器。
 */
export function MinePage({ entries, loading, hidden, backend, onDelete, onClear, onImport, onRestore }: MinePageProps) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [generalOpen, setGeneralOpen] = useState(false)
  const [weekOpen, setWeekOpen] = useState(false)
  const [reader, setReader] = useState<{ items: Entry[]; index: number; origin: 'today' | 'week' } | null>(null)
  const [confirm, setConfirm] = useState<
    { kind: 'delete'; entry: Entry } | { kind: 'clear' } | { kind: 'restore' } | null
  >(null)

  useEffect(() => {
    let alive = true
    void readStorageStatus(backend).then((next) => {
      if (alive) setStatus(next)
    })
    return () => {
      alive = false
    }
  }, [backend])

  useEffect(() => {
    if (!generalOpen) return
    void readStorageStatus(backend).then(setStatus)
  }, [generalOpen, backend])

  const refreshStatus = async () => {
    setStatus(await readStorageStatus(backend))
  }

  const streak = useMemo(() => streakDays(entries.map((entry) => entry.createdAt)), [entries])

  const todayEntries = useMemo(() => {
    const today = dayKey(Date.now())
    return entries.filter((entry) => dayKey(entry.createdAt) === today)
  }, [entries])

  const weekEntries = useMemo(() => {
    const from = startOfWeek()
    return entries.filter((entry) => entry.createdAt >= from)
  }, [entries])

  const weekGroups = useMemo(() => groupByDay(weekEntries), [weekEntries])

  const weekCounts = useMemo(() => {
    const tally: Record<Polarity, number> = { positive: 0, negative: 0, plain: 0 }
    for (const entry of weekEntries) tally[entry.polarity] += 1
    return tally
  }, [weekEntries])

  const classified = weekCounts.positive + weekCounts.negative

  /**
   * 从「本周」打开阅读器时先把抽屉收起来，避免两层叠在一起；
   * 关掉阅读器再回到「本周」，等于"看完翻回目录"。
   */
  const openReader = (items: Entry[], index: number, origin: 'today' | 'week') => {
    if (origin === 'week') setWeekOpen(false)
    setReader({ items, index, origin })
  }

  const closeReader = () => {
    const origin = reader?.origin
    setReader(null)
    if (origin === 'week') setWeekOpen(true)
  }

  const deleteFromReader = (entry: Entry) => {
    setConfirm({ kind: 'delete', entry })
  }

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

  const restoreMirror = () => {
    setConfirm({ kind: 'restore' })
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

  const clearAll = () => {
    if (entries.length === 0) {
      toast('现在就是空的')
      return
    }
    setConfirm({ kind: 'clear' })
  }

  /** 二次确认框里点「删除 / 清空 / 恢复」之后才真正执行。 */
  const runConfirmed = async () => {
    if (!confirm) return
    const action = confirm
    setConfirm(null)

    if (action.kind === 'delete') {
      await onDelete(action.entry.id)
      closeReader()
      toast('已删除')
      return
    }
    if (action.kind === 'clear') {
      await onClear()
      await refreshStatus()
      toast('已清空')
      return
    }
    const added = await onRestore()
    await refreshStatus()
    toast(added > 0 ? `已恢复 ${added} 条记录` : '没有可恢复的记录')
  }

  return (
    <div className="page mine" hidden={hidden}>
      <header className="page-head">
        <h1>我的</h1>
        <p className="page-brand">
          mood &amp; memory · 连续记录 {streak} 天
        </p>
      </header>

      <section className="mood-strip">
        <div className="mood-strip-head">
          <span>本周心情</span>
          <span>
            积极 {weekCounts.positive} · 消极 {weekCounts.negative} · 只是记录 {weekCounts.plain}
          </span>
        </div>
        <div className="mood-bar">
          <span
            style={{
              width: classified === 0 ? '0%' : `${(weekCounts.positive / classified) * 100}%`,
              background: 'var(--pos)',
            }}
          />
          <span
            style={{
              width: classified === 0 ? '0%' : `${(weekCounts.negative / classified) * 100}%`,
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

      <section className="today-block">
        <div className="day-head">
          <span className="day-label">今天</span>
          <span className="day-date">{dateText(Date.now())}</span>
        </div>
        {todayEntries.length === 0 ? (
          <p className="today-empty">{loading ? '正在读取…' : '今天还没有记录，去「记录」写一条吧'}</p>
        ) : (
          todayEntries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onOpen={() => openReader(todayEntries, todayEntries.indexOf(entry), 'today')} />
          ))
        )}
      </section>

      <div className="tile-row">
        <button type="button" className="tile" onClick={() => setWeekOpen(true)}>
          <span className="tile-title">本周</span>
          <span className="tile-count">{weekEntries.length} 条</span>
        </button>
        <button type="button" className="tile" onClick={() => toast('「记忆」还在做，先用「本周」翻翻看')}>
          <span className="tile-title">记忆</span>
          <span className="tile-count">{entries.length} 条</span>
        </button>
      </div>

      <section className="data-card">
        <button type="button" className="data-row" onClick={() => setGeneralOpen(true)}>
          通用
          <small>存储 · 备份 · 清空 ›</small>
        </button>
      </section>

      <Sheet
        open={weekOpen}
        onClose={() => setWeekOpen(false)}
        title="本周"
        footer={
          <button type="button" className="btn-ghost" style={{ width: '100%' }} onClick={() => setWeekOpen(false)}>
            关闭
          </button>
        }
      >
        {weekGroups.length === 0 ? (
          <p className="sheet-empty">本周还没有记录</p>
        ) : (
          weekGroups.map((group) => (
            <section className="day-group" key={group.key}>
              <div className="day-head">
                <span className="day-label">{weekDayLabel(group.ts)}</span>
                <span className="day-date">{dateText(group.ts)}</span>
              </div>
              {group.items.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  onOpen={() => openReader(weekEntries, weekEntries.indexOf(entry), 'week')}
                />
              ))}
            </section>
          ))
        )}
      </Sheet>

      {reader ? (
        <EntryReader
          entries={reader.items}
          index={reader.index}
          onIndexChange={(index) => setReader((current) => (current ? { ...current, index } : current))}
          onClose={closeReader}
          onDelete={deleteFromReader}
        />
      ) : null}

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

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === 'delete'
            ? '删除这条记录？'
            : confirm?.kind === 'clear'
              ? '清空全部记录？'
              : '从文字镜像恢复？'
        }
        message={
          confirm?.kind === 'delete'
            ? '删除后不能恢复，照片也会一起删掉。'
            : confirm?.kind === 'clear'
              ? '所有记录都会被删除，建议先导出备份。这一步不能撤销。'
              : '只会恢复文字，图片需要重新添加。'
        }
        confirmLabel={confirm?.kind === 'clear' ? '清空' : confirm?.kind === 'delete' ? '删除' : '恢复'}
        danger={confirm?.kind !== 'restore'}
        onCancel={() => setConfirm(null)}
        onConfirm={runConfirmed}
      />
    </div>
  )
}
