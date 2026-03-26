import { defineConfig } from "tsup";

export default defineConfig([
  // CLI + Server (Node.js)
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    target: "node18",
    platform: "node",
    outDir: "dist",
    clean: true,
    sourcemap: true,
    dts: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
    external: ["ws", "http-proxy"],
  },
  // Toolbar (Browser IIFE)
  {
    entry: ["src/toolbar/index.ts"],
    format: ["iife"],
    globalName: "OpenMagicToolbar",
    platform: "browser",
    target: "es2020",
    outDir: "dist/toolbar",
    minify: true,
    sourcemap: false,
    dts: false,
    noExternal: [/.*/],
  },
]);
