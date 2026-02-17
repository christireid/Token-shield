import { Playground } from "./playground"

export function LiveDemo() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <h2 className="text-balance text-2xl font-bold text-foreground sm:text-3xl">
          Live proof. Real API calls.
        </h2>
        <p className="mt-2 mb-8 text-sm text-muted-foreground sm:text-base">
          Tests across every module. API tests hit OpenAI and return real{" "}
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">usage</code> objects.
          Client-side tests use exact BPE encoding.
        </p>
        <Playground />
      </div>
    </section>
  )
}
