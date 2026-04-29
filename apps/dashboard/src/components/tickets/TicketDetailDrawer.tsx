import { Badge } from "@teamsland/ui/components/ui/badge";
import { Card } from "@teamsland/ui/components/ui/card";
import { Separator } from "@teamsland/ui/components/ui/separator";
import { SheetContent, SheetHeader, SheetTitle } from "@teamsland/ui/components/ui/sheet";
import { AlertCircle, ExternalLink, FileText } from "lucide-react";
import { useTicketDetail } from "../../hooks/useTicketDetail.js";

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function TimelineEntry({ label, timestamp }: { label: string; timestamp: number }) {
  return (
    <div className="relative">
      <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-border border-2 border-background" />
      <div className="flex items-center justify-between">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted-foreground">{formatTimestamp(timestamp)}</span>
      </div>
    </div>
  );
}

export function TicketDetailDrawer({ issueId }: { issueId: string }) {
  const { ticket, enrichResult, loading, error } = useTicketDetail(issueId);

  return (
    <SheetContent className="w-[480px] sm:max-w-[480px] p-0 flex flex-col">
      <SheetHeader className="shrink-0 flex-row items-center justify-between bg-muted/30 px-4 py-3 space-y-0">
        <div className="flex items-center gap-2 min-w-0">
          <SheetTitle className="text-sm font-mono text-muted-foreground">{issueId}</SheetTitle>
          {ticket && (
            <Badge variant="outline" className="text-[10px]">
              {ticket.state}
            </Badge>
          )}
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && <p className="text-sm text-muted-foreground">加载中...</p>}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
        {ticket && !loading && (
          <>
            <h2 className="text-base font-semibold">{enrichResult?.basic.title ?? issueId}</h2>

            {enrichResult && (
              <Card className="p-3 space-y-1.5 text-sm">
                <Row label="状态" value={enrichResult.basic.status} />
                <Row label="优先级" value={enrichResult.basic.priority} />
                <Row label="负责人" value={enrichResult.basic.assignee} />
                <Row label="创建者" value={enrichResult.basic.creator} />
                <Row label="来源" value={ticket.eventType} />
              </Card>
            )}

            {enrichResult?.description && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">描述</h3>
                <p className="text-sm whitespace-pre-wrap">{enrichResult.description}</p>
              </div>
            )}

            {enrichResult?.documents && enrichResult.documents.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">文档</h3>
                <div className="space-y-2">
                  {enrichResult.documents.map((doc) => (
                    <Card key={doc.url} className="p-2 text-sm">
                      <div className="flex items-center gap-1.5">
                        <FileText size={12} />
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline truncate"
                        >
                          {doc.url}
                        </a>
                        <ExternalLink size={10} className="shrink-0" />
                        {!doc.ok && (
                          <Badge variant="destructive" className="text-[10px] h-4 px-1">
                            错误
                          </Badge>
                        )}
                      </div>
                      {doc.content && <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{doc.content}</p>}
                      {doc.error && <p className="mt-1 text-xs text-destructive">{doc.error}</p>}
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {enrichResult?.customFields && enrichResult.customFields.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">自定义字段</h3>
                <Card className="p-3 text-sm space-y-1">
                  {enrichResult.customFields.map((f) => (
                    <Row key={f.fieldKey} label={f.fieldName} value={String(f.value ?? "—")} />
                  ))}
                </Card>
              </div>
            )}

            <Separator />

            {ticket.history.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">状态时间线</h3>
                <div className="space-y-2 border-l-2 border-border pl-4 ml-1">
                  <TimelineEntry label="创建" timestamp={ticket.createdAt} />
                  {ticket.history.map((h) => (
                    <TimelineEntry
                      key={`${h.from}-${h.to}-${h.timestamp}`}
                      label={`${h.from} → ${h.to}`}
                      timestamp={h.timestamp}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </SheetContent>
  );
}
