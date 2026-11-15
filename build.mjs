import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
const res = await build({
  entryPoints: ["src/ui/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  write: false,
  legalComments: "none",
});
const js = res.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const html = readFileSync("src/ui/index.html", "utf8").replace("<script>/*APP*/</script>", () => `<script>${js}</script>`);
writeFileSync("dist/tophatt.html", html);
console.log("dist/tophatt.html", (html.length / 1024).toFixed(0), "KB");
