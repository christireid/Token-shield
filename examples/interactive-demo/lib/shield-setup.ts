import { tokenShieldMiddleware } from "@tokenshield/ai-sdk"

// Initialize the shield with all interactive modules enabled
export const shield = tokenShieldMiddleware({
  modules: {
    cache: true, // Enable semantic caching
    guard: true, // Enable rate limiting
    ledger: true, // Enable cost tracking
    breaker: true, // Enable circuit breaker
    context: true, // Enable context compression
  },
  guard: {
    maxCostPerHour: 5.0, // $5/hr limit for demo
    maxRequestsPerMinute: 60,
  },
  cache: {
    similarityThreshold: 0.9,
    ttlMs: 60 * 60 * 1000, // 1 hour
  },
  userBudget: {
    budgets: {
      defaultDailyBudget: 1.0, // $1.00 per user per day
    },
  },
})

// Mock user database for the demo
export const users = [
  { id: "user_pro", plan: "pro", name: "Pro User (Alice)" },
  { id: "user_free", plan: "free", name: "Free User (Bob)" },
]
