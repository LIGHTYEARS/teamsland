import type { MeegoEvent } from "@teamsland/types";
import type { HookContext } from "../../types.js";

export const description = "超时测试 hook";
export const priority = 50;

export const match = (_event: MeegoEvent): boolean => true;

export const handle = async (_event: MeegoEvent, _ctx: HookContext): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10_000)); // 10s delay
};
