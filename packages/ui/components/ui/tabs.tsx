import { cn } from "@teamsland/ui/lib/utils";
import type * as React from "react";

function Tabs({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="tabs-list"
      role="tablist"
      className={cn("inline-flex h-9 items-center gap-1 border-b border-border", className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, active, ...props }: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      data-slot="tabs-trigger"
      role="tab"
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-md disabled:pointer-events-none disabled:opacity-50",
        "text-muted-foreground hover:text-foreground",
        "data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:-mb-px",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, active, ...props }: React.ComponentProps<"div"> & { active?: boolean }) {
  if (!active) return null;

  return <div data-slot="tabs-content" role="tabpanel" className={cn("flex-1 outline-none", className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
