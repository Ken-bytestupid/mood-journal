import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type ShowToast = (message: string) => void

const ToastContext = createContext<ShowToast>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = useCallback<ShowToast>((next) => {
    setMessage(next)
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMessage(null), 2200)
  }, [])

  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
  }, [])

  const value = useMemo(() => show, [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast" data-open={message !== null ? 'true' : 'false'} role="status" aria-live="polite">
        {message ?? ''}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ShowToast {
  return useContext(ToastContext)
}
