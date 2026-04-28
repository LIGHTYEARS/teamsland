import { ErrorCard } from "@teamsland/ui/components/ui/error-card";
import type { ReactNode } from "react";

interface PageShellProps {
  loading?: boolean;
  error?: string | null;
  skeleton?: ReactNode;
  children: ReactNode;
}

export function PageShell({ loading, error, skeleton, children }: PageShellProps) {
  if (loading && skeleton) return <>{skeleton}</>;
  if (error) return <ErrorCard message={error} />;
  return <>{children}</>;
}
