const MODULES = [
  {
    name: "Token Counter",
    description: "Exact BPE counts using the same encoding OpenAI uses. Matches usage.prompt_tokens within 2 tokens.",
    tag: "Core",
  },
  {
    name: "Cost Estimator",
    description: "Real pricing data for GPT-5.2, Claude Opus 4.5, Gemini 2.5 Pro, and 10 more models. Updated Feb 2026.",
    tag: "Core",
  },
  {
    name: "Context Manager",
    description: "Trim conversation history to fit a token budget. System messages pinned. Auto-summarizes evicted messages.",
    tag: "Saves 40-70%",
  },
  {
    name: "Response Cache",
    description: "Exact + holographic matching via vector resonance. Paraphrased prompts hit cache. IndexedDB persistence.",
    tag: "Saves 100%",
  },
  {
    name: "Model Router",
    description: "Deterministic complexity scoring on 9 signals. Routes trivial queries to budget models automatically.",
    tag: "Saves 80-95%",
  },
  {
    name: "Request Guard",
    description: "Debounce, dedup, rate limit, and cost gate. Every blocked request is 100% savings on that call.",
    tag: "Saves 100%",
  },
  {
    name: "Prefix Optimizer",
    description: "Reorders messages for provider-side prompt caching. OpenAI 50% discount, Anthropic 90% discount.",
    tag: "Saves 50-90%",
  },
  {
    name: "Tool Token Counter",
    description: "Counts the hidden tokens that JSON tool schemas inject per request. Optimizes descriptions to reduce overhead.",
    tag: "Saves ~20%",
  },
  {
    name: "Image Token Counter",
    description: "OpenAI's exact tile formula: 85 base + 170 per 512x512 tile. Recommends optimal resize dimensions.",
    tag: "Saves ~50%",
  },
  {
    name: "Stream Tracker",
    description: "Counts output tokens in real-time during streaming. Survives abort -- solves vercel/ai#7628.",
    tag: "Tracks Costs",
  },
  {
    name: "Circuit Breaker",
    description: "Hard spending limits per session, hour, day, month. Prevents the $847-to-$34K runaway scenario.",
    tag: "Caps Spend",
  },
]

export function Features() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <h2 className="text-balance text-2xl font-bold text-foreground sm:text-3xl">
          11 modules. One import.
        </h2>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Each module works standalone or through the unified AI SDK middleware.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((mod) => (
            <div
              key={mod.name}
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/30"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">{mod.name}</h3>
                <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                  mod.tag === "Core"
                    ? "bg-secondary text-muted-foreground"
                    : "bg-primary/10 text-primary"
                }`}>
                  {mod.tag}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {mod.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
