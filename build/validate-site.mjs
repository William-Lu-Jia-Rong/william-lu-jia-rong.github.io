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
  "project-smartrouteos.html",
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

  // The redesigned portfolio explicitly publishes hardware/software resumes.
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

const homepage = documents.get("index.html") ?? "";
const avatarChapters = [...homepage.matchAll(/data-avatar-chapter=["']([^"']+)["']/gi)]
  .map((match) => match[1]);
const requiredAvatarChapters = [
  "intro",
  "embedded",
  "warg",
  "pocketpilot",
  "ai",
  "profile",
];

if (!/data-avatar-world(?:\s|>)/i.test(homepage)) {
  failures.push("index.html: missing continuous avatar world mount");
}
if (!/data-avatar-canvas(?:\s|>)/i.test(homepage)) {
  failures.push("index.html: missing decorative avatar canvas");
}
for (const chapter of requiredAvatarChapters) {
  if (!avatarChapters.includes(chapter)) {
    failures.push(`index.html: missing avatar chapter ${chapter}`);
  }
}

await access(resolve(root, "js", "avatar-world.js"));
await access(resolve(root, "js", "vendor", "three.module.min.js"));
await access(resolve(root, "js", "vendor", "three.core.min.js"));
await access(resolve(root, "js", "vendor", "THREE-LICENSE.txt"));

const model = await readFile(resolve(root, "assets/3d/bill-workshop.glb"));
if (model.readUInt32LE(0) !== 0x46546c67 || model.readUInt32LE(4) !== 2 || model.readUInt32LE(8) !== model.length) {
  failures.push("bill-workshop.glb: invalid GLB");
} else {
  const gltf = JSON.parse(model.subarray(20, 20 + model.readUInt32LE(12)).toString("utf8"));
  const names = new Set(gltf.nodes.map(node => node.name));
  for (const name of ["RobotRoot", "CameraDesktop", "CameraMobile", "Driver", "Fastener", "PhoneScreen", "RouteScreen"]) {
    if (!names.has(name)) failures.push(`Workshop rig missing ${name}`);
  }
  const animatedNodes = new Set(gltf.animations.flatMap(clip => clip.channels.map(channel => gltf.nodes[channel.target.node].name)));
  for (const name of ["RobotRoot", "CameraDesktop", "CameraMobile", "Forearm_1", "Fastener", "Drone"]) {
    if (!animatedNodes.has(name)) failures.push(`Workshop has no baked motion for ${name}`);
  }
  if (!gltf.animations.some(clip => clip.samplers.some(s => gltf.accessors[s.input].count > 50))) {
    failures.push("Workshop must contain continuous animation, not static poses");
  }
  if ([...(gltf.buffers || []), ...(gltf.images || [])].some(asset => asset.uri)) {
    failures.push("Workshop GLB must be self-contained");
  }
}
const environment = await readFile(resolve(root, "assets/3d/aerodynamics-workshop-1k.hdr"));
if (model.length + environment.length > 5_000_000) failures.push("Initial workshop model and HDR exceed 5 MB");
await access(resolve(root, "assets/3d/bill-workshop.blend"));
await access(resolve(root, "assets/3d/ATTRIBUTIONS.md"));
const { SHOTS, WORKSHOP_RANGES } = await import("../js/workshop-shots.js");
if (JSON.stringify(avatarChapters) !== JSON.stringify(SHOTS.map(shot => shot.id))) {
  failures.push("HTML chapter order differs from the authored camera timeline");
}
if (WORKSHOP_RANGES.length !== avatarChapters.length + 1) failures.push("Invalid workshop timeline ranges");
for (const anchor of ["work", "water", "contact", "resume"]) {
  if (!homepage.includes(`id="${anchor}"`)) failures.push(`Missing legacy/navigation anchor ${anchor}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${routes.length} published routes, local assets, anchors, headings, and privacy rules.`);
}
