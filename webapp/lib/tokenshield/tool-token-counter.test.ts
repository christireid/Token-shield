import { describe, it, expect } from "vitest";
import {
  countToolTokens,
  optimizeToolDefinitions,
  countImageTokens,
  predictOutputTokens,
  type ToolDefinition,
} from "./tool-token-counter";

// -----------------------------------------------------------------------
// Shared fixtures
// -----------------------------------------------------------------------

const sampleTool: ToolDefinition = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a location",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "The city name" },
        unit: { type: "string", enum: ["celsius", "fahrenheit"] },
      },
      required: ["location"],
    },
  },
};

const toolWithLongDescription: ToolDefinition = {
  type: "function",
  function: {
    name: "search_database",
    description:
      "This function searches the entire database for records that match the given query parameters. It supports full-text search, filtering by date range, pagination, and sorting by multiple fields. Results are returned in JSON format with metadata.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The search query string to find matching records in the database",
        },
        limit: { type: "number", description: "limit" },
        offset: { type: "number", description: "The offset" },
      },
      required: ["query"],
    },
  },
};

const minimalTool: ToolDefinition = {
  type: "function",
  function: {
    name: "ping",
  },
};

// -----------------------------------------------------------------------
// countToolTokens
// -----------------------------------------------------------------------

describe("countToolTokens", () => {
  // -----------------------------------------------------------------------
  // 1. Empty array returns 0 tokens
  // -----------------------------------------------------------------------
  it("returns 0 tokens for an empty tool array", () => {
    const result = countToolTokens([]);
    expect(result.totalTokens).toBe(0);
    expect(result.perTool).toEqual([]);
    expect(result.overheadTokens).toBe(0);
    expect(result.costPerRequest).toBe(0);
    expect(result.costOverRequests(1000)).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 2. Simple function returns positive tokens
  // -----------------------------------------------------------------------
  it("returns a positive token count for a simple tool definition", () => {
    const result = countToolTokens([sampleTool]);
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.perTool).toHaveLength(1);
    expect(result.perTool[0].name).toBe("get_weather");
    expect(result.perTool[0].tokens).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 3. Includes namespace overhead
  // -----------------------------------------------------------------------
  it("includes namespace overhead tokens", () => {
    const result = countToolTokens([sampleTool]);
    expect(result.overheadTokens).toBeGreaterThan(0);
    // totalTokens should be per-tool tokens + overhead
    const sumPerTool = result.perTool.reduce((s, t) => s + t.tokens, 0);
    expect(result.totalTokens).toBe(sumPerTool + result.overheadTokens);
  });

  // -----------------------------------------------------------------------
  // 4. Per-tool breakdown matches total
  // -----------------------------------------------------------------------
  it("per-tool breakdown plus overhead equals totalTokens", () => {
    const tools: ToolDefinition[] = [sampleTool, toolWithLongDescription, minimalTool];
    const result = countToolTokens(tools);

    const sumPerTool = result.perTool.reduce((s, t) => s + t.tokens, 0);
    expect(result.totalTokens).toBe(sumPerTool + result.overheadTokens);
    expect(result.perTool).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // 5. costOverRequests multiplier works
  // -----------------------------------------------------------------------
  it("costOverRequests scales linearly with request count", () => {
    const result = countToolTokens([sampleTool]);
    expect(result.costPerRequest).toBeGreaterThan(0);
    expect(result.costOverRequests(1)).toBeCloseTo(result.costPerRequest, 10);
    expect(result.costOverRequests(100)).toBeCloseTo(
      result.costPerRequest * 100,
      10
    );
    expect(result.costOverRequests(0)).toBe(0);
  });

  it("costPerRequest uses the provided inputPricePerMillion", () => {
    const cheapResult = countToolTokens([sampleTool], 0.15);
    const expensiveResult = countToolTokens([sampleTool], 15.0);

    // Same token count, different prices
    expect(cheapResult.totalTokens).toBe(expensiveResult.totalTokens);
    expect(expensiveResult.costPerRequest).toBeCloseTo(
      cheapResult.costPerRequest * 100,
      10
    );
  });

  it("handles a tool with no parameters", () => {
    const result = countToolTokens([minimalTool]);
    expect(result.totalTokens).toBeGreaterThan(0);
    expect(result.perTool[0].name).toBe("ping");
    expect(result.perTool[0].description).toBe("");
  });

  it("more tools produce more tokens", () => {
    const one = countToolTokens([sampleTool]);
    const two = countToolTokens([sampleTool, toolWithLongDescription]);
    expect(two.totalTokens).toBeGreaterThan(one.totalTokens);
  });
});

// -----------------------------------------------------------------------
// optimizeToolDefinitions
// -----------------------------------------------------------------------

describe("optimizeToolDefinitions", () => {
  // -----------------------------------------------------------------------
  // 6. Truncates long descriptions
  // -----------------------------------------------------------------------
  it("truncates descriptions longer than 100 characters", () => {
    const result = optimizeToolDefinitions([toolWithLongDescription]);
    const optimizedDesc = result.optimized[0].function.description!;
    expect(optimizedDesc.length).toBeLessThanOrEqual(100);
    expect(result.suggestions.some((s) => s.includes("truncated"))).toBe(true);
  });

  it("does not truncate descriptions that are <= 100 chars", () => {
    const result = optimizeToolDefinitions([sampleTool]);
    // sampleTool description is "Get the current weather for a location" (40 chars)
    expect(result.optimized[0].function.description).toBe(
      sampleTool.function.description
    );
  });

  // -----------------------------------------------------------------------
  // 7. Removes redundant parameter descriptions
  // -----------------------------------------------------------------------
  it("removes parameter descriptions that repeat the parameter name", () => {
    const toolWithRedundant: ToolDefinition = {
      type: "function",
      function: {
        name: "get_user",
        description: "Get a user by ID",
        parameters: {
          type: "object",
          properties: {
            userId: { type: "string", description: "The userId" },
            name: { type: "string", description: "name" },
            email: {
              type: "string",
              description: "The email address for sending notifications",
            },
          },
          required: ["userId"],
        },
      },
    };

    const result = optimizeToolDefinitions([toolWithRedundant]);
    const optimizedProps =
      result.optimized[0].function.parameters!.properties!;

    // "The userId" matches the pattern `the${normalizedName}` -> removed
    expect(optimizedProps["userId"].description).toBeUndefined();
    // "name" matches the `normalizedDesc === normalizedName` pattern -> removed
    expect(optimizedProps["name"].description).toBeUndefined();
    // "The email address for sending notifications" is distinct and long enough -> kept
    expect(optimizedProps["email"].description).toBe(
      "The email address for sending notifications"
    );
  });

  it("removes descriptions shorter than 10 characters", () => {
    const toolWithShort: ToolDefinition = {
      type: "function",
      function: {
        name: "do_thing",
        description: "Does a thing",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "short" },
          },
        },
      },
    };

    const result = optimizeToolDefinitions([toolWithShort]);
    expect(
      result.optimized[0].function.parameters!.properties!["id"].description
    ).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 8. Reports savedTokens > 0
  // -----------------------------------------------------------------------
  it("reports savedTokens > 0 when optimizations apply", () => {
    const result = optimizeToolDefinitions([toolWithLongDescription]);
    expect(result.savedTokens).toBeGreaterThan(0);
    expect(result.originalTokens).toBeGreaterThan(result.optimizedTokens);
    expect(result.savedTokens).toBe(
      result.originalTokens - result.optimizedTokens
    );
  });

  it("reports savedTokens = 0 for already-optimal tools", () => {
    const optimalTool: ToolDefinition = {
      type: "function",
      function: {
        name: "noop",
        description: "No operation",
      },
    };
    const result = optimizeToolDefinitions([optimalTool]);
    expect(result.savedTokens).toBe(0);
  });

  it("does not mutate the original tool definitions", () => {
    const original = JSON.parse(JSON.stringify(toolWithLongDescription));
    optimizeToolDefinitions([toolWithLongDescription]);
    expect(toolWithLongDescription).toEqual(original);
  });

  it("provides suggestions array with details", () => {
    const result = optimizeToolDefinitions([toolWithLongDescription]);
    expect(result.suggestions.length).toBeGreaterThan(0);
    // Should have at least the truncation suggestion
    expect(result.suggestions.some((s) => s.includes("search_database"))).toBe(
      true
    );
  });
});

// -----------------------------------------------------------------------
// countImageTokens
// -----------------------------------------------------------------------

describe("countImageTokens", () => {
  // -----------------------------------------------------------------------
  // 9. "low" detail returns 85 tokens
  // -----------------------------------------------------------------------
  it('returns 85 tokens for "low" detail regardless of image size', () => {
    const result = countImageTokens(4000, 3000, "low");
    expect(result.tokens).toBe(85);
    expect(result.tiles).toBe(0);
    expect(result.resized).toBe(false);
  });

  it('returns 85 tokens for "low" detail even for a tiny image', () => {
    const result = countImageTokens(10, 10, "low");
    expect(result.tokens).toBe(85);
  });

  // -----------------------------------------------------------------------
  // 10. "high" detail for small image (256x256) returns 85 + 170
  // -----------------------------------------------------------------------
  it('returns 85 + 170 = 255 tokens for a 256x256 "high" detail image', () => {
    // 256x256: no resizing needed (both < 768 and < 2048)
    // tiles: ceil(256/512) = 1, ceil(256/512) = 1 -> 1 tile
    // tokens: 85 + 170 * 1 = 255
    const result = countImageTokens(256, 256, "high");
    expect(result.tokens).toBe(85 + 170);
    expect(result.tiles).toBe(1);
    expect(result.resized).toBe(false);
  });

  it('returns 85 + 170 = 255 tokens for a 512x512 "high" image', () => {
    // 512x512: no resizing (512 < 768)
    // tiles: ceil(512/512) = 1, ceil(512/512) = 1 -> 1 tile
    const result = countImageTokens(512, 512, "high");
    expect(result.tokens).toBe(85 + 170);
    expect(result.tiles).toBe(1);
    expect(result.resized).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 11. Large image gets resized
  // -----------------------------------------------------------------------
  it("marks large images as resized", () => {
    // A 4000x3000 image should be scaled down
    const result = countImageTokens(4000, 3000, "high");
    expect(result.resized).toBe(true);
  });

  it("resizes images larger than 2048 on the longest side", () => {
    // 4096x2048: scale to 2048x1024, then shortest side=1024>768,
    // scale to 768/1024 * each -> 1536x768, then scale shortest(768)
    // to 768 => already 768, so w=floor(2048*(2048/4096))=1024 actually...
    // Let's just test that resizing happens and tokens are computed
    const result = countImageTokens(4096, 2048, "high");
    expect(result.resized).toBe(true);
    expect(result.tokens).toBeGreaterThan(85);
  });

  it("resizes images when shortest side exceeds 768", () => {
    // 1024x1024: both sides > 768
    // Shortest side = 1024, scale = 768/1024 = 0.75
    // New: 768x768
    const result = countImageTokens(1024, 1024, "high");
    expect(result.resized).toBe(true);
    // tiles: ceil(768/512) = 2, ceil(768/512) = 2 -> 4 tiles
    expect(result.tiles).toBe(4);
    expect(result.tokens).toBe(85 + 170 * 4);
  });

  // -----------------------------------------------------------------------
  // 12. Provides recommendation for oversized images
  // -----------------------------------------------------------------------
  it("provides a recommendation for images larger than 1024 in any dimension", () => {
    const result = countImageTokens(3000, 2000, "high");
    expect(result.recommendation).toBeDefined();
    expect(result.recommendation!.suggestedWidth).toBeLessThanOrEqual(1024);
    expect(result.recommendation!.suggestedHeight).toBeLessThanOrEqual(1024);
    expect(result.recommendation!.savedTokens).toBeGreaterThan(0);
  });

  it("does not provide a recommendation for small images", () => {
    const result = countImageTokens(512, 512, "high");
    expect(result.recommendation).toBeUndefined();
  });

  it('"auto" detail behaves the same as "high"', () => {
    const autoResult = countImageTokens(800, 600, "auto");
    const highResult = countImageTokens(800, 600, "high");
    expect(autoResult.tokens).toBe(highResult.tokens);
    expect(autoResult.tiles).toBe(highResult.tiles);
  });

  it("defaults to auto detail when not specified", () => {
    const defaultResult = countImageTokens(800, 600);
    const autoResult = countImageTokens(800, 600, "auto");
    expect(defaultResult.tokens).toBe(autoResult.tokens);
  });
});

// -----------------------------------------------------------------------
// predictOutputTokens
// -----------------------------------------------------------------------

describe("predictOutputTokens", () => {
  // -----------------------------------------------------------------------
  // 13. Matches factual-qa pattern
  // -----------------------------------------------------------------------
  it("matches a factual-qa pattern for a simple question", () => {
    const result = predictOutputTokens("What is the capital of France?");
    expect(result.taskType).toBe("factual-qa");
    expect(result.confidence).toBe("high");
    expect(result.predictedTokens).toBe(30);
  });

  it("matches factual-qa for 'how many' questions", () => {
    const result = predictOutputTokens("How many planets are in our solar system?");
    expect(result.taskType).toBe("factual-qa");
  });

  // -----------------------------------------------------------------------
  // 14. Matches classification pattern
  // -----------------------------------------------------------------------
  it("matches a classification pattern", () => {
    const result = predictOutputTokens(
      "Classify this text as positive or negative sentiment"
    );
    expect(result.taskType).toBe("classification");
    expect(result.confidence).toBe("high");
    expect(result.predictedTokens).toBe(20);
  });

  it("matches classification for 'categorize' keyword", () => {
    const result = predictOutputTokens("Categorize this email as spam or not");
    expect(result.taskType).toBe("classification");
  });

  // -----------------------------------------------------------------------
  // 15. Returns "general" for unmatched prompts
  // -----------------------------------------------------------------------
  it('returns "general" taskType for prompts that match no pattern', () => {
    const result = predictOutputTokens("Hello there, nice day today.");
    expect(result.taskType).toBe("general");
    expect(result.confidence).toBe("low");
  });

  it('returns "general" for an empty prompt', () => {
    const result = predictOutputTokens("");
    expect(result.taskType).toBe("general");
    expect(result.confidence).toBe("low");
  });

  // -----------------------------------------------------------------------
  // 16. Respects safetyMargin option
  // -----------------------------------------------------------------------
  it("respects safetyMargin option and changes suggestedMaxTokens", () => {
    const tight = predictOutputTokens("What is the capital of France?", {
      safetyMargin: 1.0,
    });
    const loose = predictOutputTokens("What is the capital of France?", {
      safetyMargin: 3.0,
    });

    // With a higher safety margin, suggestedMaxTokens should be larger
    expect(loose.suggestedMaxTokens).toBeGreaterThan(tight.suggestedMaxTokens);
  });

  it("uses default safetyMargin of 1.5x", () => {
    const result = predictOutputTokens("What is the capital of France?");
    // factual-qa: avgTokens=30, 30 * 1.5 = 45, clamped to minMax=50
    expect(result.suggestedMaxTokens).toBe(50);
  });

  it("matches yes-no question pattern", () => {
    const result = predictOutputTokens("Is the earth round?");
    expect(result.taskType).toBe("yes-no");
    expect(result.confidence).toBe("high");
  });

  it("matches summarization pattern", () => {
    const result = predictOutputTokens("Summarize this article for me");
    expect(result.taskType).toBe("summarization");
    expect(result.confidence).toBe("medium");
  });

  it("matches code-generation pattern", () => {
    const result = predictOutputTokens(
      "Write a function that sorts an array"
    );
    expect(result.taskType).toBe("code-generation");
    expect(result.confidence).toBe("medium");
  });

  it("matches analysis pattern", () => {
    const result = predictOutputTokens(
      "Explain how photosynthesis works in detail"
    );
    expect(result.taskType).toBe("analysis");
    expect(result.confidence).toBe("medium");
  });

  it("respects minMaxTokens option", () => {
    const result = predictOutputTokens("What is 2+2?", {
      minMaxTokens: 200,
    });
    expect(result.suggestedMaxTokens).toBeGreaterThanOrEqual(200);
  });

  it("respects maxMaxTokens option", () => {
    const result = predictOutputTokens(
      "Explain the entire history of civilization in extreme detail",
      { maxMaxTokens: 500 }
    );
    expect(result.suggestedMaxTokens).toBeLessThanOrEqual(500);
  });

  it("savingsVsBlanket reflects the difference from default maxMaxTokens", () => {
    const result = predictOutputTokens("What is the capital of France?");
    // savingsVsBlanket = maxMax (4096 default) - suggestedMaxTokens
    expect(result.savingsVsBlanket).toBe(4096 - result.suggestedMaxTokens);
    expect(result.savingsVsBlanket).toBeGreaterThan(0);
  });

  it("falls back to input-length-based prediction for long unmatched prompts", () => {
    // Generate a long prompt that doesn't match any pattern
    const longPrompt = "The rain in Spain falls mainly on the plain. ".repeat(50);
    const result = predictOutputTokens(longPrompt);
    expect(result.taskType).toBe("general");
    expect(result.predictedTokens).toBeGreaterThan(100);
  });
});
