import { useCallback, useEffect, useState } from 'react'
import { requestPersistence } from './core/durability'
import type { EntryInput } from './core/types'
import { useEntries } from './modules/entries/useEntries'
import { MinePage } from './pages/MinePage'
import { RecordPage } from './pages/RecordPage'

type Tab = 'record' | 'mine'

export default function App() {
  const [tab, setTab] = useState<Tab>('record')
  const { entries, loading, backend, save, remove, clear, importFrom, restore } = useEntries()

  // 主动申请持久化：能拿到的话，浏览器不会因为「很久没打开」清掉记录
  useEffect(() => {
    void requestPersistence()
  }, [])

  const handleSave = useCallback((input: EntryInput) => save(input), [save])

  return (
    <div className="app">
      <main className="main">
        {/* 两个页面都保持挂载：切到「我的」再回来，正在写的内容不会丢 */}
        <RecordPage onSave={handleSave} hidden={tab !== 'record'} />
        <MinePage
          entries={entries}
          loading={loading}
          hidden={tab !== 'mine'}
          backend={backend}
          onDelete={remove}
          onClear={clear}
          onImport={importFrom}
          onRestore={restore}
        />
      </main>

      <nav className="tabbar" role="tablist" aria-label="主导航">
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab === 'record'}
          onClick={() => setTab('record')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L5.5 15.5v4Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
          记录
        </button>
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={tab === 'mine'}
          onClick={() => setTab('mine')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <circle cx="12" cy="8.5" r="3.7" />
              <path d="M5 20c0-3.4 3.1-5.6 7-5.6s7 2.2 7 5.6" />
            </g>
          </svg>
          我的
        </button>
      </nav>
    </div>
  )
}
