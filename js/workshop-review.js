// Explicit opt-in device diagnostics. Results stay on the device until exported.
export function mountDeviceReview({ diagnostics, shots, sample, onRunState }) {
  const panel = document.createElement("aside");
  panel.className = "device-review";
  panel.setAttribute("aria-label", "Device verification");
  panel.innerHTML = `<strong>Device verification</strong>
    <label>Device model <input name="model" placeholder="e.g. iPhone 16 Pro" maxlength="100"></label>
    <output aria-live="polite">Ready</output>
    <div><button type="button" data-run>Run test</button>
    <button type="button" data-export disabled>Export JSON</button></div>`;
  document.body.append(panel);
  const output = panel.querySelector("output");
  const run = panel.querySelector("[data-run]");
  const save = panel.querySelector("[data-export]");
  let result;
  let running = false;
  let cancel = false;
  const abort = () => {
    cancel = true;
  };
  const visibility = () => {
    if (document.hidden) abort();
  };

  run.addEventListener("click", async () => {
    if (running) {
      abort();
      return;
    }
    if (!diagnostics()) {
      output.textContent = "3D must be enabled";
      return;
    }
    running = true;
    onRunState(true);
    cancel = false;
    result = null;
    save.disabled = true;
    run.textContent = "Cancel";
    const originalScroll = scrollY;
    const viewport = [innerWidth, innerHeight, devicePixelRatio];
    const frames = [];
    const chapters = [];
    window.addEventListener("touchstart", abort, { passive: true });
    window.addEventListener("wheel", abort, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("resize", abort);
    try {
      // A deterministic 24-second sweep includes every chapter and camera cut.
      for (const shot of shots) {
        if (cancel) break;
        const chapter = document.getElementById(shot.id);
        window.scrollTo({
          top: chapter.getBoundingClientRect().top + scrollY + 1,
          behavior: "instant",
        });
        const start = performance.now();
        let previous = null;
        await new Promise((resolve) => {
          function frame(now) {
            if (cancel) {
              resolve();
              return;
            }
            const t = Math.min(1, (now - start) / 4000);
            sample(shot.start + (shot.end - shot.start) * t);
            // Exclude initial navigation/texture warmup from each chapter sample.
            if (previous !== null && t > 0.15) frames.push(now - previous);
            previous = now;
            output.textContent = `${shot.id} / ${Math.round(t * 100)}%`;
            if (t < 1) requestAnimationFrame(frame);
            else resolve();
          }
          requestAnimationFrame(frame);
        });
        chapters.push({ chapter: shot.id, ...diagnostics() });
      }
      if (cancel) {
        output.textContent = "Cancelled";
        return;
      }
      const sorted = [...frames].sort((a, b) => a - b);
      const percentile = (p) => sorted[Math.floor((sorted.length - 1) * p)];
      result = {
        timestamp: new Date().toISOString(),
        deviceModel: panel.querySelector("input").value.trim() || "Unspecified",
        userAgent: navigator.userAgent,
        viewport,
        samples: frames.length,
        medianFrameMs: percentile(0.5),
        p95FrameMs: percentile(0.95),
        averageFps: 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length),
        framesOver34ms: frames.filter((ms) => ms > 34).length,
        chapters,
        note: "Warm scene, foreground RAF intervals. Not GPU timer queries or cold-load timing.",
      };
      output.textContent = `${result.averageFps.toFixed(1)} fps / p95 ${result.p95FrameMs.toFixed(1)} ms`;
      save.disabled = false;
    } finally {
      window.removeEventListener("touchstart", abort);
      window.removeEventListener("wheel", abort);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("resize", abort);
      running = false;
      onRunState(false);
      run.textContent = "Run test";
      window.scrollTo({ top: originalScroll, behavior: "instant" });
      window.dispatchEvent(new Event("scroll"));
    }
  });
  save.addEventListener("click", () => {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "workshop-device-review.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
