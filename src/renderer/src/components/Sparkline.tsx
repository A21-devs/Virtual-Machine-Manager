/**
 * Tiny line chart for the usage history. No axes, the number next to it is the real readout.
 * It stretches to the width of its box, the line keeps its thickness.
 */
export default function Sparkline({ values, max, label }: { values: number[]; max: number; label: string }) {
  const w = 120
  const h = 28
  if (values.length < 2) return <svg width={w} height={h} role="img" aria-label={label} />
  const step = w / (values.length - 1)
  const y = (v: number) => h - 2 - (Math.min(v, max) / max) * (h - 4)
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label} className="spark">
      <path d={`${d} L${w},${h} L0,${h} Z`} className="spark-fill" />
      <path d={d} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
