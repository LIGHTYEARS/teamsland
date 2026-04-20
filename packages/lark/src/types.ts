/**
 * 飞书消息数据传输对象
 *
 * @example
 * ```typescript
 * import type { LarkMessage } from "@teamsland/lark";
 *
 * const msg: LarkMessage = {
 *   messageId: "om_abc123",
 *   sender: "ou_user001",
 *   content: "你好",
 *   timestamp: 1713600000000,
 * };
 * ```
 */
export interface LarkMessage {
  messageId: string;
  sender: string;
  content: string;
  timestamp: number;
}

/**
 * 飞书联系人数据传输对象
 *
 * @example
 * ```typescript
 * import type { LarkContact } from "@teamsland/lark";
 *
 * const contact: LarkContact = {
 *   userId: "ou_user001",
 *   name: "张三",
 *   department: "工程部",
 * };
 * ```
 */
export interface LarkContact {
  userId: string;
  name: string;
  department: string;
}

/**
 * 飞书群组数据传输对象
 *
 * @example
 * ```typescript
 * import type { LarkGroup } from "@teamsland/lark";
 *
 * const group: LarkGroup = {
 *   chatId: "oc_chat001",
 *   name: "前端团队",
 *   description: "前端开发讨论群",
 * };
 * ```
 */
export interface LarkGroup {
  chatId: string;
  name: string;
  description: string;
}

/**
 * 飞书互动卡片数据传输对象
 *
 * @example
 * ```typescript
 * import type { LarkCard } from "@teamsland/lark";
 *
 * const card: LarkCard = {
 *   title: "部署通知",
 *   content: "v1.2.0 已发布到生产环境",
 *   level: "info",
 * };
 * ```
 */
export interface LarkCard {
  title: string;
  content: string;
  level: "info" | "warning" | "error";
}
