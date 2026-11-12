/** 浮层右上角的圆形关闭按钮：阅读器 / 看图 / 记忆 共用。 */
export function CloseButton({
  onClick,
  label = '关闭',
  className,
}: {
  onClick: () => void
  label?: string
  /** 额外类名，用于个别浮层调整位置（如记忆页贴住圆环） */
  className?: string
}) {
  return (
    <button
      type="button"
      className={className ? `overlay-close ${className}` : 'overlay-close'}
      aria-label={label}
      onClick={onClick}
    >
      ×
    </button>
  )
}
