export function TicketsPage({
  issueId,
  onNavigate: _onNavigate,
}: {
  issueId?: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Tickets</h1>
        <p className="text-sm text-muted-foreground">Kanban board — coming soon</p>
      </header>
      <div className="flex-1 p-6">
        {issueId && <p className="text-sm text-muted-foreground">Selected: {issueId}</p>}
      </div>
    </div>
  );
}
