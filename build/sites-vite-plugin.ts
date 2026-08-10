import { access, copyFile, cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

// Package the static Worker entry point, Sites metadata, and optional
// migrations after Vite finishes compiling the browser-facing pages.
export function sites(): Plugin {
  let root = process.cwd();
  let packageDirectory = resolve(root, "dist");
  let clientOutputDirectory = resolve(packageDirectory, "client");

  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
      clientOutputDirectory = resolve(root, config.build.outDir);
      packageDirectory = resolve(clientOutputDirectory, "..");
    },
    async buildStart() {
      // The Sites archive has three sibling surfaces: client, server, and
      // .openai. Clear only this generated package before recreating it.
      await rm(packageDirectory, { recursive: true, force: true });
    },
    async closeBundle() {
      const metadataOutput = resolve(packageDirectory, ".openai");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "drizzle");
      const workerSource = resolve(root, "worker", "index.js");
      const workerOutput = resolve(packageDirectory, "server", "index.js");
      const socialCardSource = resolve(root, "images", "og.png");
      const socialCardOutput = resolve(
        clientOutputDirectory,
        "images",
        "og.png",
      );

      await rm(metadataOutput, { recursive: true, force: true });
      await mkdir(metadataOutput, { recursive: true });
      await mkdir(resolve(packageDirectory, "server"), { recursive: true });

      await copyFile(workerSource, workerOutput);

      if (await exists(socialCardSource)) {
        await mkdir(resolve(clientOutputDirectory, "images"), {
          recursive: true,
        });
        await copyFile(socialCardSource, socialCardOutput);
      }

      if (await exists(hostingConfig)) {
        await copyFile(hostingConfig, resolve(metadataOutput, "hosting.json"));
      }
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(metadataOutput, "drizzle"), {
          recursive: true,
        });
      }
    },
  };
}
