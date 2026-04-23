import type { MeegoEvent } from "@teamsland/types";
import type { HookContext } from "../../types.js";

export const description = "测试用 hook";
export const priority = 10;

export const match = (event: MeegoEvent): boolean => event.type === "issue.created";

export const handle = async (_event: MeegoEvent, ctx: HookContext): Promise<void> => {
  ctx.log.info({ hookId: "valid-hook" }, "valid hook executed");
};
