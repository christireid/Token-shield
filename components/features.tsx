import {
  Hash,
  DollarSign,
  Scissors,
  Database,
  GitBranch,
  ShieldCheck,
  Layers,
  Wrench,
  Image,
  Activity,
  Zap,
  type LucideIcon,
} from "lucide-react"

const MODULES: {
  name: string
  description: string
  tag: string
  icon: LucideIcon
}[] = [
  {
    name: "Token Counter",
    description:
      "Exact BPE counts using the same encoding OpenAI uses. Matches usage.prompt_tokens within 2 tokens.",
    tag: "Core",
    icon: Hash,
  },
  {
    name: "Cost Estimator",
    description:
      "Real pricing data for GPT-4o, Claude Sonnet, Gemini 2.5 Pro, and 20+ more models. Updated automatically.",
    tag: "Core",
    icon: DollarSign,
  },
  {
    name: "Context Manager",
    description:
      "Trim conversation history to fit a token budget. System messages pinned. Auto-summarizes evicted messages.",
    tag: "Saves 40-70%",
    icon: Scissors,
  },
  {
    name: "Response Cache",
    description:
      "Exact + fuzzy matching via bigram similarity. Rephrased prompts hit cache. IndexedDB persistence.",
    tag: "Saves 100%",
    icon: Database,
  },
  {
    name: "Model Router",
    description:
      "Deterministic complexity scoring on 9 signals. Routes trivial queries to budget models automatically.",
    tag: "Saves 80-95%",
    icon: GitBranch,
  },
  {
    name: "Request Guard",
    description:
      "Debounce, dedup, rate limit, and cost gate. Every blocked request is 100% savings on that call.",
    tag: "Saves 100%",
    icon: ShieldCheck,
  },
  {
    name: "Prefix Optimizer",
    description:
      "Reorders messages for provider-side prompt caching. OpenAI 50% discount, Anthropic 90% discount.",
    tag: "Saves 50-90%",
    icon: Layers,
  },
  {
    name: "Tool Token Counter",
    description:
      "Counts the hidden tokens that JSON tool schemas inject per request. Optimizes descriptions to reduce overhead.",
    tag: "New",
    icon: Wrench,
  },
  {
    name: "Image Token Counter",
    description:
      "OpenAI's exact tile formula: 85 base + 170 per 512x512 tile. Recommends optimal resize dimensions.",
    tag: "New",
    icon: Image,
  },
  {
    name: "Stream Tracker",
    description:
      "Counts output tokens in real-time during streaming. Survives abort -- solves vercel/ai#7628.",
    tag: "New",
    icon: Activity,
  },
  {
    name: "Circuit Breaker",
    description:
      "Hard spending limits per session, hour, day, month. Prevents the $847-to-$34K runaway scenario.",
    tag: "New",
    icon: Zap,
  },
]

function getTagType(tag: string): "saves" | "core" | "new" {
  if (tag.startsWith("Saves")) return "saves"
  if (tag === "Core") return "core"
  return "new"
}

function cardClasses(tag: string): string {
  const type = getTagType(tag)

  const borderAccent =
    type === "saves"
      ? "border-l-2 border-l-primary/40"
      : type === "core"
        ? "border-l-2 border-l-[hsl(190,70%,50%)]/40"
        : "border-l-2 border-l-[hsl(270,60%,60%)]/40"

  const hoverGlow =
    type === "saves"
      ? "hover:shadow-[0_0_15px_hsl(152,60%,52%,0.08)]"
      : type === "core"
        ? "hover:shadow-[0_0_15px_hsl(190,70%,50%,0.08)]"
        : "hover:shadow-[0_0_15px_hsl(270,60%,60%,0.08)]"

  return `rounded-lg border border-border bg-card p-4 transition-all duration-300 hover:border-primary/30 ${borderAccent} ${hoverGlow}`
}

function iconContainerClasses(tag: string): string {
  const type = getTagType(tag)

  if (type === "saves") return "flex h-7 w-7 items-center justify-center rounded-md bg-primary/10"
  if (type === "core")
    return "flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(190,70%,50%)]/10"
  return "flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(270,60%,60%)]/10"
}

function iconClasses(tag: string): string {
  const type = getTagType(tag)

  if (type === "saves") return "h-3.5 w-3.5 text-primary"
  if (type === "core") return "h-3.5 w-3.5 text-[hsl(190,70%,50%)]"
  return "h-3.5 w-3.5 text-[hsl(270,60%,60%)]"
}

function badgeClasses(tag: string): string {
  const type = getTagType(tag)

  const base = "shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-medium"

  if (type === "new")
    return `${base} border-[hsl(270,60%,60%)]/25 bg-[hsl(270,60%,60%)]/15 text-[hsl(270,60%,60%)]`
  if (type === "core")
    return `${base} border-[hsl(190,70%,50%)]/25 bg-[hsl(190,70%,50%)]/10 text-[hsl(190,70%,50%)]`
  return `${base} border-primary/25 bg-primary/10 text-primary`
}

export function Features() {
  return (
    <section className="border-b-0">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <h2 className="text-balance text-2xl font-black sm:text-3xl">
          <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Every module.
          </span>
          <br />
          <span className="text-muted-foreground">One import.</span>
        </h2>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Each module works standalone or through the unified{" "}
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">shield()</code>{" "}
          middleware.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((mod) => {
            const Icon = mod.icon
            return (
              <div key={mod.name} className={cardClasses(mod.tag)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={iconContainerClasses(mod.tag)}>
                      <Icon className={iconClasses(mod.tag)} />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">{mod.name}</h3>
                  </div>
                  <span className={badgeClasses(mod.tag)}>{mod.tag}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {mod.description}
                </p>
              </div>
            )
          })}
        </div>

        <div className="mt-12 h-px bg-gradient-to-r from-transparent via-border/50 to-transparent" />
      </div>
    </section>
  )
}
