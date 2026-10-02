import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { AnimationMixer, Box3, LoopOnce, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { seekWorkshop } from "../js/workshop-animation.js";

const bytes = await readFile(
  new URL("../assets/3d/bill-workshop.glb", import.meta.url),
);
const { scene, animations } = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  "",
);
const mixer = new AnimationMixer(scene);
const actions = [];
for (const clip of animations) {
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  actions.push(action);
}
function sample(progress) {
  seekWorkshop(mixer, actions, progress);
  scene.updateMatrixWorld(true);
}
const bit = scene.getObjectByName("Driver_bit");
const fastener = scene.getObjectByName("Fastener");
const tool = scene.getObjectByName("Driver");
const wrist = scene.getObjectByName("Grip_1");

test("driver stays on the fastener throughout engagement, in both directions", () => {
  const samples = Array.from({ length: 121 }, (_, i) => 0.205 + i * 0.0005);
  for (const p of [...samples, ...samples.reverse()]) {
    sample(p);
    const tip = bit.localToWorld(new Vector3(0, 0.0325, 0));
    const contact = fastener.localToWorld(new Vector3(0, 0.0225, 0));
    assert.ok(
      tip.distanceTo(contact) < 0.001,
      `Contact drift ${tip.distanceTo(contact)} at ${p}`,
    );
  }
});

test("held driver and wrist share a fixed grip offset", () => {
  for (let i = 0; i <= 125; i++) {
    sample(0.16 + i * 0.001);
    const grip = wrist.getWorldPosition(new Vector3());
    const driver = tool.getWorldPosition(new Vector3());
    assert.ok(
      Math.abs(grip.distanceTo(driver) - 0.29) < 0.001,
      `Grip distance ${grip.distanceTo(driver)} at ${0.16 + i * 0.001}`,
    );
  }
});

test("pickup and release do not teleport the driver", () => {
  for (const boundary of [0.16, 0.285]) {
    sample(boundary - 0.0001);
    const before = tool.getWorldPosition(new Vector3());
    sample(boundary + 0.0001);
    assert.ok(before.distanceTo(tool.getWorldPosition(new Vector3())) < 0.01);
  }
});

test("device touch reaches the visible screen from its front", () => {
  const screen = scene.getObjectByName("PhoneScreen");
  for (let i = 0; i <= 26; i++) {
    sample(0.601 + i * 0.0005);
    const tip = wrist.localToWorld(new Vector3(0, 0.3575, 0));
    const display = screen.getWorldPosition(new Vector3());
    // The actual screenshot plane sits 13 mm in front of the exported screen center.
    assert.ok(Math.abs(tip.z - display.z - 0.013) < 0.002);
    assert.ok(Math.abs(tip.x - display.x) < 0.3);
    assert.ok(wrist.getWorldPosition(new Vector3()).z > display.z);
  }
});

test("arm links clear the device during approach, contact and withdrawal", () => {
  for (let i = 0; i <= 180; i++) {
    const p = 0.52 + i * 0.001;
    sample(p);
    const display = new Box3()
      .setFromObject(scene.getObjectByName("PhoneScreen"))
      .expandByScalar(0.12);
    const joints = ["UpperArm_1", "Forearm_1", "Grip_1"].map((name) =>
      scene.getObjectByName(name).getWorldPosition(new Vector3()),
    );
    for (let segment = 0; segment < 2; segment++) {
      for (let step = 0; step <= 32; step++) {
        const point = joints[segment]
          .clone()
          .lerp(joints[segment + 1], step / 32);
        assert.ok(
          !display.containsPoint(point),
          `Arm crosses device at ${p}, segment ${segment}`,
        );
      }
    }
  }
});

test("camera tracks remain continuous during slow and reverse scrub", () => {
  for (const name of ["CameraDesktop", "CameraMobile"]) {
    const camera = scene.getObjectByName(name);
    sample(0);
    let previous = camera.getWorldPosition(new Vector3());
    const positions = Array.from({ length: 1801 }, (_, i) => i / 1800);
    for (const p of [...positions, ...positions.reverse()]) {
      sample(p);
      const next = camera.getWorldPosition(new Vector3());
      assert.ok(
        previous.distanceTo(next) < 0.3,
        `${name}: discontinuity at ${p}`,
      );
      previous = next;
    }
  }
});
