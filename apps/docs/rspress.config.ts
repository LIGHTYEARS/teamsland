import { defineConfig } from "rspress/config";

export default defineConfig({
  root: "docs",
  title: "Teamsland",
  lang: "zh",
  description: "团队 AI 协作平台 — 架构文档与使用指南",
  themeConfig: {
    nav: [
      { text: "指南", link: "/guide/getting-started" },
      { text: "架构", link: "/guide/architecture" },
      { text: "参考", link: "/reference/config" },
    ],
    sidebar: {
      "/": [
        { text: "首页", link: "/index" },
        {
          text: "使用指南",
          items: [
            { text: "快速开始", link: "/guide/getting-started" },
            { text: "架构总览", link: "/guide/architecture" },
            { text: "核心概念", link: "/guide/core-concepts" },
            { text: "事件管线", link: "/guide/event-pipeline" },
            { text: "记忆系统", link: "/guide/memory-system" },
            { text: "Dashboard", link: "/guide/dashboard" },
            { text: "部署运维", link: "/guide/deployment" },
          ],
        },
        {
          text: "参考手册",
          items: [
            { text: "配置文件", link: "/reference/config" },
            { text: "包一览", link: "/reference/packages" },
            { text: "Server API", link: "/reference/server-api" },
          ],
        },
      ],
    },
  },
});
