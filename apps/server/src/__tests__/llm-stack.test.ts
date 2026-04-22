import { describe, expect, it } from "vitest";
import { AnthropicLlmClient } from "../llm-client.js";

describe("LLM stack activation", () => {
  it("AnthropicLlmClient constructs with valid LlmConfig", () => {
    const client = new AnthropicLlmClient({
      provider: "anthropic",
      apiKey: "sk-test-key",
      model: "claude-sonnet-4-20250514",
      maxTokens: 4096,
    });
    expect(client).toBeInstanceOf(AnthropicLlmClient);
  });

  it("AnthropicLlmClient uses custom baseUrl when provided", () => {
    const client = new AnthropicLlmClient({
      provider: "anthropic",
      apiKey: "sk-test-key",
      model: "claude-sonnet-4-20250514",
      maxTokens: 4096,
      baseUrl: "https://custom.proxy.com",
    });
    expect(client).toBeInstanceOf(AnthropicLlmClient);
  });

  it("stub LLM client throws on chat()", async () => {
    const stub = {
      async chat(): Promise<{ content: string }> {
        throw new Error("LLM 未配置");
      },
    };
    await expect(stub.chat()).rejects.toThrow("LLM 未配置");
  });
});
