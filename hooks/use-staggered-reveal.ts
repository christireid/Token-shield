"use client"

import { useState, useEffect, useLayoutEffect } from "react"
import { useReducedMotion } from "./use-reduced-motion"

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

/**
 * Returns `true` after a staggered delay based on `order`.
 * Used to orchestrate sequential reveal animations on dashboard load.
 *
 * When reduced-motion is preferred, returns `true` immediately via
 * useIsomorphicLayoutEffect to avoid a one-frame flash of hidden content.
 */
export function useStaggeredReveal(order: number, baseDelayMs = 120): boolean {
  const reduced = useReducedMotion()
  const [visible, setVisible] = useState(false)

  useIsomorphicLayoutEffect(() => {
    if (reduced) {
      setVisible(true)
      return
    }
    const t = setTimeout(() => setVisible(true), order * baseDelayMs)
    return () => clearTimeout(t)
  }, [order, baseDelayMs, reduced])

  return visible
}
