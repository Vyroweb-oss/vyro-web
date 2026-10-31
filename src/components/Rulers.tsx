// PC3 — page rulers, presentational only. All geometry comes from
// src/lib/ruler.ts (real page size in mm, real margin preset, effective
// scale). DISPLAY-ONLY: no drag handlers, no pointer interaction —
// Word-style drag-to-change-margins is deliberately out of scope, so
// nothing here looks draggable.
import { cmTicks, labelsVisible, marginZones, mmToPx } from '../lib/ruler'

/** Fixed ruler thickness in px (unscaled, like Word's ruler chrome). */
export const RULER_SIZE = 24

interface RulerProps {
  /** Page length along this ruler's axis, in mm. */
  pageMm: number
  /** Document margin preset ('narrow' | 'normal' | 'wide'). */
  marginPreset: string | undefined
  /** Editor effective scale (fitScale × zoom/100). */
  scale: number
  /** Margin in mm, resolved by the caller via marginMmFor. */
  marginMm: number
}

function labelShift(cm: number, maxCm: number): string {
  if (cm === 0) return 'translateX(0)'
  if (cm === maxCm) return 'translateX(-100%)'
  return 'translateX(-50%)'
}

export function HorizontalRuler({ pageMm, scale, marginMm }: RulerProps) {
  const width = mmToPx(pageMm, scale)
  const zones = marginZones(pageMm, marginMm)
  const ticks = cmTicks(pageMm)
  const showLabels = labelsVisible(scale)
  const maxCm = ticks.length ? ticks[ticks.length - 1].cm : 0
  return (
    <div className="ruler ruler-h" role="presentation" aria-hidden="true" style={{ width }}>
      <div className="ruler-zone" style={{ left: 0, width: mmToPx(zones.startMm, scale) }} />
      <div className="ruler-zone" style={{ left: mmToPx(zones.endFromMm, scale), width: mmToPx(pageMm - zones.endFromMm, scale) }} />
      {ticks.map((tick) => {
        const x = mmToPx(tick.mm, scale)
        const labelled = tick.cm % 2 === 0
        return (
          <span key={tick.cm}>
            <span className="ruler-tick ruler-tick-h" style={{ left: x, height: labelled ? 11 : 7 }} />
            {showLabels && labelled && (
              <span className="ruler-label ruler-label-h" style={{ left: x, transform: labelShift(tick.cm, maxCm) }}>
                {tick.cm}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

export function VerticalRuler({ pageMm, scale, marginMm, pagePxH }: RulerProps & { pagePxH: number }) {
  // Height tracks the MEASURED page height (pagePxH, unscaled) × scale —
  // the same value the .page-scaler uses — so the ruler grows with long
  // content exactly like the page does.
  const height = pagePxH * scale
  const zones = marginZones(pageMm, marginMm)
  const ticks = cmTicks(pageMm)
  const showLabels = labelsVisible(scale)
  const maxCm = ticks.length ? ticks[ticks.length - 1].cm : 0
  // Tick positions use the TRUE cm scale (mm × MM_PX × scale), so 1cm
  // on the ruler is 1cm on the page at any zoom. The top margin zone
  // sits at the true margin depth; the bottom zone is anchored to the
  // measured page bottom (the page's bottom padding), because the
  // editor renders one continuous growing page, not paginated sheets —
  // on a long document the ticks cover the nominal sheet height and
  // the ruler below them is blank until the bottom margin zone.
  const y = (mm: number) => mmToPx(mm, scale)
  const bottomZoneH = Math.min(height, mmToPx(pageMm - zones.endFromMm, scale))
  return (
    <div className="ruler ruler-v" role="presentation" aria-hidden="true" style={{ height }}>
      <div className="ruler-zone" style={{ top: 0, height: y(zones.startMm) }} />
      <div className="ruler-zone" style={{ top: height - bottomZoneH, height: bottomZoneH }} />
      {ticks.map((tick) => {
        const top = y(tick.mm)
        const labelled = tick.cm % 2 === 0
        return (
          <span key={tick.cm}>
            <span className="ruler-tick ruler-tick-v" style={{ top, width: labelled ? 11 : 7 }} />
            {showLabels && labelled && (
              <span
                className="ruler-label ruler-label-v"
                style={{ top: tick.cm === 0 ? 0 : tick.cm === maxCm ? undefined : top - 5, bottom: tick.cm === maxCm ? 0 : undefined }}
              >
                {tick.cm}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}
