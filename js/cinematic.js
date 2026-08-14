"use strict";

import { createAvatarTimeline } from "./avatar-timeline.js";

const body = document.body;

if (body.classList.contains("home-page")) {
  body.dataset.scrollClock = "cinematic";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const scenes = Array.from(document.querySelectorAll("[data-scene]"));
  const chapters = Array.from(document.querySelectorAll("[data-avatar-chapter]"));
  const chapterLinks = Array.from(document.querySelectorAll("[data-chapter-link]"));
  const avatarCanvas = document.querySelector("[data-avatar-canvas]");
  const signalCanvas = document.querySelector("[data-signal-canvas]");
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const timeline = createAvatarTimeline({
    chapters,
    reducedMotion: reducedMotion.matches,
    viewportAnchor: 0.52,
    springFrequency: 14,
  });
  const sceneChapterIndices = new Map(
    scenes.map((scene) => [scene, chapters.indexOf(scene)]),
  );

  let avatarWorld = null;
  let avatarBootToken = 0;
  let avatarBootAbortController = null;
  let signalCleanup = null;
  let animationFrame = 0;
  let scrollDirty = true;
  let resizeDirty = true;
  let layoutDirty = true;
  let jumpToScroll = true;
  let nextMobileIdleFrameTime = 0;
  let lastScrollTime = performance.now();
  let pageActive = !document.hidden;
  let toolbarResizeTimer = 0;
  let lastViewportWidth = window.innerWidth;
  let lastViewportHeight = window.innerHeight;
  const initialHash = window.location.hash;
  let initialHashPending = Boolean(initialHash);
  let initialHashCancelled = false;
  let initialHashToken = 0;

  function clamp(value, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function map(value, start, end) {
    return clamp((value - start) / Math.max(end - start, 0.00001));
  }

  function setScrollTopImmediately(top) {
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    const maximum = Math.max(0, root.scrollHeight - window.innerHeight);
    root.style.scrollBehavior = "auto";
    window.scrollTo({
      top: clamp(top, 0, maximum),
      left: window.scrollX,
      behavior: "auto",
    });
    root.style.scrollBehavior = previousScrollBehavior;
  }

  function findHashTarget(hash) {
    if (!hash || hash === "#") return null;
    const rawId = hash.slice(1);
    try {
      return document.getElementById(decodeURIComponent(rawId));
    } catch (_) {
      return document.getElementById(rawId);
    }
  }

  function hasDataSaver() {
    return Boolean(connection && connection.saveData);
  }

  function setAvatarState(state) {
    body.classList.remove("avatar-ready", "avatar-fallback", "avatar-disabled");
    body.classList.add(`avatar-${state}`);
    layoutDirty = true;
    scrollDirty = true;
  }

  function finishLoader() {
    const loader = document.querySelector("[data-loader]");
    const bar = document.querySelector("[data-loader-bar]");
    const status = document.querySelector("[data-loader-status]");
    if (bar) bar.style.width = "100%";
    if (status) status.textContent = "System ready.";

    window.setTimeout(() => {
      body.classList.remove("is-loading");
      body.classList.add("is-loaded");
      if (loader) loader.setAttribute("aria-hidden", "true");
      try {
        window.sessionStorage.setItem("bill-portfolio-booted", "1");
      } catch (_) {
        // Storage is an optional enhancement.
      }
    }, reducedMotion.matches ? 0 : 240);
  }

  function setupLoader() {
    if (reducedMotion.matches) {
      finishLoader();
      return;
    }

    let seen = false;
    try {
      seen = window.sessionStorage.getItem("bill-portfolio-booted") === "1";
    } catch (_) {
      // Storage is an optional enhancement.
    }

    if (seen) {
      const loader = document.querySelector("[data-loader]");
      body.classList.remove("is-loading");
      body.classList.add("is-loaded");
      if (loader) loader.setAttribute("aria-hidden", "true");
      return;
    }

    const bar = document.querySelector("[data-loader-bar]");
    const status = document.querySelector("[data-loader-status]");
    if (bar) bar.style.width = "42%";
    if (status) status.textContent = "Loading control surfaces and product imagery…";

    const critical = Array.from(document.querySelectorAll(
      'img[fetchpriority="high"], img[rel="preload"], .hero-backdrop img',
    ));
    const ready = critical.map((image) => {
      if (image.complete) return Promise.resolve();
      if (typeof image.decode === "function") return image.decode().catch(() => {});
      return new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    });

    Promise.race([
      Promise.all(ready),
      new Promise((resolve) => window.setTimeout(resolve, 2400)),
    ]).then(() => {
      if (bar) bar.style.width = "82%";
      window.setTimeout(finishLoader, 150);
    });
  }

  function updatePhoneSystem(scene, progress) {
    const intro = map(progress, 0.02, 0.22);
    const focus = Math.min(3, Math.floor(clamp(progress * 4, 0, 3.999)));

    scene.querySelectorAll("[data-step]").forEach((step) => {
      step.classList.toggle("is-active", Number(step.dataset.step) === focus);
    });

    const front = scene.querySelector(".phone-card--front");
    const middle = scene.querySelector(".phone-card--mid");
    const rear = scene.querySelector(".phone-card--rear");
    if (!front || !middle || !rear) return;

    const mobile = window.innerWidth <= 820;
    const spread = mobile ? 0.72 : 1;
    const lift = (1 - intro) * 80;
    const frontScale = focus <= 1 ? 1 : 0.88;
    const middleScale = focus === 3 ? 1.03 : 0.9;
    const rearScale = focus === 2 ? 1.04 : 0.88;

    front.style.transform = `translate3d(-18%, calc(-50% + ${lift.toFixed(1)}px), 100px) rotateY(-8deg) scale(${frontScale})`;
    middle.style.transform = `translate3d(${(-18 - 59 * spread).toFixed(1)}%, calc(-48% + ${(lift * 0.8).toFixed(1)}px), 10px) rotateY(7deg) rotateZ(-4deg) scale(${middleScale})`;
    rear.style.transform = `translate3d(${(-18 + 53 * spread).toFixed(1)}%, calc(-46% + ${(lift * 0.6).toFixed(1)}px), -90px) rotateY(-12deg) rotateZ(5deg) scale(${rearScale})`;
    front.style.opacity = focus <= 1 ? "1" : "0.68";
    middle.style.opacity = focus === 3 ? "1" : "0.68";
    rear.style.opacity = focus === 2 ? "1" : "0.58";

  }

  function updatePipeline(scene, progress) {
    const items = Array.from(scene.querySelectorAll(".pipeline li"));
    if (!items.length) return;
    const active = Math.min(
      items.length - 1,
      Math.floor(clamp(progress * items.length, 0, items.length - 0.001)),
    );
    items.forEach((item, index) => item.classList.toggle("is-active", index === active));
  }

  function updateSceneEffects(state) {
    const activeName = chapters[state.chapterIndex]?.dataset.avatarChapter || "";
    scenes.forEach((scene) => {
      const chapterIndex = sceneChapterIndices.get(scene);
      const progress = chapterIndex >= 0
        ? timeline.chapterProgress(chapterIndex, state.progress)
        : 0;
      const exit = map(progress, 0.76, 1);
      const stage = scene.querySelector(".scene-stage");
      const target = stage || scene;

      target.style.setProperty("--scene-progress", progress.toFixed(4));
      target.style.setProperty("--scene-copy-y", `${(-72 * exit).toFixed(1)}px`);
      target.style.setProperty("--scene-copy-opacity", (1 - exit * 0.88).toFixed(3));
      target.style.setProperty("--scene-image-scale", (1.035 + progress * 0.085).toFixed(4));
      target.style.setProperty("--scene-image-x", `${(-34 * progress).toFixed(1)}px`);
      target.style.setProperty("--scene-image-y", `${((progress - 0.5) * 26).toFixed(1)}px`);
      target.style.setProperty("--scene-rotate", `${(progress * 86).toFixed(1)}deg`);
      target.style.setProperty("--hud-y", `${(-52 * progress).toFixed(1)}px`);

      if (scene.dataset.scene === "pocketpilot") updatePhoneSystem(scene, progress);
      if (scene.dataset.scene === "ai") updatePipeline(scene, progress);
    });

    chapterLinks.forEach((link) => {
      const active = link.dataset.chapterLink === activeName;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });

    document.documentElement.style.setProperty(
      "--scroll-progress",
      `${(state.progress * 100).toFixed(3)}%`,
    );
    const progressBar = document.querySelector("[data-scroll-progress]");
    if (progressBar) progressBar.style.transform = `scaleX(${state.progress.toFixed(4)})`;
    const header = document.querySelector("[data-header]");
    if (header) header.classList.toggle("is-scrolled", state.progress > 0.0005);
    body.dataset.scrollChapter = activeName;
  }

  function updateMeasurements() {
    if (layoutDirty) {
      timeline.refresh({
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
      });
      layoutDirty = false;
    } else if (scrollDirty) {
      timeline.sample(window.scrollY);
    }
    scrollDirty = false;
  }

  function finishInitialHashAlignment() {
    initialHashPending = false;
    initialHashToken += 1;
  }

  function scheduleInitialHashAlignment() {
    if (!initialHashPending || initialHashCancelled) return;
    const target = findHashTarget(initialHash);
    if (!target) {
      finishInitialHashAlignment();
      return;
    }

    const token = ++initialHashToken;
    const fontsReady = document.fonts?.ready || Promise.resolve();
    const settleTimeout = new Promise((resolve) => window.setTimeout(resolve, 320));

    Promise.race([fontsReady, settleTimeout]).then(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (token !== initialHashToken) return;
          if (initialHashCancelled || window.location.hash !== initialHash) {
            finishInitialHashAlignment();
            return;
          }

          const targetTop = window.scrollY + target.getBoundingClientRect().top;
          setScrollTopImmediately(targetTop);
          finishInitialHashAlignment();
          jumpToScroll = true;
          scrollDirty = true;
          updateMeasurements();
          scheduleAnimationFrame();
        });
      });
    });
  }

  function onNavigationIntent(event) {
    if (event.type === "keydown") {
      const scrollKeys = new Set([
        "ArrowDown",
        "ArrowUp",
        "End",
        "Home",
        "PageDown",
        "PageUp",
        " ",
      ]);
      if (!scrollKeys.has(event.key)) return;
    }

    if (initialHashPending) {
      initialHashCancelled = true;
      finishInitialHashAlignment();
    }
  }

  function scheduleAnimationFrame() {
    if (animationFrame || !pageActive) return;
    animationFrame = window.requestAnimationFrame(renderAvatarFrame);
  }

  function renderAvatarFrame(timestamp) {
    animationFrame = 0;
    if (!pageActive) return;

    const settled = timeline.isSettled();
    const mobile = window.innerWidth <= 820;
    const recentlyScrolled = timestamp - lastScrollTime < 180;

    if (mobile && avatarWorld?.ready && settled && !recentlyScrolled) {
      if (timestamp < nextMobileIdleFrameTime) {
        scheduleAnimationFrame();
        return;
      }
      nextMobileIdleFrameTime = timestamp + 1000 / 30;
    } else {
      nextMobileIdleFrameTime = 0;
    }

    if (resizeDirty && avatarWorld?.ready) {
      avatarWorld.resize(window.innerWidth, window.innerHeight, mobile);
      resizeDirty = false;
    }
    if (scrollDirty || layoutDirty) updateMeasurements();

    const state = timeline.step(timestamp, jumpToScroll);
    jumpToScroll = false;
    updateSceneEffects(state);

    const fadeProgress = map(state.progress, 0.985, 1);
    const endOpacity = 1 - fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
    if (avatarCanvas) avatarCanvas.style.opacity = endOpacity.toFixed(3);
    if (avatarWorld?.ready) avatarWorld.update(state);

    if (avatarWorld?.ready || !timeline.isSettled() || scrollDirty || layoutDirty) {
      scheduleAnimationFrame();
    }
  }

  function stopSignalCanvas() {
    if (!signalCleanup) return;
    signalCleanup();
    signalCleanup = null;
  }

  function setupSignalCanvas() {
    if (!signalCanvas || reducedMotion.matches || hasDataSaver() || signalCleanup) return;
    const context = signalCanvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let points = [];
    let frame = 0;
    let running = !document.hidden;
    const pointer = { x: -1000, y: -1000 };

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      signalCanvas.width = Math.round(width * ratio);
      signalCanvas.height = Math.round(height * ratio);
      signalCanvas.style.width = `${width}px`;
      signalCanvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = width < 700 ? 22 : 42;
      points = Array.from({ length: count }, (_, index) => ({
        x: ((((index * 83.7) % 100) / 100) * width),
        y: ((((index * 47.3 + 19) % 100) / 100) * height),
        vx: ((index % 5) - 2) * 0.035,
        vy: (((index * 3) % 5) - 2) * 0.028,
        radius: index % 7 === 0 ? 1.5 : 0.8,
      }));
    }

    function draw() {
      frame = 0;
      if (!running) return;
      context.clearRect(0, 0, width, height);

      points.forEach((point, index) => {
        point.x += point.vx;
        point.y += point.vy;
        if (point.x < -20) point.x = width + 20;
        if (point.x > width + 20) point.x = -20;
        if (point.y < -20) point.y = height + 20;
        if (point.y > height + 20) point.y = -20;

        for (let next = index + 1; next < points.length; next += 1) {
          const other = points[next];
          const distance = Math.hypot(point.x - other.x, point.y - other.y);
          if (distance > 135) continue;
          context.strokeStyle = `rgba(81,217,239,${((1 - distance / 135) * 0.075).toFixed(3)})`;
          context.lineWidth = 0.6;
          context.beginPath();
          context.moveTo(point.x, point.y);
          context.lineTo(other.x, other.y);
          context.stroke();
        }

        const pointerDistance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
        const glow = pointerDistance < 170 ? 1 - pointerDistance / 170 : 0;
        context.fillStyle = glow > 0
          ? `rgba(231,154,86,${(0.28 + glow * 0.55).toFixed(2)})`
          : "rgba(81,217,239,0.28)";
        context.beginPath();
        context.arc(point.x, point.y, point.radius + glow * 1.8, 0, Math.PI * 2);
        context.fill();
      });

      frame = window.requestAnimationFrame(draw);
    }

    function onPointerMove(event) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }

    function onVisibilityChange() {
      running = !document.hidden;
      if (running && !frame) frame = window.requestAnimationFrame(draw);
      if (!running && frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    resize();
    frame = window.requestAnimationFrame(draw);

    signalCleanup = () => {
      running = false;
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      context.clearRect(0, 0, width, height);
    };
  }

  function enterFallback() {
    if (reducedMotion.matches || hasDataSaver()) {
      setAvatarState("disabled");
      stopSignalCanvas();
      scheduleInitialHashAlignment();
      scheduleAnimationFrame();
      return;
    }
    setAvatarState("fallback");
    setupSignalCanvas();
    scheduleInitialHashAlignment();
    scheduleAnimationFrame();
  }

  function onContextLost() {
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    avatarWorld?.setActive(false);
    enterFallback();
  }

  function onContextRestored() {
    if (!avatarWorld?.ready || reducedMotion.matches || hasDataSaver()) return;
    stopSignalCanvas();
    setAvatarState("ready");
    scheduleInitialHashAlignment();
    avatarWorld.setActive(true);
    resizeDirty = true;
    jumpToScroll = true;
    scrollDirty = true;
    scheduleAnimationFrame();
  }

  function disposeAvatarWorld() {
    avatarBootToken += 1;
    avatarBootAbortController?.abort();
    avatarBootAbortController = null;
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    nextMobileIdleFrameTime = 0;
    if (avatarWorld) avatarWorld.dispose();
    avatarWorld = null;
  }

  async function bootAvatarWorld() {
    const token = ++avatarBootToken;
    avatarBootAbortController?.abort();
    const bootController = new AbortController();
    avatarBootAbortController = bootController;
    stopSignalCanvas();

    if (reducedMotion.matches || hasDataSaver() || !avatarCanvas) {
      bootController.abort();
      if (avatarBootAbortController === bootController) avatarBootAbortController = null;
      if (avatarWorld) avatarWorld.dispose();
      avatarWorld = null;
      setAvatarState("disabled");
      updateMeasurements();
      scheduleInitialHashAlignment();
      scheduleAnimationFrame();
      return;
    }

    let timeoutId = 0;
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        bootController.abort();
        reject(new Error("Avatar world startup timed out."));
      }, 12000);
    });

    try {
      const startup = import("./avatar-world.js").then((module) => module.createAvatarWorld({
          canvas: avatarCanvas,
          mobile: window.innerWidth <= 820,
          signal: bootController.signal,
          onContextLost,
          onContextRestored,
          onError: () => {
            if (token !== avatarBootToken || bootController.signal.aborted) return;
            if (avatarWorld) {
              avatarWorld.dispose();
              avatarWorld = null;
            }
            enterFallback();
          },
        })).then((world) => {
          if (token !== avatarBootToken || bootController.signal.aborted) {
            world.dispose();
            throw new DOMException("Avatar world startup was superseded.", "AbortError");
          }
          return world;
        });
      const world = await Promise.race([startup, timeout]);
      if (token !== avatarBootToken || bootController.signal.aborted) {
        world.dispose();
        return;
      }

      avatarWorld = world;
      if (avatarBootAbortController === bootController) avatarBootAbortController = null;
      stopSignalCanvas();
      setAvatarState("ready");
      scheduleInitialHashAlignment();
      resizeDirty = true;
      scrollDirty = true;
      jumpToScroll = true;
      updateMeasurements();
      scheduleAnimationFrame();
    } catch (_) {
      if (token === avatarBootToken) {
        if (avatarBootAbortController === bootController) avatarBootAbortController = null;
        enterFallback();
      }
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  }

  function onScroll() {
    scrollDirty = true;
    lastScrollTime = performance.now();
    scheduleAnimationFrame();
  }

  function onResize(event) {
    const nextWidth = window.innerWidth;
    const nextHeight = window.innerHeight;
    const widthChanged = Math.abs(nextWidth - lastViewportWidth) > 1;
    const heightChanged = Math.abs(nextHeight - lastViewportHeight) > 1;
    const orientationChanged = event?.type === "orientationchange"
      || (nextWidth > nextHeight) !== (lastViewportWidth > lastViewportHeight);
    const compactViewport = Math.max(nextWidth, lastViewportWidth) <= 820;
    const meaningfulLayoutResize = orientationChanged
      || widthChanged
      || (heightChanged && !compactViewport);

    lastViewportWidth = nextWidth;
    lastViewportHeight = nextHeight;
    if (meaningfulLayoutResize) {
      if (toolbarResizeTimer) window.clearTimeout(toolbarResizeTimer);
      toolbarResizeTimer = 0;
      resizeDirty = true;
      scrollDirty = true;
      layoutDirty = true;
      if (orientationChanged) jumpToScroll = true;
      scheduleAnimationFrame();
      return;
    }

    // Mobile browser chrome can emit dozens of height-only resize events while
    // the URL toolbar opens or closes. Keep the scroll mapping stable and resize
    // the WebGL buffer once after that animation settles.
    if (heightChanged) {
      if (toolbarResizeTimer) window.clearTimeout(toolbarResizeTimer);
      toolbarResizeTimer = window.setTimeout(() => {
        toolbarResizeTimer = 0;
        resizeDirty = true;
        scheduleAnimationFrame();
      }, 140);
    }
  }

  function onVisibilityChange() {
    pageActive = !document.hidden;
    avatarWorld?.setActive(pageActive);
    if (!pageActive && animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    } else if (pageActive) {
      scrollDirty = true;
      jumpToScroll = true;
      scheduleAnimationFrame();
    }
  }

  function onMotionPreferenceChange() {
    timeline.setReducedMotion(reducedMotion.matches);
    layoutDirty = true;
    scrollDirty = true;
    jumpToScroll = true;
    disposeAvatarWorld();
    stopSignalCanvas();
    bootAvatarWorld();
  }

  setupLoader();

  document.addEventListener("DOMContentLoaded", () => {
    updateMeasurements();
    scheduleAnimationFrame();
    bootAvatarWorld();
  }, { once: true });
  window.addEventListener("load", () => {
    layoutDirty = true;
    scrollDirty = true;
    scheduleAnimationFrame();
  }, { once: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("orientationchange", onResize, { passive: true });
  window.addEventListener("hashchange", () => {
    if (initialHashPending && window.location.hash !== initialHash) {
      finishInitialHashAlignment();
    }
    jumpToScroll = true;
    scrollDirty = true;
    window.requestAnimationFrame(() => {
      updateMeasurements();
      scheduleAnimationFrame();
    });
  });
  window.addEventListener("pageshow", () => {
    jumpToScroll = true;
    scrollDirty = true;
    onVisibilityChange();
  });
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) disposeAvatarWorld();
  });
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("wheel", onNavigationIntent, { passive: true });
  window.addEventListener("touchstart", onNavigationIntent, { passive: true });
  window.addEventListener("keydown", onNavigationIntent);
  reducedMotion.addEventListener("change", onMotionPreferenceChange);
  connection?.addEventListener?.("change", onMotionPreferenceChange);
}
