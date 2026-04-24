"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@teamsland/ui/components/ui/accordion";
import { Badge } from "@teamsland/ui/components/ui/badge";
import { cn } from "@teamsland/ui/lib/utils";
import { BotIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { memo } from "react";

import { CodeBlock } from "./code-block";

/**
 * Agent 根容器
 *
 * @example
 * ```tsx
 * <Agent>
 *   <AgentHeader name="Researcher" model="claude-3" />
 *   <AgentContent>...</AgentContent>
 * </Agent>
 * ```
 */
export type AgentProps = ComponentProps<"div">;

export const Agent = memo(({ className, ...props }: AgentProps) => (
  <div className={cn("not-prose w-full rounded-md border", className)} {...props} />
));

/**
 * Agent 头部（名称 + 模型徽章 + 可选图标）
 *
 * @example
 * ```tsx
 * <AgentHeader name="Code Reviewer" model="claude-sonnet" />
 * ```
 */
export type AgentHeaderProps = ComponentProps<"div"> & {
  name: string;
  model?: string;
  icon?: ReactNode;
};

export const AgentHeader = memo(({ className, name, model, icon, ...props }: AgentHeaderProps) => (
  <div className={cn("flex w-full items-center justify-between gap-4 p-3", className)} {...props}>
    <div className="flex items-center gap-2">
      {icon ?? <BotIcon className="size-4 text-muted-foreground" />}
      <span className="font-medium text-sm">{name}</span>
      {model && (
        <Badge className="font-mono text-xs" variant="secondary">
          {model}
        </Badge>
      )}
    </div>
  </div>
));

/**
 * Agent 内容区域
 *
 * @example
 * ```tsx
 * <AgentContent>
 *   <AgentInstructions>执行代码审查</AgentInstructions>
 * </AgentContent>
 * ```
 */
export type AgentContentProps = ComponentProps<"div">;

export const AgentContent = memo(({ className, ...props }: AgentContentProps) => (
  <div className={cn("space-y-4 p-4 pt-0", className)} {...props} />
));

/**
 * Agent 指令展示
 *
 * @example
 * ```tsx
 * <AgentInstructions>搜索代码库中的身份验证逻辑</AgentInstructions>
 * ```
 */
export type AgentInstructionsProps = ComponentProps<"div"> & {
  children: string;
};

export const AgentInstructions = memo(({ className, children, ...props }: AgentInstructionsProps) => (
  <div className={cn("space-y-2", className)} {...props}>
    <span className="font-medium text-muted-foreground text-sm">指令</span>
    <div className="rounded-md bg-muted/50 p-3 text-muted-foreground text-sm">
      <p>{children}</p>
    </div>
  </div>
));

/**
 * Agent 工具列表（Accordion 手风琴展开 JSON Schema）
 *
 * @example
 * ```tsx
 * <AgentTools type="multiple">
 *   <AgentTool name="web_search" description="搜索网页" schema='{"query":"string"}' value="web_search" />
 * </AgentTools>
 * ```
 */
export type AgentToolsProps = ComponentProps<typeof Accordion>;

export const AgentTools = memo(({ className, ...props }: AgentToolsProps) => (
  <div className={cn("space-y-2", className)}>
    <span className="font-medium text-muted-foreground text-sm">工具</span>
    <Accordion className="rounded-md border" {...props} />
  </div>
));

/**
 * Agent 单个工具条目（手风琴项，展开查看 Schema）
 *
 * @example
 * ```tsx
 * <AgentTool name="read_url" description="读取 URL 内容" schema='{"url":"string"}' value="read_url" />
 * ```
 */
export type AgentToolProps = ComponentProps<typeof AccordionItem> & {
  name: string;
  description?: string;
  schema?: string;
};

export const AgentTool = memo(({ className, name, description, schema, value, ...props }: AgentToolProps) => (
  <AccordionItem className={cn("border-b last:border-b-0", className)} value={value} {...props}>
    <AccordionTrigger className="px-3 py-2 text-sm hover:no-underline">
      <span className="flex items-center gap-2">
        <span className="font-medium">{name}</span>
        {description && <span className="text-muted-foreground text-xs">{description}</span>}
      </span>
    </AccordionTrigger>
    {schema && (
      <AccordionContent className="px-3 pb-3">
        <div className="rounded-md bg-muted/50">
          <CodeBlock code={schema} language="json" />
        </div>
      </AccordionContent>
    )}
  </AccordionItem>
));

/**
 * Agent 输出展示（使用 CodeBlock 语法高亮或纯文本）
 *
 * @example
 * ```tsx
 * <AgentOutput schema="z.object({ result: z.string() })" />
 * <AgentOutput>{plainTextResult}</AgentOutput>
 * ```
 */
export type AgentOutputProps = ComponentProps<"div"> & {
  schema?: string;
};

export const AgentOutput = memo(({ className, schema, children, ...props }: AgentOutputProps) => (
  <div className={cn("space-y-2", className)} {...props}>
    <span className="font-medium text-muted-foreground text-sm">结果</span>
    {schema ? (
      <div className="rounded-md bg-muted/50">
        <CodeBlock code={schema} language="typescript" />
      </div>
    ) : (
      <div className="rounded-md bg-muted/50 p-3 text-sm">{children}</div>
    )}
  </div>
));

Agent.displayName = "Agent";
AgentHeader.displayName = "AgentHeader";
AgentContent.displayName = "AgentContent";
AgentInstructions.displayName = "AgentInstructions";
AgentTools.displayName = "AgentTools";
AgentTool.displayName = "AgentTool";
AgentOutput.displayName = "AgentOutput";
