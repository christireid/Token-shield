import { describe, it, expect, beforeEach } from "vitest"
import { PromptTemplatePool } from "../prompt-template-pool"

describe("prompt-template-pool", () => {
  let pool: PromptTemplatePool

  beforeEach(() => {
    pool = new PromptTemplatePool()
  })

  describe("register", () => {
    it("should register a template with variables", () => {
      const compiled = pool.register(
        "summarize",
        "Summarize this text:\n\n{{text}}\n\nProvide a {{length}} summary."
      )
      expect(compiled.name).toBe("summarize")
      expect(compiled.variables).toEqual(["text", "length"])
      expect(compiled.staticTokens).toBeGreaterThan(0)
    })

    it("should register a template with no variables", () => {
      const compiled = pool.register("greeting", "Hello, how can I help you today?")
      expect(compiled.variables).toEqual([])
      expect(compiled.staticTokens).toBeGreaterThan(0)
    })

    it("should handle templates with adjacent variables", () => {
      const compiled = pool.register("combo", "{{first}}{{second}}")
      expect(compiled.variables).toEqual(["first", "second"])
    })

    it("should correctly render adjacent variables (no empty-segment confusion)", () => {
      // Regression: previously, empty static segments between adjacent variables
      // had tokens.length === 0 and were misidentified as variable segments
      pool.register("adj", "{{a}}{{b}}")
      const result = pool.render("adj", { a: "hello", b: "world" })
      expect(result.rendered).toBe("helloworld")
      expect(result.dynamicTokens).toBeGreaterThan(0)
      expect(result.staticTokens).toBe(0)
    })

    it("should handle whitespace in variable delimiters", () => {
      const compiled = pool.register("spaced", "Hello {{ name }}, welcome to {{ place }}!")
      expect(compiled.variables).toEqual(["name", "place"])
    })
  })

  describe("render", () => {
    it("should render a template with correct token count", () => {
      pool.register(
        "qa",
        "Answer this question:\n\n{{question}}\n\nBe concise."
      )

      const result = pool.render("qa", { question: "What is 2+2?" })
      expect(result.rendered).toContain("What is 2+2?")
      expect(result.rendered).toContain("Answer this question:")
      expect(result.rendered).toContain("Be concise.")
      expect(result.totalTokens).toBeGreaterThan(0)
      expect(result.staticTokens).toBeGreaterThan(0)
      expect(result.dynamicTokens).toBeGreaterThan(0)
    })

    it("should count static tokens from cache (not re-encoding)", () => {
      pool.register("test", "Static prefix: {{value}} static suffix")

      const result1 = pool.render("test", { value: "x" })
      const result2 = pool.render("test", { value: "a long dynamic value with many more tokens" })

      // Static token counts should be identical (from cache)
      expect(result1.staticTokens).toBe(result2.staticTokens)
      // Dynamic tokens differ because the values are different lengths
      expect(result2.dynamicTokens).toBeGreaterThan(result1.dynamicTokens)
    })

    it("should throw for unregistered template", () => {
      expect(() => pool.render("nonexistent", {})).toThrow(
        'Template "nonexistent" not registered'
      )
    })

    it("should throw for missing variables", () => {
      pool.register("test", "Hello {{name}}, welcome to {{place}}!")
      expect(() => pool.render("test", { name: "Alice" })).toThrow(
        "Missing template variables: place"
      )
    })

    it("should track encoding efficiency", () => {
      pool.register("test", "A very long static prefix that doesn't change between calls: {{input}}")

      const result = pool.render("test", { input: "short" })
      // Most of the text is static, so encoding efficiency should be low
      expect(result.encodingEfficiency).toBeLessThan(1)
      expect(result.encodedChars).toBeLessThan(result.totalChars)
    })
  })

  describe("countTokens", () => {
    it("should count tokens without rendering", () => {
      pool.register("test", "Prefix {{value}} suffix")
      const count = pool.countTokens("test", { value: "hello world" })
      expect(count).toBeGreaterThan(0)

      // Should match render token count
      const rendered = pool.render("test", { value: "hello world" })
      expect(count).toBe(rendered.totalTokens)
    })
  })

  describe("LRU eviction", () => {
    it("should evict a template when at capacity", () => {
      const small = new PromptTemplatePool({ maxTemplates: 3 })
      small.register("t1", "Template one {{a}}")
      small.register("t2", "Template two {{b}}")
      small.register("t3", "Template three {{c}}")

      // Adding t4 should evict one template (the LRU by lastUsed)
      small.register("t4", "Template four {{d}}")

      expect(small.names()).toHaveLength(3)
      expect(small.has("t4")).toBe(true)
      // One of the original 3 should have been evicted
      const remaining = ["t1", "t2", "t3"].filter(n => small.has(n))
      expect(remaining).toHaveLength(2)
    })
  })

  describe("stats", () => {
    it("should return correct statistics", () => {
      pool.register("t1", "Hello {{name}}!")
      pool.register("t2", "Goodbye {{name}}!")
      pool.render("t1", { name: "Alice" })
      pool.render("t1", { name: "Bob" })
      pool.render("t2", { name: "Carol" })

      const stats = pool.stats()
      expect(stats.templates).toBe(2)
      expect(stats.totalUses).toBe(3)
      expect(stats.mostUsed?.name).toBe("t1")
      expect(stats.mostUsed?.uses).toBe(2)
    })
  })

  describe("clear and remove", () => {
    it("should clear all templates", () => {
      pool.register("t1", "Hello {{name}}")
      pool.clear()
      expect(pool.names()).toHaveLength(0)
    })

    it("should remove a specific template", () => {
      pool.register("t1", "Hello {{name}}")
      pool.register("t2", "Goodbye {{name}}")
      expect(pool.remove("t1")).toBe(true)
      expect(pool.has("t1")).toBe(false)
      expect(pool.has("t2")).toBe(true)
    })
  })
})
