import { createAvatarTimeline } from "./avatar-timeline.js";
import { SHOTS, WORKSHOP_RANGES } from "./workshop-shots.js";

const body = document.body;
const story = document.querySelector("[data-story]");
const canvas = document.querySelector("[data-avatar-canvas]");
const chapters = [...document.querySelectorAll("[data-avatar-chapter]")];
const stages = chapters.map((chapter) =>
  chapter.querySelector(".chapter-stage"),
);
const chapterLinks = [
  ...document.querySelectorAll(".chapter-nav a, .mobile-chapters a"),
];
const toggle = document.querySelector("[data-motion-toggle]");
const status = document.querySelector("[data-load-status]");
const preference = matchMedia("(prefers-reduced-motion: reduce)");
const compact = matchMedia(
  "(max-height: 600px) and (max-width: 1100px), (max-height: 700px) and (max-width: 760px)",
);
const connection = navigator.connection;
const timeline = createAvatarTimeline({
  chapters,
  ranges: WORKSHOP_RANGES,
  viewportAnchor: 0,
  springFrequency: 17,
});
const posterShot = SHOTS.find(
  (shot) => shot.id === new URLSearchParams(location.search).get("poster"),
);
if (posterShot) body.classList.add("poster-mode");
let world = null;
let controller = null;
let frame = 0;
let dirty = true;
let measure = true;
let storyEnd = 1;
let staticMode = preference.matches || Boolean(connection?.saveData);
let lastFrameTime = 0;
let lastDrawTime = 0;
let slowFrames = 0;
let generation = 0;
let reviewActive = false;
let initialHashPending = Boolean(location.hash);
try {
  const saved = sessionStorage.getItem("workshop-motion");
  if (saved !== null) staticMode = saved === "reduced";
} catch {
  /* Storage is optional. */
}
toggle.checked = staticMode;

function measurements() {
  storyEnd = story.getBoundingClientRect().bottom + scrollY;
  timeline.refresh({ scrollHeight: storyEnd });
  measure = false;
}
function schedule() {
  if (!frame && !document.hidden) frame = requestAnimationFrame(render);
}
function alignHash() {
  let id;
  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    return;
  }
  const target = chapters.find((chapter) => chapter.id === id);
  if (!target) return;
  window.scrollTo({
    top: target.getBoundingClientRect().top + scrollY + 1,
    behavior: "instant",
  });
  measurements();
  timeline.jump();
  dirty = true;
  schedule();
}
function alignInitialHash() {
  if (!initialHashPending) return;
  initialHashPending = false;
  alignHash();
}
function render(timestamp) {
  frame = 0;
  if (measure) measurements();
  if (dirty) timeline.sample(scrollY);
  const state = timeline.step(timestamp, staticMode || compact.matches);
  const active = Boolean(posterShot) || scrollY < storyEnd;
  const navigationState = timeline.locate(timeline.targetProgress);
  stages.forEach((stage, index) => {
    const current = active && index === navigationState.chapterIndex;
    stage.classList.toggle("is-current", current);
    if (current) {
      const local = navigationState.chapterProgress;
      const enter = index === 0 ? 1 : Math.min(1, 0.35 + local * 16);
      const leave =
        index === stages.length - 1 ? 1 : Math.min(1, (1 - local) / 0.09);
      stage.style.setProperty("--copy-opacity", String(Math.min(enter, leave)));
    }
  });
  chapterLinks.forEach((link) => {
    if (active && link.hash === "#" + chapters[navigationState.chapterIndex].id)
      link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
  if (
    world &&
    active &&
    !staticMode &&
    !reviewActive &&
    (!compact.matches || posterShot)
  ) {
    const moving = !timeline.isSettled();
    // Main scroll motion uses native refresh; settled secondary motion caps at 30 fps.
    if (dirty || moving || timestamp - lastDrawTime >= 1000 / 30) {
      world.update(
        posterShot ? posterShot.pose : state.progress,
        posterShot ? null : timestamp,
      );
      lastDrawTime = timestamp;
    }
    if (
      lastFrameTime &&
      timestamp - lastFrameTime > 40 &&
      timestamp - lastFrameTime < 250
    ) {
      slowFrames++;
    } else {
      slowFrames = 0;
    }
    if (slowFrames > 25) {
      world.lowerQuality();
      slowFrames = 0;
    }
  }
  dirty = false;
  lastFrameTime = timestamp;
  if (
    (!timeline.isSettled() || (!posterShot && world?.needsIdle())) &&
    !staticMode &&
    !reviewActive &&
    active
  )
    schedule();
}
function fallback(message = "") {
  body.classList.remove("world-ready");
  status.textContent = message;
  world?.dispose();
  world = null;
  controller?.abort();
  // Keep chapter heights stable after a load failure, so deep links do not move.
  dirty = true;
  measure = true;
  schedule();
}
async function start() {
  const token = ++generation;
  controller?.abort();
  world?.dispose();
  world = null;
  body.classList.remove("world-ready");
  const useStills = !posterShot && (staticMode || compact.matches);
  body.classList.toggle("static-mode", useStills);
  body.classList.toggle("motion-override", !staticMode);
  toggle.checked = useStills;
  toggle.disabled = compact.matches;
  toggle.title = compact.matches ? "Still images in compact view" : "";
  measure = true;
  dirty = true;
  schedule();
  if (useStills) {
    status.textContent = "";
    return;
  }
  controller = new AbortController();
  const signal = controller.signal;
  status.textContent = "Loading workshop...";
  const timeout = setTimeout(() => {
    if (token === generation) {
      generation++;
      fallback("3D unavailable. Showing stills.");
    }
  }, 16000);
  try {
    const { createWorkshopWorld } = await import("./workshop-world.js");
    if (signal.aborted) return;
    const loaded = await createWorkshopWorld(canvas, {
      signal,
      poster: Boolean(posterShot),
      onInvalidate: () => {
        dirty = true;
        schedule();
      },
      onFailure: () => fallback("3D interrupted. Showing stills."),
    });
    if (token !== generation || signal.aborted) {
      loaded.dispose();
      return;
    }
    world = loaded;
    if (posterShot) await world.preloadScreens();
    body.classList.add("world-ready");
    status.textContent = "";
    measurements();
    timeline.jump();
    dirty = true;
    schedule();
    alignInitialHash();
  } catch (error) {
    if (token === generation && !signal.aborted) {
      console.warn("Workshop fallback:", error);
      fallback("3D unavailable. Showing stills.");
    }
  } finally {
    clearTimeout(timeout);
  }
}
toggle.addEventListener("change", () => {
  staticMode = toggle.checked;
  const current =
    chapters[timeline.locate(timeline.targetProgress).chapterIndex];
  try {
    sessionStorage.setItem("workshop-motion", staticMode ? "reduced" : "full");
  } catch {
    /* Optional preference. */
  }
  start();
  current?.scrollIntoView({ behavior: "instant", block: "start" });
});
preference.addEventListener("change", () => {
  staticMode = preference.matches;
  start();
});
compact.addEventListener("change", () => {
  start();
});
window.addEventListener(
  "scroll",
  () => {
    dirty = true;
    schedule();
  },
  { passive: true },
);
let resizeTimer;
window.addEventListener(
  "resize",
  () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      measure = true;
      dirty = true;
      world?.resize();
      schedule();
    }, 100);
  },
  { passive: true },
);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(frame);
    frame = 0;
  } else {
    lastFrameTime = 0;
    timeline.jump();
    dirty = true;
    schedule();
  }
});
window.addEventListener("pageshow", () => {
  measure = true;
  dirty = true;
  schedule();
});
document.fonts?.ready.then(() => {
  measure = true;
  alignInitialHash();
  schedule();
});
for (const type of ["wheel", "touchstart"])
  window.addEventListener(
    type,
    () => {
      initialHashPending = false;
    },
    { passive: true },
  );
