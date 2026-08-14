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

const homepage = documents.get("index.html") ?? "";
const avatarChapters = [...homepage.matchAll(/data-avatar-chapter=["']([^"']+)["']/gi)]
  .map((match) => match[1]);
const requiredAvatarChapters = [
  "intro",
  "pocketpilot",
  "warg",
  "embedded",
  "ai",
  "water",
  "work",
  "profile",
  "contact",
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

const robotModelPath = resolve(root, "assets", "3d", "poddy-m1.glb");
const workshopEnvironmentPath = resolve(root, "assets", "3d", "aerodynamics-workshop-1k.hdr");
const robotModel = await readFile(robotModelPath);
const workshopEnvironment = await readFile(workshopEnvironmentPath);
const requiredRobotRigNodes = [
  "head_ctrl01",
  "eye_l_ctrl01",
  "eye_r_ctrl01",
  "arm_l_ctrl01",
  "arm_r_ctrl01",
];

if (robotModel.length > 1_500_000) {
  failures.push(`poddy-m1.glb: model exceeds the 1.5 MB web budget (${robotModel.length} bytes)`);
}
if (robotModel.length < 20 || robotModel.readUInt32LE(0) !== 0x46546c67) {
  failures.push("poddy-m1.glb: invalid GLB magic header");
} else if (robotModel.readUInt32LE(4) !== 2) {
  failures.push(`poddy-m1.glb: expected GLB version 2, found ${robotModel.readUInt32LE(4)}`);
} else if (robotModel.readUInt32LE(8) !== robotModel.length) {
  failures.push("poddy-m1.glb: declared byte length does not match the file");
} else {
  const jsonLength = robotModel.readUInt32LE(12);
  const jsonType = robotModel.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a || 20 + jsonLength > robotModel.length) {
    failures.push("poddy-m1.glb: missing or invalid JSON chunk");
  } else {
    try {
      const jsonText = robotModel.subarray(20, 20 + jsonLength).toString("utf8").trimEnd();
      const gltf = JSON.parse(jsonText);
      const nodeNames = new Set((gltf.nodes ?? []).map((node) => node.name).filter(Boolean));
      const externalUris = [
        ...(gltf.buffers ?? []).map((buffer) => buffer.uri),
        ...(gltf.images ?? []).map((image) => image.uri),
      ].filter(Boolean);

      if (!(gltf.skins?.length > 0)) failures.push("poddy-m1.glb: missing skinned rig");
      for (const nodeName of requiredRobotRigNodes) {
        if (!nodeNames.has(nodeName)) failures.push(`poddy-m1.glb: missing ${nodeName} rig node`);
      }
      if (externalUris.length) failures.push("poddy-m1.glb: external asset URIs are not allowed");
    } catch (error) {
      failures.push(`poddy-m1.glb: invalid JSON (${error.message})`);
    }
  }
}

const hdrSignature = workshopEnvironment.subarray(0, 12).toString("ascii");
if (!hdrSignature.startsWith("#?RADIANCE") && !hdrSignature.startsWith("#?RGBE")) {
  failures.push("aerodynamics-workshop-1k.hdr: invalid Radiance HDR signature");
}
if (workshopEnvironment.length > 2_000_000) {
  failures.push(`aerodynamics-workshop-1k.hdr: environment exceeds the 2 MB web budget (${workshopEnvironment.length} bytes)`);
}

await access(resolve(root, "assets", "3d", "ATTRIBUTIONS.md"));
await access(resolve(root, "js", "vendor", "addons", "loaders", "GLTFLoader.js"));
await access(resolve(root, "js", "vendor", "addons", "loaders", "HDRLoader.js"));
await access(resolve(root, "js", "vendor", "addons", "utils", "BufferGeometryUtils.js"));
await access(resolve(root, "js", "vendor", "addons", "utils", "SkeletonUtils.js"));

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${routes.length} published routes, local assets, anchors, headings, and privacy rules.`);
}
