// @teamsland/observability — 结构化日志 + OpenTelemetry 链路追踪
// 日志基于 pino NDJSON，追踪基于 OpenTelemetry SDK

export type { Logger } from "./logger.js";
export { createLogger } from "./logger.js";

export type { SpanAttributes } from "./tracer.js";
export { getTracer, initTracing, shutdownTracing, withSpan } from "./tracer.js";
