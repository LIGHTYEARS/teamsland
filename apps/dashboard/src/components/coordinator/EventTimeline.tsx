import { Badge } from "@teamsland/ui/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@teamsland/ui/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@teamsland/ui/components/ui/tooltip";
import JsonView from "@uiw/react-json-view";
import { githubDarkTheme } from "@uiw/react-json-view/githubDark";
import { githubLightTheme } from "@uiw/react-json-view/githubLight";
import { AlertCircle, CheckCircle, Clock, Inbox } from "lucide-react";
import { useState } from "react";
import type { RecentEvent } from "../../hooks/useRecentEvents";

const TYPE_COLORS: Record<string, string> = {
  lark_dm: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
  lark_mention: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/20",
  "issue.created": "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  "issue.updated": "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  webhook: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
};

const FALLBACK_COLOR = "bg-muted text-muted-foreground border-border";

function isDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function getString(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === "object") {
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === "string" && val) return val;
  }
  return undefined;
}

function extractEventInfo(event: unknown): string | undefined {
  const evt = event as Record<string, unknown>;
  if (typeof evt.type !== "string") return undefined;
  const parts: string[] = [evt.type];
  if (typeof evt.issueId === "string") parts.push(evt.issueId.slice(0, 12));
  return parts.join(" · ");
}

function extractSummary(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;

  const direct = getString(p, "title") ?? getString(p, "description");
  if (direct) return direct;

  if (p.event && typeof p.event === "object") {
    const info = extractEventInfo(p.event);
    if (info) return info;
  }

  const nested = getString(p.payload, "title") ?? getString(p.payload, "description");
  if (nested) return nested;

  const keys = Object.keys(p);
  return keys.length <= 3 ? keys.join(", ") : `${keys.length} fields`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") {
    return <CheckCircle size={14} className="text-green-500 shrink-0" aria-hidden="true" />;
  }
  if (status === "processing") {
    return <Clock size={14} className="text-amber-500 shrink-0 animate-pulse" aria-hidden="true" />;
  }
  return <AlertCircle size={14} className="text-red-500 shrink-0" aria-hidden="true" />;
}

function statusLabel(status: string): string {
  if (status === "completed") return "已完成";
  if (status === "processing") return "处理中";
  if (status === "failed") return "失败";
  return status;
}

export function EventTimeline({ events, loading }: { events: RecentEvent[]; loading: boolean }) {
  const [selectedEvent, setSelectedEvent] = useState<RecentEvent | null>(null);

  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
        <Clock size={16} className="animate-pulse" aria-hidden="true" />
        <span className="text-sm">加载事件中…</span>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <Inbox size={24} strokeWidth={1.5} aria-hidden="true" />
        <span className="text-sm">暂无事件</span>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs text-muted-foreground">
              <th className="text-left px-3 py-2 font-medium">类型</th>
              <th className="text-left px-3 py-2 font-medium">摘要</th>
              <th className="text-left px-3 py-2 font-medium">优先级</th>
              <th className="text-left px-3 py-2 font-medium">状态</th>
              <th className="text-right px-3 py-2 font-medium">时间</th>
            </tr>
          </thead>
          <tbody>
            {events.map((evt) => {
              const summary = extractSummary(evt.payload);
              const colorClass = TYPE_COLORS[evt.type] ?? FALLBACK_COLOR;

              return (
                <tr
                  key={evt.id}
                  className="border-b border-border/30 last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => setSelectedEvent(evt)}
                >
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={`text-[11px] font-mono border ${colorClass}`}>
                      {evt.type}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 max-w-[300px]">
                    {summary ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs text-muted-foreground truncate block">{summary}</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-[400px] break-words text-xs">{summary}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">&mdash;</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <PriorityBadge priority={evt.priority} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <StatusIcon status={evt.status} />
                      <span>{statusLabel(evt.status)}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatRelative(evt.updatedAt)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">{new Date(evt.updatedAt).toLocaleString()}</TooltipContent>
                    </Tooltip>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Sheet open={selectedEvent !== null} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selectedEvent && <EventDetail event={selectedEvent} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function EventDetail({ event }: { event: RecentEvent }) {
  const colorClass = TYPE_COLORS[event.type] ?? FALLBACK_COLOR;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Badge variant="outline" className={`text-xs font-mono border ${colorClass}`}>
            {event.type}
          </Badge>
          <span className="inline-flex items-center gap-1.5 text-sm font-normal">
            <StatusIcon status={event.status} />
            {statusLabel(event.status)}
          </span>
        </SheetTitle>
        <SheetDescription>{extractSummary(event.payload) || "无摘要"}</SheetDescription>
      </SheetHeader>

      <div className="px-6 flex-1 space-y-5">
        <section className="grid grid-cols-2 gap-3 text-sm">
          <DetailField label="优先级">
            <PriorityBadge priority={event.priority} />
          </DetailField>
          <DetailField label="重试次数">
            <span className="text-xs tabular-nums">
              {event.retryCount}/{event.maxRetries}
            </span>
          </DetailField>
          <DetailField label="创建时间">
            <span className="text-xs tabular-nums">{new Date(event.createdAt).toLocaleString()}</span>
          </DetailField>
          <DetailField label="更新时间">
            <span className="text-xs tabular-nums">{new Date(event.updatedAt).toLocaleString()}</span>
          </DetailField>
          <DetailField label="事件 ID" full>
            <span className="text-xs font-mono text-muted-foreground break-all">{event.id}</span>
          </DetailField>
        </section>

        {event.lastError && (
          <section className="space-y-1.5">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">错误信息</h3>
            <div className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap">
              {event.lastError}
            </div>
          </section>
        )}

        <section className="space-y-1.5">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">负载数据</h3>
          <div className="rounded-md bg-muted/50 px-3 py-2 max-h-80 overflow-y-auto text-xs [&_*]:!text-xs">
            <JsonView
              value={
                (event.payload && typeof event.payload === "object" ? event.payload : { raw: event.payload }) as object
              }
              collapsed={2}
              enableClipboard
              displayDataTypes={false}
              style={isDark() ? githubDarkTheme : githubLightTheme}
            />
          </div>
        </section>
      </div>
    </>
  );
}

function DetailField({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <dt className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const classes: Record<string, string> = {
    critical: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
    high: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20",
    normal: "bg-muted text-muted-foreground border-border",
    low: "bg-muted/50 text-muted-foreground/70 border-border/50",
  };

  return (
    <Badge variant="outline" className={`text-[10px] border ${classes[priority] ?? classes.normal}`}>
      {priority}
    </Badge>
  );
}
