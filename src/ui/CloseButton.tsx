/** 浮层右上角的圆形关闭按钮：阅读器 / 看图 / 记忆 共用。 */
export function CloseButton({ onClick, label = '关闭' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="overlay-close" aria-label={label} onClick={onClick}>
      ×
    </button>
  )
}
