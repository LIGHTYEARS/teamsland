"use client";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@teamsland/ui/components/ui/collapsible";
import { cn } from "@teamsland/ui/lib/utils";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/**
 * 搜索任务文件标签
 *
 * @example
 * ```tsx
 * <TaskItemFile>src/index.ts</TaskItemFile>
 * ```
 */
export type TaskItemFileProps = ComponentProps<"div">;

export const TaskItemFile = ({ children, className, ...props }: TaskItemFileProps) => (
  <div
    className={cn(
      "inline-flex items-center gap-1 rounded-md border bg-secondary px-1.5 py-0.5 text-foreground text-xs",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

/**
 * 搜索任务条目
 *
 * @example
 * ```tsx
 * <TaskItem>搜索了 3 个文件</TaskItem>
 * ```
 */
export type TaskItemProps = ComponentProps<"div">;

export const TaskItem = ({ children, className, ...props }: TaskItemProps) => (
  <div className={cn("text-muted-foreground text-sm", className)} {...props}>
    {children}
  </div>
);

/**
 * 搜索任务根容器（Collapsible）
 *
 * @example
 * ```tsx
 * <Task defaultOpen>
 *   <TaskTrigger title="搜索代码库" />
 *   <TaskContent>
 *     <TaskItem>找到 5 个匹配项</TaskItem>
 *   </TaskContent>
 * </Task>
 * ```
 */
export type TaskProps = ComponentProps<typeof Collapsible>;

export const Task = ({ defaultOpen = true, className, ...props }: TaskProps) => (
  <Collapsible className={cn(className)} defaultOpen={defaultOpen} {...props} />
);

/**
 * 搜索任务触发器（标题 + 搜索图标 + 折叠箭头）
 *
 * @example
 * ```tsx
 * <TaskTrigger title="搜索认证逻辑" />
 * <TaskTrigger title="读取配置文件" icon={<FileIcon className="size-4" />} />
 * ```
 */
export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
  icon?: ReactNode;
};

export const TaskTrigger = ({ children, className, title, icon, ...props }: TaskTriggerProps) => (
  <CollapsibleTrigger asChild className={cn("group", className)} {...props}>
    {children ?? (
      <div className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
        {icon ?? <SearchIcon className="size-4" />}
        <p className="text-sm">{title}</p>
        <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
      </div>
    )}
  </CollapsibleTrigger>
);

/**
 * 搜索任务内容区（左边竖线缩进展示子步骤）
 *
 * @example
 * ```tsx
 * <TaskContent>
 *   <TaskItem>步骤 1</TaskItem>
 *   <TaskItem>步骤 2</TaskItem>
 * </TaskContent>
 * ```
 */
export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export const TaskContent = ({ children, className, ...props }: TaskContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  >
    <div className="mt-4 space-y-2 border-muted border-l-2 pl-4">{children}</div>
  </CollapsibleContent>
);
