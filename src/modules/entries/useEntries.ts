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
      // 每次主库变动后同步一份纯文字镜像，主库被系统清掉时还能捞回来
      writeMirror(list)
      setBackend(await getBackend())
    } catch (error) {
      setError(messageOf(error))
    } finally {
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
