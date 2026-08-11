"use strict";

const body = document.body;

if (body.classList.contains("home-page")) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const scenes = Array.from(document.querySelectorAll("[data-scene]"));
  const chapters = Array.from(document.querySelectorAll("[data-avatar-chapter]"));
  const chapterLinks = Array.from(document.querySelectorAll("[data-chapter-link]"));
  const avatarCanvas = document.querySelector("[data-avatar-canvas]");
  const signalCanvas = document.querySelector("[data-signal-canvas]");
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  let avatarWorld = null;
  let avatarBootToken = 0;
  let signalCleanup = null;
  let animationFrame = 0;
  let scrollDirty = true;
  let resizeDirty = true;
  let jumpToScroll = true;
  let targetProgress = 0;
  let visualProgress = 0;
  let lastFrameTime = 0;
  let lastScrollTime = performance.now();
  let pageActive = !document.hidden;
  let lastNarrativePosition = null;
  let pendingResizePosition = null;
  let resizeSettleTimer = 0;
  let applyingLayoutCorrection = false;
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
    applyingLayoutCorrection = true;
    window.scrollTo({
      top: clamp(top, 0, maximum),
      left: window.scrollX,
      behavior: "auto",
    });
    applyingLayoutCorrection = false;
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
    const front = scene.querySelector(".phone-card--front");
    const middle = scene.querySelector(".phone-card--mid");
    const rear = scene.querySelector(".phone-card--rear");
    if (!front || !middle || !rear) return;

    const intro = map(progress, 0.02, 0.22);
    const focus = Math.min(3, Math.floor(clamp(progress * 4, 0, 3.999)));
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

    scene.querySelectorAll("[data-step]").forEach((step) => {
      step.classList.toggle("is-active", Number(step.dataset.step) === focus);
    });
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

  function updateSceneEffects() {
    let activeName = "";
    const viewportAnchor = window.innerHeight * 0.52;

    scenes.forEach((scene) => {
      const rect = scene.getBoundingClientRect();
      const distance = Math.max(rect.height - window.innerHeight, 1);
      const progress = clamp(-rect.top / distance);
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

      if (rect.top <= viewportAnchor && rect.bottom >= viewportAnchor) {
        activeName = scene.dataset.scene;
      }
      if (scene.dataset.scene === "pocketpilot") updatePhoneSystem(scene, progress);
      if (scene.dataset.scene === "ai") updatePipeline(scene, progress);
    });

    chapterLinks.forEach((link) => {
      const active = link.dataset.chapterLink === activeName;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }

  function getChapterBounds(index) {
    const chapter = chapters[index];
    const nextChapter = chapters[index + 1];
    const start = chapter.offsetTop;
    const end = nextChapter
      ? nextChapter.offsetTop
      : Math.max(
        document.documentElement.scrollHeight - window.innerHeight * 0.48,
        chapter.offsetTop + 1,
      );
    return { start, end };
  }

  function readNarrativePosition() {
    if (!chapters.length) return { index: 0, localProgress: 0 };
    const viewportPosition = window.scrollY + window.innerHeight * 0.52;
    let activeIndex = 0;

    for (let index = 0; index < chapters.length; index += 1) {
      if (chapters[index].offsetTop <= viewportPosition) activeIndex = index;
      else break;
    }

    const { start, end } = getChapterBounds(activeIndex);
    const localProgress = clamp((viewportPosition - start) / Math.max(end - start, 1));
    return { index: activeIndex, localProgress };
  }

  function progressFromNarrativePosition(position) {
    const stop = position.index * 0.12;
    const nextStop = position.index === chapters.length - 1 ? 1 : stop + 0.12;
    return clamp(stop + position.localProgress * (nextStop - stop));
  }

  function scrollTopFromNarrativePosition(position) {
    if (!chapters.length) return window.scrollY;
    const index = Math.min(chapters.length - 1, Math.max(0, position.index));
    const { start, end } = getChapterBounds(index);
    const viewportPosition = start + clamp(position.localProgress) * (end - start);
    return viewportPosition - window.innerHeight * 0.52;
  }

  function measureNarrativeProgress() {
    const position = readNarrativePosition();
    lastNarrativePosition = position;
    return progressFromNarrativePosition(position);
  }

  function updateMeasurements() {
    updateSceneEffects();
    targetProgress = measureNarrativeProgress();
    if (jumpToScroll) {
      visualProgress = targetProgress;
      jumpToScroll = false;
    }
    scrollDirty = false;
  }

  function applyPendingResizePosition() {
    resizeSettleTimer = 0;
    const preservedPosition = pendingResizePosition;
    pendingResizePosition = null;
    if (!preservedPosition || initialHashPending) return;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setScrollTopImmediately(scrollTopFromNarrativePosition(preservedPosition));
        jumpToScroll = true;
        scrollDirty = true;
        updateMeasurements();
        scheduleAnimationFrame();
      });
    });
  }

  function scheduleResizePositionRestore(position) {
    if (!pendingResizePosition && position) {
      pendingResizePosition = {
        index: position.index,
        localProgress: position.localProgress,
      };
    }
    if (!pendingResizePosition) return;
    if (resizeSettleTimer) window.clearTimeout(resizeSettleTimer);
    resizeSettleTimer = window.setTimeout(applyPendingResizePosition, 120);
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
    if (pendingResizePosition) {
      pendingResizePosition = null;
      if (resizeSettleTimer) window.clearTimeout(resizeSettleTimer);
      resizeSettleTimer = 0;
    }
  }

  function scheduleAnimationFrame() {
    if (animationFrame || !pageActive || !avatarWorld?.ready) return;
    animationFrame = window.requestAnimationFrame(renderAvatarFrame);
  }

  function renderAvatarFrame(timestamp) {
    animationFrame = 0;
    if (!pageActive || !avatarWorld?.ready) return;

    const elapsed = lastFrameTime ? Math.min(timestamp - lastFrameTime, 64) : 16.67;
    const settled = Math.abs(targetProgress - visualProgress) < 0.00008;
    const mobile = window.innerWidth <= 820;
    const recentlyScrolled = timestamp - lastScrollTime < 180;

    if (mobile && settled && !recentlyScrolled && lastFrameTime && elapsed < 32) {
      scheduleAnimationFrame();
      return;
    }

    lastFrameTime = timestamp;
    if (resizeDirty) {
      avatarWorld.resize(window.innerWidth, window.innerHeight, mobile);
      resizeDirty = false;
    }
    if (scrollDirty) updateMeasurements();

    const damping = 1 - Math.exp(-Math.max(elapsed, 1) * 0.0085);
    visualProgress += (targetProgress - visualProgress) * damping;
    if (Math.abs(targetProgress - visualProgress) < 0.00003) {
      visualProgress = targetProgress;
    }

    const fadeProgress = map(visualProgress, 0.985, 1);
    const endOpacity = 1 - fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
    avatarCanvas.style.opacity = endOpacity.toFixed(3);
    avatarWorld.update({ progress: visualProgress, timestamp });
    scheduleAnimationFrame();
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
      return;
    }
    setAvatarState("fallback");
    setupSignalCanvas();
    scheduleInitialHashAlignment();
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
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    lastFrameTime = 0;
    if (avatarWorld) avatarWorld.dispose();
    avatarWorld = null;
  }

  async function bootAvatarWorld() {
    const token = ++avatarBootToken;
    stopSignalCanvas();

    if (reducedMotion.matches || hasDataSaver() || !avatarCanvas) {
      disposeAvatarWorld();
      setAvatarState("disabled");
      updateMeasurements();
      scheduleInitialHashAlignment();
      return;
    }

    const timeout = new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Avatar world startup timed out.")), 3000);
    });

    try {
      const module = await Promise.race([import("./avatar-world.js"), timeout]);
      if (token !== avatarBootToken) return;

      const world = module.createAvatarWorld({
        canvas: avatarCanvas,
        mobile: window.innerWidth <= 820,
        onContextLost,
        onContextRestored,
        onError: enterFallback,
      });
      if (token !== avatarBootToken) {
        world.dispose();
        return;
      }

      avatarWorld = world;
      stopSignalCanvas();
      setAvatarState("ready");
      scheduleInitialHashAlignment();
      resizeDirty = true;
      scrollDirty = true;
      jumpToScroll = true;
      updateMeasurements();
      scheduleAnimationFrame();
    } catch (_) {
      if (token === avatarBootToken) enterFallback();
    }
  }

  function onScroll() {
    scrollDirty = true;
    lastScrollTime = performance.now();
    if (avatarWorld?.ready) scheduleAnimationFrame();
    else updateSceneEffects();
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

    if (
      meaningfulLayoutResize
      && !initialHashPending
      && !applyingLayoutCorrection
      && lastNarrativePosition
    ) {
      scheduleResizePositionRestore(lastNarrativePosition);
    }

    lastViewportWidth = nextWidth;
    lastViewportHeight = nextHeight;
    resizeDirty = true;
    scrollDirty = true;
    jumpToScroll = true;
    if (avatarWorld?.ready) scheduleAnimationFrame();
    else updateMeasurements();
  }

  function onVisibilityChange() {
    pageActive = !document.hidden;
    avatarWorld?.setActive(pageActive);
    if (!pageActive && animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      lastFrameTime = 0;
    } else if (pageActive) {
      scrollDirty = true;
      jumpToScroll = true;
      scheduleAnimationFrame();
    }
  }

  function onMotionPreferenceChange() {
    disposeAvatarWorld();
    stopSignalCanvas();
    bootAvatarWorld();
  }

  setupLoader();

  document.addEventListener("DOMContentLoaded", () => {
    updateMeasurements();
    bootAvatarWorld();
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
