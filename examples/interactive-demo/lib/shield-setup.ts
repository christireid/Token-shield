import { shield } from "@tokenshield/ai-sdk"

// Initialize Token Shield with budget enforcement for the demo
export const shieldMiddleware = shield({
  cache: true,
  compression: true,
  guard: true,
  trackCosts: true,
  monthlyBudget: 100,
  dailyBudget: 5,
  similarityThreshold: 0.9,
  onUsage: (entry) => {
    console.log(`[shield] $${entry.cost.toFixed(4)} spent, $${entry.saved.toFixed(4)} saved`)
  },
})

// Mock user database for the demo
export const users = [
  { id: "user_team", plan: "team", name: "Team User (Alice)" },
  { id: "user_community", plan: "community", name: "Community User (Bob)" },
]
