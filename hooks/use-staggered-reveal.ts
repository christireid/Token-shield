"use client"

import { useState, useEffect } from "react"
import { useReducedMotion } from "./use-reduced-motion"

/**
 * Returns `true` after a staggered delay based on `order`.
 * Used to orchestrate sequential reveal animations on dashboard load.
 *
 * When reduced-motion is preferred, returns `true` immediately.
 */
export function useStaggeredReveal(order: number, baseDelayMs = 120): boolean {
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(reduced)

  useEffect(() => {
    if (reduced) {
      setVisible(true)
      return
    }
    const t = setTimeout(() => setVisible(true), order * baseDelayMs)
    return () => clearTimeout(t)
  }, [order, baseDelayMs, reduced])

  return visible
}
