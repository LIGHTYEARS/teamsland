"use client";

import { Button } from "@teamsland/ui/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@teamsland/ui/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@teamsland/ui/components/ui/collapsible";
import { cn } from "@teamsland/ui/lib/utils";
import { ChevronsUpDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { createContext, useContext, useMemo } from "react";

import { Shimmer } from "./shimmer";

interface PlanContextValue {
  isStreaming: boolean;
}

const PlanContext = createContext<PlanContextValue | null>(null);

/**
 * 获取 Plan 上下文（isStreaming 流式状态）
 *
 * @example
 * ```tsx
 * const { isStreaming } = usePlan();
 * ```
 */
const usePlan = () => {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error("Plan components must be used within Plan");
  }
  return context;
};

/**
 * 执行计划根容器（Card + Collapsible）
 *
 * @example
 * ```tsx
 * <Plan defaultOpen isStreaming={false}>
 *   <PlanHeader>
 *     <PlanTitle>部署计划</PlanTitle>
 *     <PlanDescription>分 3 步完成</PlanDescription>
 *     <PlanAction><PlanTrigger /></PlanAction>
 *   </PlanHeader>
 *   <PlanContent>步骤详情</PlanContent>
 * </Plan>
 * ```
 */
export type PlanProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
};

export const Plan = ({ className, isStreaming = false, children, ...props }: PlanProps) => {
  const contextValue = useMemo(() => ({ isStreaming }), [isStreaming]);

  return (
    <PlanContext.Provider value={contextValue}>
      <Collapsible asChild data-slot="plan" {...props}>
        <Card className={cn("shadow-none", className)}>{children}</Card>
      </Collapsible>
    </PlanContext.Provider>
  );
};

/**
 * 计划头部
 *
 * @example
 * ```tsx
 * <PlanHeader><PlanTitle>标题</PlanTitle></PlanHeader>
 * ```
 */
export type PlanHeaderProps = ComponentProps<typeof CardHeader>;

export const PlanHeader = ({ className, ...props }: PlanHeaderProps) => (
  <CardHeader className={cn("flex items-start justify-between", className)} data-slot="plan-header" {...props} />
);

/**
 * 计划标题（流式时显示 Shimmer 效果）
 *
 * @example
 * ```tsx
 * <PlanTitle>代码审查计划</PlanTitle>
 * ```
 */
export type PlanTitleProps = Omit<ComponentProps<typeof CardTitle>, "children"> & {
  children: string;
};

export const PlanTitle = ({ children, ...props }: PlanTitleProps) => {
  const { isStreaming } = usePlan();

  return (
    <CardTitle data-slot="plan-title" {...props}>
      {isStreaming ? <Shimmer>{children}</Shimmer> : children}
    </CardTitle>
  );
};

/**
 * 计划描述（流式时显示 Shimmer 效果）
 *
 * @example
 * ```tsx
 * <PlanDescription>将分为 3 个步骤执行</PlanDescription>
 * ```
 */
export type PlanDescriptionProps = Omit<ComponentProps<typeof CardDescription>, "children"> & {
  children: string;
};

export const PlanDescription = ({ className, children, ...props }: PlanDescriptionProps) => {
  const { isStreaming } = usePlan();

  return (
    <CardDescription className={cn("text-balance", className)} data-slot="plan-description" {...props}>
      {isStreaming ? <Shimmer>{children}</Shimmer> : children}
    </CardDescription>
  );
};

/**
 * 计划操作区（放 PlanTrigger）
 *
 * @example
 * ```tsx
 * <PlanAction><PlanTrigger /></PlanAction>
 * ```
 */
export type PlanActionProps = ComponentProps<typeof CardAction>;

export const PlanAction = (props: PlanActionProps) => <CardAction data-slot="plan-action" {...props} />;

/**
 * 计划内容区（可折叠）
 *
 * @example
 * ```tsx
 * <PlanContent><ol><li>步骤 1</li></ol></PlanContent>
 * ```
 */
export type PlanContentProps = ComponentProps<typeof CardContent>;

export const PlanContent = (props: PlanContentProps) => (
  <CollapsibleContent asChild>
    <CardContent data-slot="plan-content" {...props} />
  </CollapsibleContent>
);

/**
 * 计划底部
 *
 * @example
 * ```tsx
 * <PlanFooter>已完成 3/5 步</PlanFooter>
 * ```
 */
export type PlanFooterProps = ComponentProps<"div">;

export const PlanFooter = (props: PlanFooterProps) => <CardFooter data-slot="plan-footer" {...props} />;

/**
 * 计划折叠切换按钮
 *
 * @example
 * ```tsx
 * <PlanAction><PlanTrigger /></PlanAction>
 * ```
 */
export type PlanTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

export const PlanTrigger = ({ className, ...props }: PlanTriggerProps) => (
  <CollapsibleTrigger asChild>
    <Button className={cn("size-8", className)} data-slot="plan-trigger" size="icon" variant="ghost" {...props}>
      <ChevronsUpDownIcon className="size-4" />
      <span className="sr-only">展开/收起计划</span>
    </Button>
  </CollapsibleTrigger>
);
