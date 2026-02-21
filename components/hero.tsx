"use client"

import Link from "next/link"
import { ArrowRight, Github, Copy, Check } from "lucide-react"
import { useState, useCallback } from "react"

export function Hero() {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText("npm install @tokenshield/ai-sdk")
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  return (
    <section className="relative overflow-hidden bg-card">
      {/* Grid background pattern */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: [
            "radial-gradient(ellipse 60% 50% at 20% 0%, hsl(152 60% 52% / 0.06), transparent)",
            "linear-gradient(hsl(215 20% 15% / 0.5) 1px, transparent 1px)",
            "linear-gradient(90deg, hsl(215 20% 15% / 0.5) 1px, transparent 1px)",
          ].join(", "),
          backgroundSize: "100% 100%, 48px 48px, 48px 48px",
        }}
      />

      <div className="relative mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-[0_0_20px_hsl(152,60%,52%,0.3)]">
            <svg
              className="h-5 w-5 text-primary-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
              />
            </svg>
          </div>
          <span className="font-mono text-lg font-bold text-foreground">
            <span className="text-primary">Token</span>Shield
          </span>
        </div>

        {/* Headline */}
        <h1 className="mt-6 text-balance text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl sm:leading-tight">
          Stop overpaying for{" "}
          <span className="inline bg-gradient-to-r from-primary to-[hsl(190,70%,50%)] bg-clip-text text-transparent">
            every LLM call
          </span>
          .
          <br />
          <span className="text-primary drop-shadow-[0_0_20px_hsl(152,60%,52%,0.3)]">
            No backend required.
          </span>
        </h1>

        {/* Description */}
        <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg sm:leading-relaxed">
          Drop-in middleware that reduces AI API costs through fuzzy caching, prompt compression,
          and budget enforcement. Three lines of code. Works with Vercel AI SDK, OpenAI, and
          Anthropic.
        </p>

        {/* npm install command */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="group relative flex items-center gap-3 rounded-lg border-l-2 border-l-primary/50 bg-background px-4 py-2.5 shadow-[inset_0_0_0_1px_hsl(215,20%,20%)]">
            <code className="font-mono text-sm text-muted-foreground">
              npm install @tokenshield/ai-sdk
            </code>
            <button
              onClick={handleCopy}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Copy to clipboard"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <span className="text-xs text-muted-foreground">
            4 deps: gpt-tokenizer, idb-keyval, mitt, valibot
          </span>
        </div>

        {/* CTA buttons */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-[0_0_20px_hsl(152,60%,52%,0.3)]"
          >
            View Live Dashboard
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="https://github.com/christireid/Token-shield"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-all hover:border-primary/50 hover:text-primary hover:shadow-[0_0_20px_hsl(152,60%,52%,0.1)]"
          >
            <Github className="h-4 w-4" />
            View on GitHub
          </Link>
        </div>

        {/* Key stats */}
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
          {[
            { value: "3", label: "Lines to add", gradient: true },
            { value: "0", label: "Config required", gradient: false },
            { value: "<5ms", label: "Middleware overhead", gradient: false },
            { value: "3", label: "SDKs supported", gradient: false },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border-l-2 border-l-primary/30 bg-background p-3 transition-all hover:border-l-primary hover:shadow-[0_0_15px_hsl(152,60%,52%,0.1)] sm:p-4"
            >
              <p
                className={`font-mono text-xl font-black sm:text-2xl ${
                  stat.gradient
                    ? "inline bg-gradient-to-r from-primary to-[hsl(190,70%,50%)] bg-clip-text text-transparent"
                    : "text-primary"
                }`}
              >
                {stat.value}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Decorative gradient line at bottom */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
    </section>
  )
}
