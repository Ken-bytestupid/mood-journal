/**
 * 本机存储层：IndexedDB 为主，隐私模式 / 旧浏览器自动退回 localStorage。
 * 业务模块只调用这里的函数，不关心底层是哪一个。
 */
import type { Entry } from './types'

const DB_NAME = 'mood-journal'
const DB_VERSION = 1
const STORE = 'entries'
const LS_KEY = 'mood-journal:entries:v1'

type Backend = 'idb' | 'ls'

let openPromise: Promise<IDBDatabase> | null = null
let backend: Backend | null = null

function openDB(): Promise<IDBDatabase> {
  if (openPromise) return openPromise
  openPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      reject(new Error('indexedDB 不可用'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexedDB 打开失败'))
  })
  return openPromise
}

async function resolveBackend(): Promise<Backend> {
  if (backend) return backend
  try {
    await openDB()
    backend = 'idb'
  } catch {
    backend = 'ls'
  }
  return backend
}

function lsRead(): Entry[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Entry[]) : []
  } catch {
    return []
  }
}

function lsWrite(items: Entry[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(items))
}

async function idbRequest<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDB()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const request = run(transaction.objectStore(STORE))
    request.onsuccess = () => resolve(request.result as T)
    request.onerror = () => reject(request.error ?? new Error('存储操作失败'))
  })
}

export async function readAll(): Promise<Entry[]> {
  const mode = await resolveBackend()
  if (mode === 'ls') return lsRead().sort((a, b) => b.createdAt - a.createdAt)
  try {
    const all = await idbRequest<Entry[]>('readonly', (store) => store.getAll())
    return all.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return lsRead().sort((a, b) => b.createdAt - a.createdAt)
  }
}

export async function writeOne(entry: Entry): Promise<void> {
  const mode = await resolveBackend()
  if (mode === 'ls') {
    const items = lsRead().filter((item) => item.id !== entry.id)
    items.push(entry)
    lsWrite(items)
    return
  }
  await idbRequest<IDBValidKey>('readwrite', (store) => store.put(entry))
}

export async function removeOne(id: string): Promise<void> {
  const mode = await resolveBackend()
  if (mode === 'ls') {
    lsWrite(lsRead().filter((item) => item.id !== id))
    return
  }
  await idbRequest<undefined>('readwrite', (store) => store.delete(id) as unknown as IDBRequest)
}

export async function removeAll(): Promise<void> {
  const mode = await resolveBackend()
  if (mode === 'ls') {
    lsWrite([])
    return
  }
  await idbRequest<undefined>('readwrite', (store) => store.clear() as unknown as IDBRequest)
}

/** 备份用：把所有记录写回本机存储（导入时使用）。 */
export async function writeMany(entries: Entry[]): Promise<void> {
  for (const entry of entries) await writeOne(entry)
}

/** 当前实际使用的存储后端，供「存储状态」展示。 */
export async function getBackend(): Promise<Backend> {
  return resolveBackend()
}
