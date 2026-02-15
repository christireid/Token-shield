"use client"

import { useState, useEffect } from "react"

/**
 * Returns `true` when the user has requested reduced motion via OS settings.
 * Components should skip or simplify animations when this is true.
 *
 * Initializes to `false` unconditionally to avoid SSR hydration mismatches,
 * then synchronizes with the media query in useEffect (client-only).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)")
    // Sync initial value on mount
    setReduced(mql.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [])

  return reduced
}
