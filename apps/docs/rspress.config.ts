import { defineConfig } from "rspress/config";

export default defineConfig({
  root: "docs",
  title: "Teamsland",
  description: "Team AI Collaboration Platform — Architecture & API Documentation",
  themeConfig: {
    sidebar: {
      "/": [{ text: "Introduction", link: "/index" }],
    },
  },
});
