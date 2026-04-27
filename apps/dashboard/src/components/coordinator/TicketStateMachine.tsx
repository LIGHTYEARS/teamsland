const NODES: Array<{ id: string; x: number; y: number; terminal?: boolean }> = [
  { id: "received", x: 80, y: 40 },
  { id: "enriching", x: 230, y: 40 },
  { id: "triaging", x: 380, y: 40 },
  { id: "awaiting_clarification", x: 380, y: 130 },
  { id: "ready", x: 530, y: 40 },
  { id: "executing", x: 680, y: 40 },
  { id: "completed", x: 830, y: 10, terminal: true },
  { id: "failed", x: 830, y: 70, terminal: true },
  { id: "skipped", x: 530, y: 130, terminal: true },
  { id: "suspended", x: 230, y: 130, terminal: true },
];

const EDGES: Array<{ from: string; to: string }> = [
  { from: "received", to: "enriching" },
  { from: "enriching", to: "triaging" },
  { from: "triaging", to: "ready" },
  { from: "triaging", to: "awaiting_clarification" },
  { from: "triaging", to: "skipped" },
  { from: "awaiting_clarification", to: "triaging" },
  { from: "awaiting_clarification", to: "suspended" },
  { from: "ready", to: "executing" },
  { from: "executing", to: "completed" },
  { from: "executing", to: "failed" },
];

function nodeById(id: string) {
  const node = NODES.find((n) => n.id === id);
  if (!node) throw new Error(`Unknown node: ${id}`);
  return node;
}

export function TicketStateMachine({ activeStates }: { activeStates: Set<string> }) {
  return (
    <svg
      viewBox="0 0 950 180"
      className="w-full h-auto"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Ticket state machine diagram"
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground/50" />
        </marker>
      </defs>

      {EDGES.map(({ from, to }) => {
        const f = nodeById(from);
        const t = nodeById(to);
        return (
          <line
            key={`${from}-${to}`}
            x1={f.x + 60}
            y1={f.y + 15}
            x2={t.x - 5}
            y2={t.y + 15}
            className="stroke-muted-foreground/30"
            strokeWidth={1.5}
            markerEnd="url(#arrow)"
          />
        );
      })}

      {NODES.map((node) => {
        const isActive = activeStates.has(node.id);
        const fillClass = isActive
          ? "fill-primary/20 stroke-primary"
          : node.terminal
            ? "fill-muted/50 stroke-muted-foreground/30"
            : "fill-background stroke-border";
        const textClass = isActive ? "fill-primary font-semibold" : "fill-muted-foreground";
        const label = node.id.replace(/_/g, " ");

        return (
          <g key={node.id}>
            <rect
              x={node.x}
              y={node.y}
              width={120}
              height={30}
              rx={node.terminal ? 15 : 6}
              className={fillClass}
              strokeWidth={isActive ? 2 : 1}
            />
            <text x={node.x + 60} y={node.y + 19} textAnchor="middle" className={`text-[9px] ${textClass}`}>
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
