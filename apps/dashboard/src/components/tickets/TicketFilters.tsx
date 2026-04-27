const PHASES = [
  { label: "All", value: "all" },
  { label: "Intake", value: "intake" },
  { label: "Triage", value: "triage" },
  { label: "Execution", value: "execution" },
  { label: "Terminal", value: "terminal" },
] as const;

export type PhaseFilter = (typeof PHASES)[number]["value"];
export type SortBy = "updatedAt" | "createdAt" | "dwell";

export function TicketFilters({
  phase,
  onPhaseChange,
  sortBy,
  onSortChange,
}: {
  phase: PhaseFilter;
  onPhaseChange: (p: PhaseFilter) => void;
  sortBy: SortBy;
  onSortChange: (s: SortBy) => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-1">
        {PHASES.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onPhaseChange(p.value)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              phase === p.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <select
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value as SortBy)}
        className="text-xs bg-muted border border-border rounded px-2 py-1"
      >
        <option value="updatedAt">Updated</option>
        <option value="createdAt">Created</option>
        <option value="dwell">Dwell Time</option>
      </select>
    </div>
  );
}
