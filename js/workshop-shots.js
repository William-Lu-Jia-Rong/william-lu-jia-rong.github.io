export const SHOTS = Object.freeze([
  { id: "intro", start: 0, end: 0.14, pose: 0.08 },
  { id: "embedded", start: 0.14, end: 0.34, pose: 0.235 },
  { id: "warg", start: 0.34, end: 0.52, pose: 0.43 },
  { id: "pocketpilot", start: 0.52, end: 0.7, pose: 0.62 },
  { id: "ai", start: 0.7, end: 0.88, pose: 0.8 },
  { id: "profile", start: 0.88, end: 1, pose: 0.98 },
]);
export const WORKSHOP_RANGES = Object.freeze([
  ...SHOTS.map((shot) => shot.start),
  1,
]);
export const ASSETS = Object.freeze({
  model: new URL("../assets/3d/bill-workshop.glb", import.meta.url).href,
  environment: new URL(
    "../assets/3d/aerodynamics-workshop-1k.hdr",
    import.meta.url,
  ).href,
  insights: new URL(
    "../images/pocketpilot/screenshot-insights.webp",
    import.meta.url,
  ).href,
  scan: new URL("../images/pocketpilot/screenshot-scan.webp", import.meta.url)
    .href,
  routes: new URL("../images/smartrouteos/decision.webp", import.meta.url).href,
});
