import type { EnrichResult } from "./types.js";

const FEISHU_URL_RE = /https?:\/\/[a-z0-9-]+\.feishu\.cn\/(?:docx|wiki|sheets|base|mindnotes|bitable)\/[A-Za-z0-9]+/g;

export interface EnrichDeps {
  issueId: string;
  projectKey: string;
  workItemType: string;
  meegoGet: (
    projectKey: string,
    workItemType: string,
    workItemId: number,
  ) => Promise<{
    ok: boolean;
    data?: {
      id: number;
      name: string;
      type: string;
      status?: string;
      fields: Record<string, unknown>;
      createdBy?: string;
      updatedBy?: string;
    };
    message?: string;
  }>;
  docRead: (url: string) => Promise<string>;
}

export function extractFeishuUrls(fields: Record<string, unknown>): Array<{ fieldKey: string; url: string }> {
  const results: Array<{ fieldKey: string; url: string }> = [];
  for (const [fieldKey, value] of Object.entries(fields)) {
    if (typeof value !== "string") continue;
    const matches = value.match(FEISHU_URL_RE);
    if (matches) {
      for (const url of matches) {
        results.push({ fieldKey, url });
      }
    }
  }
  return results;
}

export async function enrichTicket(deps: EnrichDeps): Promise<EnrichResult> {
  // Step 1: Meego get
  const issueIdNum = Number.parseInt(deps.issueId.replace(/\D/g, ""), 10);
  const meegoResult = await deps.meegoGet(deps.projectKey, deps.workItemType, issueIdNum);
  if (!meegoResult.ok || !meegoResult.data) {
    throw new Error(`Meego get failed: ${meegoResult.message ?? "unknown error"}`);
  }
  const item = meegoResult.data;

  // Step 2: Extract Feishu URLs
  const feishuLinks = extractFeishuUrls(item.fields);

  // Step 3: Read each document
  const documents: EnrichResult["documents"] = [];
  for (const link of feishuLinks) {
    try {
      const content = await deps.docRead(link.url);
      documents.push({ url: link.url, fieldKey: link.fieldKey, content, ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      documents.push({ url: link.url, fieldKey: link.fieldKey, content: null, ok: false, error: message });
    }
  }

  // Step 4: Build custom fields list (non-URL fields)
  const urlFieldKeys = new Set(feishuLinks.map((l) => l.fieldKey));
  const customFields: EnrichResult["customFields"] = [];
  for (const [fieldKey, value] of Object.entries(item.fields)) {
    if (!urlFieldKeys.has(fieldKey)) {
      customFields.push({ fieldKey, fieldName: fieldKey, value });
    }
  }

  // Step 5: Assemble result — raw data, no summarization
  const description = typeof item.fields.description === "string" ? item.fields.description : null;

  return {
    issueId: deps.issueId,
    basic: {
      title: item.name,
      status: item.status,
      priority: typeof item.fields.priority === "string" ? item.fields.priority : undefined,
      assignee: typeof item.fields.assignee === "string" ? item.fields.assignee : item.updatedBy,
      creator: item.createdBy,
    },
    description,
    documents,
    customFields,
  };
}
