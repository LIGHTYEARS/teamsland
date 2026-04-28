import { cn } from "@teamsland/ui/lib/utils";
import { AlertCircle } from "lucide-react";
import { Button } from "./button";

interface ErrorCardProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

function ErrorCard({ title = "出错了", message, onRetry, className }: ErrorCardProps) {
  return (
    <div
      data-slot="error-card"
      className={cn("flex flex-col items-center justify-center py-12 text-center", className)}
    >
      <div className="mb-3 text-destructive">
        <AlertCircle size={32} strokeWidth={1.5} />
      </div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {message && <p className="mt-1 text-xs text-muted-foreground max-w-sm">{message}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-4">
          重试
        </Button>
      )}
    </div>
  );
}

export type { ErrorCardProps };
export { ErrorCard };
