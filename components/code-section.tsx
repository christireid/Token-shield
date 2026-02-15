import { CodeExamples } from "./code-examples"

export function CodeSection() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <h2 className="text-balance text-2xl font-bold text-foreground sm:text-3xl">
          How each module works
        </h2>
        <p className="mt-2 mb-8 text-sm text-muted-foreground sm:text-base">
          Copy-paste examples for every module. Each one works independently or combined through the
          middleware.
        </p>
        <CodeExamples />
      </div>
    </section>
  )
}
