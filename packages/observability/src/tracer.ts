import { type AttributeValue, context, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

let provider: BasicTracerProvider | undefined;

/**
 * OpenTelemetry Span 属性映射
 *
 * @example
 * ```typescript
 * const attrs: SpanAttributes = { "agent.id": "agent-001", "issue.id": "PROJ-123" };
 * ```
 */
export type SpanAttributes = Record<string, AttributeValue>;

/**
 * 初始化 OpenTelemetry TracerProvider
 *
 * 读取 `OTEL_EXPORTER_OTLP_ENDPOINT` 环境变量作为导出地址（默认 `http://localhost:4318`）。
 * 多次调用为幂等操作，仅首次初始化生效。
 *
 * @param serviceName - 服务名称，写入 Resource
 * @param serviceVersion - 服务版本号
 *
 * @example
 * ```typescript
 * import { initTracing } from "@teamsland/observability";
 *
 * initTracing("teamsland-server", "0.1.0");
 * ```
 */
export function initTracing(serviceName: string, serviceVersion = "0.0.0"): void {
  if (provider) return;

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
  });

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
  const exporter: SpanExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  const isDev = process.env.NODE_ENV === "development";
  const processor = isDev ? new SimpleSpanProcessor(exporter) : new BatchSpanProcessor(exporter);

  provider = new BasicTracerProvider({ resource, spanProcessors: [processor] });
  trace.setGlobalTracerProvider(provider);
}

/**
 * 获取指定模块的 Tracer 实例
 *
 * 用于创建 span。无需提前调用 `initTracing()`——未初始化时返回 NoOp tracer，不影响功能。
 *
 * @param name - tracer 名称，标识模块来源
 * @returns OpenTelemetry Tracer 实例
 *
 * @example
 * ```typescript
 * import { getTracer } from "@teamsland/observability";
 *
 * const tracer = getTracer("sidecar:process-controller");
 * tracer.startSpan("spawn").end();
 * ```
 */
export function getTracer(name: string) {
  return trace.getTracer(name);
}

/**
 * 包装异步函数，自动创建并管理 span
 *
 * 在函数执行前创建 span，函数成功后自动结束 span。
 * 函数抛出异常时记录异常并标记 span 为 ERROR 状态。
 * span 自动继承当前 context 的 parent span。
 *
 * @param tracerName - tracer 模块名称
 * @param spanName - span 名称
 * @param fn - 被包装的异步函数，接收当前 span 用于添加属性/事件
 * @param attributes - 可选的 span 起始属性
 * @returns 异步函数的返回值
 *
 * @example
 * ```typescript
 * import { withSpan } from "@teamsland/observability";
 *
 * const result = await withSpan("memory", "vectorSearch", async (span) => {
 *   span.setAttribute("query.limit", 10);
 *   return db.query("SELECT ...").all();
 * });
 * ```
 */
export async function withSpan<T>(
  tracerName: string,
  spanName: string,
  fn: (span: Span) => Promise<T>,
  attributes?: SpanAttributes,
): Promise<T> {
  const tracer = getTracer(tracerName);
  const span = tracer.startSpan(spanName, { attributes });
  const ctx = trace.setSpan(context.active(), span);

  try {
    const result = await context.with(ctx, () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err: unknown) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
    if (err instanceof Error) {
      span.recordException(err);
    }
    throw err;
  } finally {
    span.end();
  }
}

/**
 * 关闭 TracerProvider，刷新所有待发送 span
 *
 * 应在进程退出前调用，确保所有 span 数据被导出。
 *
 * @example
 * ```typescript
 * import { shutdownTracing } from "@teamsland/observability";
 *
 * process.on("SIGTERM", async () => {
 *   await shutdownTracing();
 *   process.exit(0);
 * });
 * ```
 */
export async function shutdownTracing(): Promise<void> {
  if (!provider) return;
  await provider.shutdown();
  provider = undefined;
}
