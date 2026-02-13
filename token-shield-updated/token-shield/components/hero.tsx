export function Hero() {
  return (
    <section className="border-b border-border bg-card">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <svg className="h-5 w-5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
          <span className="font-mono text-lg font-bold text-foreground">TokenShield</span>
        </div>

        <h1 className="mt-6 text-balance text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl sm:leading-tight">
          Cut your LLM costs by 60-80%.
          <br />
          <span className="text-primary">No backend required.</span>
        </h1>

        <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg sm:leading-relaxed">
          11 TypeScript modules that reduce token waste through exact BPE counting,
          holographic caching, context trimming, smart model routing, tool overhead analysis,
          streaming abort tracking, and hard spending limits. Works entirely client-side.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <code className="rounded-lg bg-background px-4 py-2.5 font-mono text-sm text-muted-foreground">
            npm install tokenshield
          </code>
          <span className="text-xs text-muted-foreground">
            2 deps: gpt-tokenizer + idb-keyval
          </span>
        </div>

        {/* Key stats */}
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
          {[
            { value: "11", label: "Modules" },
            { value: "0", label: "Backend needed" },
            { value: "BPE", label: "Exact token encoding" },
            { value: "3", label: "Providers supported" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg bg-background p-3 sm:p-4">
              <p className="font-mono text-xl font-bold text-primary sm:text-2xl">{stat.value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
