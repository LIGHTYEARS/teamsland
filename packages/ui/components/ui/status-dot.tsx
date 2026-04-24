import { cn } from "@teamsland/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const statusDotVariants = cva("inline-block shrink-0 rounded-full", {
  variants: {
    variant: {
      default: "bg-muted-foreground",
      success: "bg-green-500 dark:bg-green-400",
      warning: "bg-yellow-500 dark:bg-yellow-400",
      error: "bg-red-500 dark:bg-red-400",
      info: "bg-blue-500 dark:bg-blue-400",
    },
    size: {
      sm: "size-1.5",
      default: "size-2",
      lg: "size-2.5",
    },
    pulse: {
      true: "animate-pulse",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
    pulse: false,
  },
});

function StatusDot({
  className,
  variant,
  size,
  pulse,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusDotVariants>) {
  return (
    <span
      data-slot="status-dot"
      aria-hidden="true"
      className={cn(statusDotVariants({ variant, size, pulse }), className)}
      {...props}
    />
  );
}

export { StatusDot, statusDotVariants };
