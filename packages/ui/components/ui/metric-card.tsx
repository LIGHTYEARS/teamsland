import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { StatusDot } from "./status-dot";

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  variant?: "default" | "success" | "warning" | "error";
  className?: string;
}

function MetricCard({ label, value, icon, variant = "default", className }: MetricCardProps) {
  return (
    <Card data-slot="metric-card" className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          {variant !== "default" && <StatusDot variant={variant} size="sm" />}
          <span className="text-2xl font-bold tabular-nums">{value}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export type { MetricCardProps };
export { MetricCard };
