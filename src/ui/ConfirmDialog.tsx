import { useEffect } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  /** 删除类操作用警示色 */
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * 应用内二次确认框。
 * 不用 window.confirm：部分浏览器 / 独立窗口（PWA）里原生弹窗可能被抑制，
 * 那样删除就变成了"点一下就没了"。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  danger = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="confirm-root" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="confirm-backdrop" aria-label="取消" onClick={onCancel} />
      <div className="confirm-card">
        <h3 className="confirm-title">{title}</h3>
        {message ? <p className="confirm-message">{message}</p> : null}
        <div className="confirm-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={danger ? 'confirm-danger' : 'confirm-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
