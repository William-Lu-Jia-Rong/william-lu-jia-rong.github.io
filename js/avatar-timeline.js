"use strict";

/**
 * Canonical chapter ranges for the homepage story. The values are deliberately
 * non-uniform: product chapters get more travel than the short closing beats.
 */
export const AVATAR_TIMELINE_RANGES = Object.freeze([
  0,
  0.10,
  0.24,
  0.36,
  0.49,
  0.61,
  0.73,
  0.86,
  0.94,
  1,
]);

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * One clock for every scroll-linked homepage effect. It samples native scroll,
 * maps cached chapter pixel bounds into the authored timeline ranges, and then
 * advances a critically damped display position. It never writes scrollTop.
 */
export function createAvatarTimeline(options = {}) {
  const chapters = Array.from(options.chapters || []);
  const ranges = Object.freeze(Array.from(options.ranges || AVATAR_TIMELINE_RANGES));
  const viewportAnchor = clamp(finiteOr(options.viewportAnchor, 0.52));
  const springFrequency = Math.max(1, finiteOr(options.springFrequency, 14));

  if (ranges.length !== chapters.length + 1) {
    throw new RangeError(
      `Avatar timeline requires one more range boundary than chapters (${ranges.length} for ${chapters.length}).`,
    );
  }

  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index] <= ranges[index - 1]) {
      throw new RangeError("Avatar timeline ranges must be strictly increasing.");
    }
  }

  let pixelBounds = [];
  let targetProgress = 0;
  let displayProgress = 0;
  let displayVelocity = 0;
  let lastTimestamp = 0;
  let initialized = false;
  let reducedMotion = Boolean(options.reducedMotion);

  function locate(progress) {
    const value = clamp(finiteOr(progress, 0));
    const finalIndex = Math.max(0, chapters.length - 1);
    let chapterIndex = finalIndex;

    for (let index = 0; index < chapters.length; index += 1) {
      if (value < ranges[index + 1] || index === finalIndex) {
        chapterIndex = index;
        break;
      }
    }

    const start = ranges[chapterIndex];
    const end = ranges[chapterIndex + 1];
    return {
      chapterIndex,
      chapterProgress: clamp((value - start) / Math.max(end - start, 0.000001)),
    };
  }

  function composeState(timestamp) {
    const location = locate(displayProgress);
    return {
      progress: displayProgress,
      chapterIndex: location.chapterIndex,
      chapterProgress: location.chapterProgress,
      velocity: displayVelocity,
      timestamp: finiteOr(timestamp, lastTimestamp),
    };
  }

  function refresh(measurement = {}) {
    const scrollY = Math.max(0, finiteOr(measurement.scrollY, window.scrollY));
    const viewportHeight = Math.max(1, finiteOr(measurement.viewportHeight, window.innerHeight));
    const scrollHeight = Math.max(
      viewportHeight,
      finiteOr(measurement.scrollHeight, document.documentElement.scrollHeight),
    );
    const maximumScroll = Math.max(0, scrollHeight - viewportHeight);
    const anchorOffset = viewportHeight * viewportAnchor;
    let previousStart = 0;

    const starts = chapters.map((chapter, index) => {
      const documentTop = chapter.getBoundingClientRect().top + scrollY;
      const authoredStart = index === 0 ? 0 : documentTop - anchorOffset;
      const start = Math.max(previousStart, clamp(authoredStart, 0, maximumScroll));
      previousStart = start;
      return start;
    });

    pixelBounds = starts.map((start, index) => ({
      start,
      end: index + 1 < starts.length
        ? Math.max(start, starts[index + 1])
        : maximumScroll,
    }));

    sample(scrollY);
    return pixelBounds.map((bound) => ({ ...bound }));
  }

  function progressForScroll(scrollY) {
    if (!pixelBounds.length) return 0;
    const maximumScroll = pixelBounds[pixelBounds.length - 1].end;
    const position = clamp(finiteOr(scrollY, 0), 0, maximumScroll);
    let chapterIndex = pixelBounds.length - 1;

    for (let index = 0; index < pixelBounds.length; index += 1) {
      if (position < pixelBounds[index].end || index === pixelBounds.length - 1) {
        chapterIndex = index;
        break;
      }
    }

    const bounds = pixelBounds[chapterIndex];
    const distance = bounds.end - bounds.start;
    const localProgress = distance > 0
      ? clamp((position - bounds.start) / distance)
      : Number(position >= bounds.end);
    return ranges[chapterIndex]
      + localProgress * (ranges[chapterIndex + 1] - ranges[chapterIndex]);
  }

  function sample(scrollY = window.scrollY) {
    targetProgress = clamp(progressForScroll(scrollY));
    return targetProgress;
  }

  function jump(scrollY = window.scrollY, timestamp = performance.now()) {
    sample(scrollY);
    displayProgress = targetProgress;
    displayVelocity = 0;
    lastTimestamp = finiteOr(timestamp, 0);
    initialized = true;
    return composeState(timestamp);
  }

  function step(timestamp = performance.now(), immediate = false) {
    const now = finiteOr(timestamp, performance.now());
    if (!initialized || immediate || reducedMotion) return jump(undefined, now);

    const elapsedSeconds = Math.max(0, (now - lastTimestamp) / 1000);
    lastTimestamp = now;

    // A long pause means the page was hidden or the main thread was suspended.
    // Catch up once instead of replaying stale scroll motion on return.
    if (elapsedSeconds > 0.25) {
      displayProgress = targetProgress;
      displayVelocity = 0;
      return composeState(now);
    }

    const deltaTime = Math.min(elapsedSeconds, 1 / 20);
    if (deltaTime > 0) {
      // Exact solution for a critically damped spring while the target is held
      // for this frame. This stays stable across different refresh rates and
      // behaves identically when scrolling forward or in reverse.
      const displacement = displayProgress - targetProgress;
      const springTerm = displayVelocity + springFrequency * displacement;
      const decay = Math.exp(-springFrequency * deltaTime);
      const nextDisplacement = (displacement + springTerm * deltaTime) * decay;
      displayVelocity = (
        displayVelocity - springFrequency * springTerm * deltaTime
      ) * decay;
      displayProgress = clamp(targetProgress + nextDisplacement);
    }

    if (
      Math.abs(targetProgress - displayProgress) < 0.00001
      && Math.abs(displayVelocity) < 0.0001
    ) {
      displayProgress = targetProgress;
      displayVelocity = 0;
    }

    return composeState(now);
  }

  function chapterProgress(index, progress = displayProgress) {
    const chapterIndex = Math.max(0, Math.min(chapters.length - 1, Math.trunc(index)));
    const start = ranges[chapterIndex];
    const end = ranges[chapterIndex + 1];
    return clamp((clamp(progress) - start) / Math.max(end - start, 0.000001));
  }

  function setReducedMotion(nextValue) {
    reducedMotion = Boolean(nextValue);
    if (reducedMotion) {
      displayProgress = targetProgress;
      displayVelocity = 0;
    }
  }

  function isSettled() {
    return Math.abs(targetProgress - displayProgress) < 0.00001
      && Math.abs(displayVelocity) < 0.0001;
  }

  return Object.freeze({
    ranges,
    refresh,
    sample,
    jump,
    step,
    locate,
    chapterProgress,
    setReducedMotion,
    isSettled,
    get targetProgress() { return targetProgress; },
    get displayProgress() { return displayProgress; },
  });
}
