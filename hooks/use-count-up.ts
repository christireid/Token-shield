"use client"

import { useEffect, useRef, useState } from "react"

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

/**
 * Animates a number from its previous value to the new target using
 * requestAnimationFrame with an easeOutExpo curve.
 *
 * When `skip` is true (e.g. reduced-motion), returns the target immediately.
 */
export function useCountUp(target: number, duration = 800, skip = false): number {
  const [current, setCurrent] = useState(target)
  const prevTarget = useRef(target)
  const rafId = useRef<number | null>(null)

  useEffect(() => {
    const from = prevTarget.current
    const to = target
    prevTarget.current = target

    if (from === to || skip) {
      setCurrent(to)
      return
    }

    const startTime = performance.now()

    const tick = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutExpo(progress)
      const value = from + (to - from) * eased

      setCurrent(value)

      if (progress < 1) {
        rafId.current = requestAnimationFrame(tick)
      } else {
        setCurrent(to)
      }
    }

    rafId.current = requestAnimationFrame(tick)

    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current)
      }
    }
  }, [target, duration, skip])

  return current
}
