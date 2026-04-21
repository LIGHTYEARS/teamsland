import { SpanStatusCode, trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTracer, withSpan } from "../tracer.js";

describe("tracer", () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
  });

  afterAll(async () => {
    await provider.shutdown();
  });

  it("getTracer 返回有效 Tracer 实例", () => {
    const tracer = getTracer("test-module");
    expect(tracer).toBeDefined();
    const span = tracer.startSpan("test");
    span.end();
  });

  it("withSpan 创建并自动结束 span", async () => {
    exporter.reset();
    const result = await withSpan("test", "my-op", async (span) => {
      span.setAttribute("key", "value");
      return 42;
    });

    expect(result).toBe(42);
    const spans = exporter.getFinishedSpans();
    const found = spans.find((s) => s.name === "my-op");
    expect(found).toBeDefined();
    expect(found?.status.code).toBe(SpanStatusCode.OK);
    expect(found?.attributes.key).toBe("value");
  });

  it("withSpan 在异常时记录 ERROR 状态", async () => {
    exporter.reset();
    await expect(
      withSpan("test", "fail-op", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const spans = exporter.getFinishedSpans();
    const found = spans.find((s) => s.name === "fail-op");
    expect(found).toBeDefined();
    expect(found?.status.code).toBe(SpanStatusCode.ERROR);
    expect(found?.status.message).toBe("boom");
    expect(found?.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("withSpan 支持初始属性", async () => {
    exporter.reset();
    await withSpan("test", "attrs-op", async () => "ok", { "init.key": "init-value" });

    const spans = exporter.getFinishedSpans();
    const found = spans.find((s) => s.name === "attrs-op");
    expect(found?.attributes["init.key"]).toBe("init-value");
  });

  it("withSpan 嵌套调用创建独立 span", async () => {
    exporter.reset();
    await withSpan("test", "parent", async () => {
      await withSpan("test", "child", async () => "inner");
    });

    const spans = exporter.getFinishedSpans();
    const parent = spans.find((s) => s.name === "parent");
    const child = spans.find((s) => s.name === "child");
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
  });
});
