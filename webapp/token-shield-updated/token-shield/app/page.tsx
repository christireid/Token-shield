import { Hero } from "@/components/hero"
import { Features } from "@/components/features"
import { LiveDemo } from "@/components/live-demo"
import { CodeSection } from "@/components/code-section"
import { CostProjection } from "@/components/cost-projection"

export default function Page() {
  return (
    <main>
      <Hero />
      <Features />
      <LiveDemo />
      <CodeSection />
      <CostProjection />
    </main>
  )
}