document.addEventListener("keydown", (event) => {
  if (
    ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(
      event.key,
    )
  )
    initialHashPending = false;
});
document.addEventListener("click", (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  const id = link.getAttribute("href").slice(1);
  const target = chapters.find((chapter) => chapter.id === id);
  if (!target) return;
  event.preventDefault();
  initialHashPending = false;
  history.pushState(null, "", "#" + id);
  alignHash();
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
});
window.addEventListener("hashchange", alignHash);
window.addEventListener("popstate", alignHash);

const menuButton = document.querySelector(".menu-button");
const menu = document.querySelector("#site-menu");
function closeMenu(returnFocus = false) {
  menu.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Open navigation");
  if (returnFocus) menuButton.focus();
}
menuButton.addEventListener("click", () => {
  if (!menu.hidden) closeMenu();
  else {
    menu.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");
    menuButton.setAttribute("aria-label", "Close navigation");
  }
});
menu.addEventListener("click", (event) => {
  if (event.target.closest("a")) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !menu.hidden) closeMenu(true);
});
document.addEventListener("click", (event) => {
  if (!menu.contains(event.target) && !menuButton.contains(event.target))
    closeMenu();
});
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) {
    controller?.abort();
    world?.dispose();
  }
});

// Local review hook: deterministic frame sampling and rig contact measurements.
if (new URLSearchParams(location.search).has("debug")) {
  window.__workshop = {
    shots: SHOTS,
    sample(progress) {
      world?.update(progress);
    },
    diagnostics() {
      return world?.diagnostics();
    },
    lowerQuality() {
      world?.lowerQuality();
      dirty = true;
      schedule();
    },
  };
}
start();
if (new URLSearchParams(location.search).has("review")) {
  import("./workshop-review.js").then(({ mountDeviceReview }) =>
    mountDeviceReview({
      diagnostics: () => world?.diagnostics(),
      sample: (progress) => world?.update(progress),
      shots: SHOTS,
      onRunState: (running) => {
        reviewActive = running;
        dirty = true;
        schedule();
      },
    }),
  );
}
