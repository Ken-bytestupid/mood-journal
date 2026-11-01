import { useEffect, type ReactNode } from 'react'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
}

/**
 * 底部弹层。始终挂载，靠 data-open 触发进出场动画，
 * 关闭时 visibility:hidden 会把里面的按钮移出 tab 顺序。
 */
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  return (
    <div className="sheet-root" data-open={open ? 'true' : 'false'}>
      <button type="button" className="sheet-backdrop" aria-label="关闭" onClick={onClose} />
      <div className="sheet-panel" role="dialog" aria-modal="true" aria-label={title ?? '弹层'}>
        <div className="sheet-grip" />
        {title ? <h2 className="sheet-title">{title}</h2> : null}
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-footer">{footer}</div> : null}
      </div>
    </div>
  )
}
