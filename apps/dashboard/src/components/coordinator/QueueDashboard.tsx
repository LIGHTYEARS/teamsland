import { Card } from "@teamsland/ui/components/ui/card";
import type { QueueStats } from "../../hooks/useQueueStats";

const STAT_CONFIG: Array<{ key: keyof QueueStats; label: string; color: string }> = [
  { key: "pending", label: "待处理", color: "text-blue-500" },
  { key: "processing", label: "处理中", color: "text-green-500" },
  { key: "completed", label: "已完成", color: "text-gray-500" },
  { key: "failed", label: "失败", color: "text-red-500" },
  { key: "dead", label: "失败消息", color: "text-red-700" },
];

export function QueueDashboard({ stats }: { stats: QueueStats }) {
  return (
    <div className="grid grid-cols-5 gap-3">
      {STAT_CONFIG.map(({ key, label, color }) => (
        <Card key={key} className="p-3 text-center">
          <p className={`text-2xl font-bold ${color}`}>{stats[key]}</p>
          <p className="text-xs text-muted-foreground mt-1">{label}</p>
        </Card>
      ))}
    </div>
  );
}
