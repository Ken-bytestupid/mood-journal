import { useCallback, useEffect, useRef, useState } from 'react'
import { getBackend } from '../../core/db'
import { writeMirror, type StorageBackend } from '../../core/durability'
import type { Entry, EntryInput } from '../../core/types'
import { clearEntries, createEntry, deleteEntry, importBackup, listEntries, restoreFromMirror } from './store'

export interface EntriesApi {
  entries: Entry[]
  loading: boolean
  error: string | null
  backend: StorageBackend
  save: (input: EntryInput) => Promise<Entry>
  remove: (id: string) => Promise<void>
  clear: () => Promise<void>
  importFrom: (text: string) => Promise<number>
  restore: () => Promise<number>
  reload: () => Promise<void>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 全局唯一的记录状态：记录页写入、我的页读取，两边共享同一份数据。 */
export function useEntries(): EntriesApi {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [backend, setBackend] = useState<StorageBackend>('idb')
  const entriesRef = useRef<Entry[]>([])

  const reload = useCallback(async () => {
    try {
      const list = await listEntries()
      entriesRef.current = list
      setEntries(list)
      setError(null)
      setLoading(false)
      // 文字镜像是兜底用的，不必卡在启动路径上：等首屏空闲再写
      const write = () => writeMirror(list)
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(write, { timeout: 2000 })
      } else {
        window.setTimeout(write, 200)
      }
      setBackend(await getBackend())
    } catch (error) {
      setError(messageOf(error))
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = useCallback(
    async (input: EntryInput) => {
      const entry = await createEntry(input)
      await reload()
      return entry
    },
    [reload],
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteEntry(id)
      await reload()
    },
    [reload],
  )

  const clear = useCallback(async () => {
    await clearEntries()
    await reload()
  }, [reload])

  const importFrom = useCallback(
    async (text: string) => {
      const added = await importBackup(text, entriesRef.current)
      await reload()
      return added
    },
    [reload],
  )

  const restore = useCallback(async () => {
    const added = await restoreFromMirror()
    await reload()
    return added
  }, [reload])

  return { entries, loading, error, backend, save, remove, clear, importFrom, restore, reload }
}
