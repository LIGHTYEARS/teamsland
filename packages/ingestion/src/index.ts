// @teamsland/ingestion — 意图识别与文档解析
// 两阶段意图分类（规则 + LLM）+ Markdown 结构化提取

export type { ParsedDocument, Section } from "./document-parser.js";
export { DocumentParser } from "./document-parser.js";
export { IntentClassifier } from "./intent-classifier.js";
export type { LlmClient, LlmMessage, LlmResponse } from "./types.js";
