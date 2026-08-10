(function () {
  "use strict";

  var body = document.body;
  if (!body.classList.contains("home-page")) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var scenes = Array.from(document.querySelectorAll("[data-scene]"));
  var chapterLinks = Array.from(document.querySelectorAll("[data-chapter-link]"));
  var frameRequested = false;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function map(value, start, end) {
    return clamp((value - start) / (end - start), 0, 1);
  }

  function finishLoader() {
    var loader = document.querySelector("[data-loader]");
    var bar = document.querySelector("[data-loader-bar]");
    var status = document.querySelector("[data-loader-status]");
    if (bar) bar.style.width = "100%";
    if (status) status.textContent = "System ready.";

    window.setTimeout(function () {
      body.classList.remove("is-loading");
      body.classList.add("is-loaded");
      if (loader) loader.setAttribute("aria-hidden", "true");
      try { window.sessionStorage.setItem("bill-portfolio-booted", "1"); } catch (_) {}
    }, reduceMotion.matches ? 0 : 240);
  }

  function setupLoader() {
    if (reduceMotion.matches) {
      finishLoader();
      return;
    }

    var seen = false;
    try { seen = window.sessionStorage.getItem("bill-portfolio-booted") === "1"; } catch (_) {}
    if (seen) {
      var loader = document.querySelector("[data-loader]");
      body.classList.remove("is-loading");
      body.classList.add("is-loaded");
      if (loader) loader.setAttribute("aria-hidden", "true");
      return;
    }

    var bar = document.querySelector("[data-loader-bar]");
    var status = document.querySelector("[data-loader-status]");
    if (bar) bar.style.width = "42%";
    if (status) status.textContent = "Loading control surfaces and product imagery…";

    var critical = Array.from(document.querySelectorAll('img[fetchpriority="high"], img[rel="preload"], .hero-backdrop img'));
    var ready = critical.map(function (image) {
      if (image.complete) return Promise.resolve();
      if (typeof image.decode === "function") return image.decode().catch(function () {});
      return new Promise(function (resolve) {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    });

    Promise.race([
      Promise.all(ready),
      new Promise(function (resolve) { window.setTimeout(resolve, 2400); })
    ]).then(function () {
      if (bar) bar.style.width = "82%";
      window.setTimeout(finishLoader, 150);
    });
  }

  function updatePhoneSystem(scene, progress) {
    var front = scene.querySelector(".phone-card--front");
    var middle = scene.querySelector(".phone-card--mid");
    var rear = scene.querySelector(".phone-card--rear");
    if (!front || !middle || !rear) return;

    var intro = map(progress, 0.02, 0.22);
    var focus = Math.min(3, Math.floor(clamp(progress * 4, 0, 3.999)));
    var mobile = window.innerWidth <= 820;
    var spread = mobile ? 0.72 : 1;
    var lift = (1 - intro) * 80;

    var frontScale = focus <= 1 ? 1 : 0.88;
    var middleScale = focus === 3 ? 1.03 : 0.9;
    var rearScale = focus === 2 ? 1.04 : 0.88;

    front.style.transform = "translate3d(-18%, calc(-50% + " + lift.toFixed(1) + "px), 100px) rotateY(-8deg) scale(" + frontScale + ")";
    middle.style.transform = "translate3d(" + (-18 - 59 * spread).toFixed(1) + "%, calc(-48% + " + (lift * 0.8).toFixed(1) + "px), 10px) rotateY(7deg) rotateZ(-4deg) scale(" + middleScale + ")";
    rear.style.transform = "translate3d(" + (-18 + 53 * spread).toFixed(1) + "%, calc(-46% + " + (lift * 0.6).toFixed(1) + "px), -90px) rotateY(-12deg) rotateZ(5deg) scale(" + rearScale + ")";
    front.style.opacity = focus <= 1 ? "1" : "0.68";
    middle.style.opacity = focus === 3 ? "1" : "0.68";
    rear.style.opacity = focus === 2 ? "1" : "0.58";

    scene.querySelectorAll("[data-step]").forEach(function (step) {
      step.classList.toggle("is-active", Number(step.dataset.step) === focus);
    });
  }

  function updatePipeline(scene, progress) {
    var items = Array.from(scene.querySelectorAll(".pipeline li"));
    if (!items.length) return;
    var active = Math.min(items.length - 1, Math.floor(clamp(progress * items.length, 0, items.length - 0.001)));
    items.forEach(function (item, index) {
      item.classList.toggle("is-active", index === active);
    });
  }

  function updateScenes() {
    frameRequested = false;
    var activeName = scenes.length ? scenes[0].dataset.scene : "";
    var viewportAnchor = window.innerHeight * 0.52;

    scenes.forEach(function (scene) {
      var rect = scene.getBoundingClientRect();
      var distance = Math.max(rect.height - window.innerHeight, 1);
      var progress = clamp(-rect.top / distance, 0, 1);
      var exit = map(progress, 0.76, 1);
      var stage = scene.querySelector(".scene-stage");
      var target = stage || scene;

      target.style.setProperty("--scene-progress", progress.toFixed(4));
      target.style.setProperty("--scene-copy-y", (-72 * exit).toFixed(1) + "px");
      target.style.setProperty("--scene-copy-opacity", (1 - exit * 0.88).toFixed(3));
      target.style.setProperty("--scene-image-scale", (1.035 + progress * 0.085).toFixed(4));
      target.style.setProperty("--scene-image-x", (-34 * progress).toFixed(1) + "px");
      target.style.setProperty("--scene-image-y", ((progress - 0.5) * 26).toFixed(1) + "px");
      target.style.setProperty("--scene-rotate", (progress * 86).toFixed(1) + "deg");
      target.style.setProperty("--hud-y", (-52 * progress).toFixed(1) + "px");

      if (rect.top <= viewportAnchor && rect.bottom >= viewportAnchor) {
        activeName = scene.dataset.scene;
      }

      if (scene.dataset.scene === "pocketpilot") updatePhoneSystem(scene, progress);
      if (scene.dataset.scene === "ai") updatePipeline(scene, progress);
    });

    chapterLinks.forEach(function (link) {
      var active = link.dataset.chapterLink === activeName;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }

  function requestSceneFrame() {
    if (frameRequested) return;
    frameRequested = true;
    window.requestAnimationFrame(updateScenes);
  }

  function setupCanvas() {
    var canvas = document.querySelector("[data-signal-canvas]");
    if (!canvas || reduceMotion.matches) return;
    var context = canvas.getContext("2d");
    if (!context) return;

    var width = 0;
    var height = 0;
    var points = [];
    var pointer = { x: -1000, y: -1000 };
    var running = true;

    function resize() {
      var ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      var count = width < 700 ? 22 : 42;
      points = Array.from({ length: count }, function (_, index) {
        return {
          x: ((index * 83.7) % 100) / 100 * width,
          y: ((index * 47.3 + 19) % 100) / 100 * height,
          vx: ((index % 5) - 2) * 0.035,
          vy: (((index * 3) % 5) - 2) * 0.028,
          radius: index % 7 === 0 ? 1.5 : 0.8
        };
      });
    }

    function draw() {
      if (!running) return;
      context.clearRect(0, 0, width, height);

      points.forEach(function (point, index) {
        point.x += point.vx;
        point.y += point.vy;
        if (point.x < -20) point.x = width + 20;
        if (point.x > width + 20) point.x = -20;
        if (point.y < -20) point.y = height + 20;
        if (point.y > height + 20) point.y = -20;

        for (var next = index + 1; next < points.length; next += 1) {
          var other = points[next];
          var dx = point.x - other.x;
          var dy = point.y - other.y;
          var distance = Math.sqrt(dx * dx + dy * dy);
          if (distance > 135) continue;
          context.strokeStyle = "rgba(81, 217, 239," + ((1 - distance / 135) * 0.075).toFixed(3) + ")";
          context.lineWidth = 0.6;
          context.beginPath();
          context.moveTo(point.x, point.y);
          context.lineTo(other.x, other.y);
          context.stroke();
        }

        var pointerDistance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
        var glow = pointerDistance < 170 ? 1 - pointerDistance / 170 : 0;
        context.fillStyle = glow > 0 ? "rgba(231, 154, 86," + (0.28 + glow * 0.55).toFixed(2) + ")" : "rgba(81, 217, 239,0.28)";
        context.beginPath();
        context.arc(point.x, point.y, point.radius + glow * 1.8, 0, Math.PI * 2);
        context.fill();
      });

      window.requestAnimationFrame(draw);
    }

    window.addEventListener("pointermove", function (event) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }, { passive: true });
    document.addEventListener("visibilitychange", function () {
      running = !document.hidden;
      if (running) draw();
    });
    window.addEventListener("resize", resize);
    resize();
    draw();
  }

  setupLoader();

  document.addEventListener("DOMContentLoaded", function () {
    updateScenes();
    setupCanvas();
  });
  window.addEventListener("scroll", requestSceneFrame, { passive: true });
  window.addEventListener("resize", requestSceneFrame);
}());
