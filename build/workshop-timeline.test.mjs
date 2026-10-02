import test from "node:test";
import assert from "node:assert/strict";
import { createAvatarTimeline } from "../js/avatar-timeline.js";
import { WORKSHOP_RANGES } from "../js/workshop-shots.js";

globalThis.window = { scrollY: 0, innerHeight: 900 };
globalThis.document = { documentElement: { scrollHeight: 12900 } };
const chapters = Array.from({ length: 6 }, (_, i) => ({
  getBoundingClientRect: () => ({ top: i * 2000 - window.scrollY }),
}));
const makeTimeline = () => {
  const timeline = createAvatarTimeline({
    chapters,
    ranges: WORKSHOP_RANGES,
    viewportAnchor: 0,
  });
  timeline.refresh();
  return timeline;
};
test("chapter anchors map to the authored Blender timeline", () => {
  const clock = makeTimeline();
  for (let i = 0; i < 6; i++)
    assert.equal(clock.sample(i * 2000), WORKSHOP_RANGES[i]);
  assert.equal(clock.sample(12000), 1);
});
test("forward/reverse scrolling settles at the same pose without overshoot", () => {
  const clock = makeTimeline();
  clock.jump(0, 0);
  clock.sample(4500);
  let state;
  for (let time = 16; time <= 2400; time += 16) state = clock.step(time);
  const forward = state.progress;
  clock.jump(12000, 2400);
  clock.sample(4500);
  for (let time = 2416; time <= 4800; time += 16) state = clock.step(time);
  assert.ok(Math.abs(state.progress - forward) < 0.0001);
  assert.equal(state.chapterIndex, 2);
});
test("resume after a hidden tab catches up instead of replaying stale motion", () => {
  const clock = makeTimeline();
  clock.jump(0, 0);
  clock.sample(9000);
  const state = clock.step(5000);
  assert.equal(state.progress, clock.targetProgress);
  assert.equal(state.velocity, 0);
});
