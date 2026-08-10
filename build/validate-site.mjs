import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const routes = [
  "index.html",
  "projects.html",
  "experience.html",
  "about.html",
  "contact.html",
  "project-pocketpilot.html",
  "experience-warg.html",
  "experience-embedded-control.html",
  "experience-automate-agency.html",
  "project-water-quality.html",
  "project-bridgenet.html",
];

const documents = new Map();
const failures = [];

for (const route of routes) {
  const html = await readFile(resolve(root, route), "utf8");
  documents.set(route, html);

  const h1Count = (html.match(/<h1(?:\s|>)/gi) ?? []).length;
  if (h1Count !== 1) failures.push(`${route}: expected one h1, found ${h1Count}`);

  const ids = [...html.matchAll(/\sid=["']([^"']+)["']/gi)].map((match) => match[1]);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicateIds.length) failures.push(`${route}: duplicate ids ${duplicateIds.join(", ")}`);

  if (/href=["'][^"']*Resume_(?:Hardware|Software)\.pdf/i.test(html)) {
    failures.push(`${route}: résumé download is exposed`);
  }
  if (/href=["']tel:/i.test(html)) failures.push(`${route}: telephone link is exposed`);
}

for (const [route, html] of documents) {
  const references = [...html.matchAll(/\s(?:href|src)=["']([^"']+)["']/gi)].map((match) => match[1]);

  for (const reference of references) {
    if (/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(reference)) continue;

    const [rawPath, fragment] = reference.split("#", 2);
    const decodedPath = decodeURIComponent(rawPath.split("?", 1)[0]);
    const targetRoute = decodedPath
      ? resolve(dirname(resolve(root, route)), decodedPath.replace(/^\//, ""))
      : resolve(root, route);

    try {
      await access(targetRoute);
    } catch {
      failures.push(`${route}: missing local reference ${reference}`);
      continue;
    }

    if (!fragment || !targetRoute.endsWith(".html")) continue;
    const targetHtml = await readFile(targetRoute, "utf8");
    const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`\\sid=["']${escaped}["']`, "i").test(targetHtml)) {
      failures.push(`${route}: missing anchor target ${reference}`);
    }
  }
}

await access(resolve(root, "images", "og.png"));

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${routes.length} published routes, local assets, anchors, headings, and privacy rules.`);
}
