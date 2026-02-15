/**
 * Shared Recharts theme — consistent margins, grid, tooltip styles,
 * and gradient definitions used across all dashboard charts.
 */

export const CHART_MARGINS = { top: 8, right: 8, bottom: 0, left: 0 } as const

export const GRID_STROKE = "hsl(220, 14%, 12%)"
export const GRID_DASH = "3 3"

export const AXIS_STYLE = {
  tickLine: false as const,
  axisLine: false as const,
  tick: { fontSize: 10 },
} as const

export const TOOLTIP_STYLE = {
  contentStyle: {
    background: "hsl(222, 22%, 8%)",
    border: "1px solid hsl(220, 14%, 18%)",
    borderRadius: "8px",
    fontSize: "12px",
  },
  cursor: { stroke: "hsl(215, 15%, 25%)", strokeDasharray: "3 3" },
} as const

/** Standard glow filter props for SVG — renders a soft colored halo behind strokes. */
export function glowFilterDef(id: string, stdDeviation = 3) {
  return {
    id,
    x: "-20%",
    y: "-20%",
    width: "140%",
    height: "140%",
    stdDeviation,
  }
}
