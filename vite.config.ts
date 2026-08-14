import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin.ts";

const root = process.cwd();

// Publish the rebuilt portfolio only. Earlier source pages stay in the repo as
// archive material but are intentionally absent from the release.
const publishedPages = [
  "index.html",
  "projects.html",
  "experience.html",
  "about.html",
  "contact.html",
  "project-smartrouteos.html",
  "project-pocketpilot.html",
  "experience-warg.html",
  "experience-embedded-control.html",
  "experience-automate-agency.html",
  "project-water-quality.html",
  "project-bridgenet.html",
];

const pageEntries = Object.fromEntries(
  publishedPages
    .filter((fileName) => existsSync(resolve(root, fileName)))
    .map((fileName) => [fileName.slice(0, -5), resolve(root, fileName)]),
);

// Named module entries preserve stable source-compatible URLs for both the
// branch-served GitHub Pages site and the compiled Sites package.
const classicScripts = Object.fromEntries(
  ["site", "cinematic"]
    .map((name) => [name, resolve(root, "js", `${name}.js`)] as const)
    .filter(([, filePath]) => existsSync(filePath))
    .map(([name, filePath]) => [`js/${name}`, filePath]),
);
const buildEntries = { ...pageEntries, ...classicScripts };

export default defineConfig({
  plugins: [sites()],
  assetsInclude: ["**/*.glb", "**/*.hdr"],
  build: {
    outDir: "dist/client",
    target: "es2022",
    rollupOptions: {
      input: buildEntries,
      output: {
        entryFileNames: (chunk) =>
          chunk.name.startsWith("js/")
            ? `${chunk.name}.js`
            : "assets/[name]-[hash].js",
      },
    },
  },
});
