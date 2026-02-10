import mitt from 'mitt';

export type TokenShieldEvents = {
  'request:blocked': { reason: string; estimatedCost: number };
  'request:allowed': { prompt: string; model: string };
  'cache:hit': { matchType: 'exact' | 'fuzzy'; similarity: number; savedCost: number };
  'cache:miss': { prompt: string };
  'cache:store': { prompt: string; model: string };
  'context:trimmed': { originalTokens: number; trimmedTokens: number; savedTokens: number };
  'router:downgraded': { originalModel: string; selectedModel: string; complexity: number; savedCost: number };
  'ledger:entry': { model: string; inputTokens: number; outputTokens: number; cost: number; saved: number };
  'breaker:warning': { limitType: string; currentSpend: number; limit: number; percentUsed: number };
  'breaker:tripped': { limitType: string; currentSpend: number; limit: number; action: string };
  'userBudget:warning': { userId: string; limitType: string; currentSpend: number; limit: number; percentUsed: number };
  'userBudget:exceeded': { userId: string; limitType: string; currentSpend: number; limit: number };
  'userBudget:spend': { userId: string; cost: number; model: string };
  'stream:chunk': { outputTokens: number; estimatedCost: number };
  'stream:abort': { inputTokens: number; outputTokens: number; estimatedCost: number };
  'stream:complete': { inputTokens: number; outputTokens: number; totalCost: number };
};

export const shieldEvents = mitt<TokenShieldEvents>();

export function createEventBus() {
  return mitt<TokenShieldEvents>();
}
