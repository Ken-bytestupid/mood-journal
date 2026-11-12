interface RingSectorsProps {
  count: number
  size: number
  innerRadius: number
  outerRadius: number
  /** 当前指向的格数（浮点，0 表示第 0 格在正上方） */
  position: number
  /** 每一格的填充色 */
  fillOf: (index: number) => string
  /** 选中格向外抬起的像素 */
  pop?: number
}

/**
 * 把圆环切成等分的扇形块（带分隔线）。整块会跟着父级的旋转走，
 * 只有离指针最近的那一格沿半径向外抬起，形成「脱离圆环」的效果。
 */
export function RingSectors({
  count,
  size,
  innerRadius,
  outerRadius,
  position,
  fillOf,
  pop = 9,
}: RingSectorsProps) {
  const step = 360 / count
  // 块之间留缝来分隔（不描边）
  const gap = Math.min(2, step * 0.12)
  const half = size / 2

  const point = (deg: number, radius: number) => {
    const rad = (deg * Math.PI) / 180
    return { x: half + radius * Math.sin(rad), y: half - radius * Math.cos(rad) }
  }

  const sectorPath = (index: number) => {
    const a0 = index * step - step / 2 + gap
    const a1 = index * step + step / 2 - gap
    const large = a1 - a0 > 180 ? 1 : 0
    const o0 = point(a0, outerRadius)
    const o1 = point(a1, outerRadius)
    const i1 = point(a1, innerRadius)
    const i0 = point(a0, innerRadius)
    return [
      `M ${o0.x.toFixed(2)} ${o0.y.toFixed(2)}`,
      `A ${outerRadius} ${outerRadius} 0 ${large} 1 ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
      `L ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
      `A ${innerRadius} ${innerRadius} 0 ${large} 0 ${i0.x.toFixed(2)} ${i0.y.toFixed(2)}`,
      'Z',
    ].join(' ')
  }

  return (
    <svg className="memory-ring-svg" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => {
        // 与指针的环形最短距离（格）
        const raw = (((index - position) % count) + count) % count
        const distance = Math.min(raw, count - raw)
        const raise = pop * Math.max(0, 1 - distance)
        const rad = (index * step * Math.PI) / 180
        const tx = Math.sin(rad) * raise
        const ty = -Math.cos(rad) * raise
        return (
          <path
            key={index}
            className="memory-sector"
            d={sectorPath(index)}
            fill={fillOf(index)}
            style={{ transform: `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)` }}
          />
        )
      })}
    </svg>
  )
}
