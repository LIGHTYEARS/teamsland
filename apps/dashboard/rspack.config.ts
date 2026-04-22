import { defineConfig } from "@rspack/cli";
import { rspack } from "@rspack/core";
import RefreshPlugin from "@rspack/plugin-react-refresh";

const isDev = process.env.NODE_ENV === "development";

export default defineConfig({
  entry: { main: "./src/index.tsx" },
  resolve: { extensions: [".ts", ".tsx", ".js", ".jsx"] },
  experiments: { css: true },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: { syntax: "typescript", tsx: true },
              transform: { react: { runtime: "automatic", development: isDev, refresh: isDev } },
            },
          },
        },
      },
      {
        test: /\.css$/,
        use: ["postcss-loader"],
        type: "css",
      },
    ],
  },
  plugins: [new rspack.HtmlRspackPlugin({ template: "./src/index.html" }), isDev && new RefreshPlugin()].filter(
    Boolean,
  ),
  devServer: {
    port: 5173,
    hot: true,
    proxy: [{ context: ["/api", "/health", "/auth"], target: "http://localhost:3001", ws: true }],
  },
});
