import * as THREE from "./vendor/three.module.min.js";

const CHAPTER_STOPS = Object.freeze([0, 0.12, 0.24, 0.36, 0.48, 0.60, 0.72, 0.84, 0.96]);
const TAU = Math.PI * 2;
const POCKETPILOT_TEXTURE_URLS = Object.freeze([
  new URL("../images/PocketPilot/screenshot-insights.webp", import.meta.url).href,
  new URL("../images/PocketPilot/screenshot-scan.webp", import.meta.url).href,
  new URL("../images/PocketPilot/screenshot-transactions.webp", import.meta.url).href,
]);

const COLORS = Object.freeze({
  charcoal: 0x202733,
  charcoalLight: 0x343e4c,
  navy: 0x071827,
  navyLight: 0x102d40,
  gold: 0xf2bd49,
  copper: 0xd7834d,
  cyan: 0x57d9ec,
  cyanSoft: 0x9aebf4,
  skin: 0xe7b18d,
  skinShadow: 0xc98667,
  hair: 0x101319,
  jeans: 0x294d75,
  jeansLight: 0x3d6893,
  shoe: 0xe9edf1,
  water: 0x56bad1,
  white: 0xf5f7f7,
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edge0, edge1, value) {
  const amount = clamp((value - edge0) / Math.max(edge1 - edge0, 0.00001));
  return amount * amount * (3 - 2 * amount);
}

function pulse(value, center, radius) {
  return smoothstep(center - radius, center, value) * (1 - smoothstep(center, center + radius, value));
}

function mix(from, to, amount) {
  return from + (to - from) * amount;
}

function setTransform(object, position, scale, rotation) {
  if (position) object.position.set(position[0], position[1], position[2]);
  if (scale) object.scale.set(scale[0], scale[1], scale[2]);
  if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
  return object;
}

function makeLineGeometry(segments) {
  const positions = [];
  segments.forEach((segment) => {
    positions.push(
      segment[0][0], segment[0][1], segment[0][2],
      segment[1][0], segment[1][1], segment[1][2],
    );
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function makeCircleSegments(radius, count, plane = "xz", center = [0, 0, 0]) {
  const segments = [];
  for (let index = 0; index < count; index += 1) {
    const angleA = (index / count) * TAU;
    const angleB = ((index + 1) / count) * TAU;
    const first = [center[0], center[1], center[2]];
    const second = [center[0], center[1], center[2]];
    if (plane === "xy") {
      first[0] += Math.cos(angleA) * radius;
      first[1] += Math.sin(angleA) * radius;
      second[0] += Math.cos(angleB) * radius;
      second[1] += Math.sin(angleB) * radius;
    } else if (plane === "yz") {
      first[1] += Math.cos(angleA) * radius;
      first[2] += Math.sin(angleA) * radius;
      second[1] += Math.cos(angleB) * radius;
      second[2] += Math.sin(angleB) * radius;
    } else {
      first[0] += Math.cos(angleA) * radius;
      first[2] += Math.sin(angleA) * radius;
      second[0] += Math.cos(angleB) * radius;
      second[2] += Math.sin(angleB) * radius;
    }
    segments.push([first, second]);
  }
  return segments;
}

/**
 * Creates the single continuous decorative WebGL world used by the homepage.
 * The caller owns scroll sampling and the requestAnimationFrame loop.
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {boolean} [options.mobile]
 * @param {(event: Event) => void} [options.onContextLost]
 * @param {(event: Event) => void} [options.onContextRestored]
 * @param {(error: unknown) => void} [options.onError]
 * The factory initializes synchronously and throws if WebGL is unavailable, so
 * callers can enter their static fallback path with a single try/catch.
 *
 * @returns {{initialize: function(): boolean, update: function(number|object, number=): void,
 *   resize: function(number=, number=, boolean=): void, setActive: function(boolean): void, dispose: function(): void,
 *   readonly ready: boolean, readonly error: unknown}}
 */
export function createAvatarWorld(options = {}) {
  const canvas = options.canvas;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const chapterGroups = [];
  const animation = {};
  const cameraPosition = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const pathPoint = new THREE.Vector3();
  const pathTangent = new THREE.Vector3();
  const dummy = new THREE.Object3D();

  let renderer = null;
  let scene = null;
  let camera = null;
  let world = null;
  let avatar = null;
  let avatarRig = null;
  let routeMaterial = null;
  let initialized = false;
  let disposed = false;
  let contextLost = false;
  let mobile = Boolean(options.mobile);
  let viewportWidth = 1;
  let viewportHeight = 1;
  let initializationError = null;
  let currentProgress = 0;
  let active = true;
  let peakDrawCalls = 0;
  let peakTriangles = 0;

  const path = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0.1, 0, 0),
      new THREE.Vector3(0.8, 0, 4.1),
      new THREE.Vector3(-0.45, 0, 8.2),
      new THREE.Vector3(0.75, 0, 12.3),
      new THREE.Vector3(-0.55, 0, 16.4),
      new THREE.Vector3(0.65, 0, 20.5),
      new THREE.Vector3(-0.4, 0, 24.6),
      new THREE.Vector3(0.55, 0, 28.7),
      new THREE.Vector3(0, 0, 32.8),
    ],
    false,
    "catmullrom",
    0.45,
  );

  function trackGeometry(geometry) {
    geometries.add(geometry);
    return geometry;
  }

  function trackMaterial(material) {
    materials.add(material);
    return material;
  }

  function standardMaterial(color, settings = {}) {
    const opacity = settings.opacity ?? 1;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: settings.roughness ?? 0.66,
      metalness: settings.metalness ?? 0.05,
      emissive: settings.emissive ?? 0x000000,
      emissiveIntensity: settings.emissiveIntensity ?? 0,
      transparent: settings.transparent ?? opacity < 1,
      opacity,
      depthWrite: settings.depthWrite ?? true,
      side: settings.side ?? THREE.FrontSide,
      flatShading: settings.flatShading ?? false,
    });
    material.userData.baseOpacity = opacity;
    return trackMaterial(material);
  }

  function basicMaterial(color, settings = {}) {
    const opacity = settings.opacity ?? 1;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: settings.transparent ?? opacity < 1,
      opacity,
      depthWrite: settings.depthWrite ?? opacity >= 1,
      side: settings.side ?? THREE.FrontSide,
      toneMapped: settings.toneMapped ?? false,
    });
    material.userData.baseOpacity = opacity;
    return trackMaterial(material);
  }

  function lineMaterial(color, opacity = 1) {
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthWrite: false,
      toneMapped: false,
    });
    material.userData.baseOpacity = opacity;
    return trackMaterial(material);
  }

  function loadColorTexture(url, material) {
    const loader = new THREE.TextureLoader();
    const texture = loader.load(
      url,
      (loadedTexture) => {
        if (disposed) {
          loadedTexture.dispose();
          return;
        }
        loadedTexture.colorSpace = THREE.SRGBColorSpace;
        loadedTexture.anisotropy = Math.min(4, renderer?.capabilities.getMaxAnisotropy() || 1);
        material.color.setHex(COLORS.white);
        material.map = loadedTexture;
        material.needsUpdate = true;
      },
      undefined,
      () => {
        textures.delete(texture);
        texture.dispose();
      },
    );
    textures.add(texture);
    return texture;
  }

  function mesh(geometry, material, position, scale, rotation) {
    return setTransform(new THREE.Mesh(geometry, material), position, scale, rotation);
  }

  function chapterMaterial(group, type, color, settings = {}) {
    let material;
    if (type === "line") material = lineMaterial(color, settings.opacity ?? 1);
    else if (type === "basic") material = basicMaterial(color, { ...settings, transparent: true });
    else material = standardMaterial(color, { ...settings, transparent: true });
    group.userData.fadeMaterials.push(material);
    return material;
  }

  function makeChapterGroup(index) {
    const group = new THREE.Group();
    group.name = `avatar-chapter-${index}`;
    group.userData.fadeMaterials = [];
    group.userData.stop = CHAPTER_STOPS[index];
    group.userData.index = index;
    path.getPointAt(CHAPTER_STOPS[index], pathPoint);
    group.position.copy(pathPoint);
    chapterGroups[index] = group;
    world.add(group);
    return group;
  }

  function buildRoute() {
    const cyanSegments = [];
    const goldSegments = [];
    const sampleCount = mobile ? 46 : 72;
    const previous = new THREE.Vector3();
    const next = new THREE.Vector3();

    path.getPointAt(0, previous);
    for (let index = 1; index <= sampleCount; index += 1) {
      const t = index / sampleCount;
      path.getPointAt(t, next);
      const collection = index % 5 === 0 ? goldSegments : cyanSegments;
      collection.push([
        [previous.x - 0.28, 0.025, previous.z],
        [next.x - 0.28, 0.025, next.z],
      ]);
      collection.push([
        [previous.x + 0.28, 0.025, previous.z],
        [next.x + 0.28, 0.025, next.z],
      ]);
      previous.copy(next);
    }

    const routeGroup = new THREE.Group();
    const cyanGeometry = trackGeometry(makeLineGeometry(cyanSegments));
    const goldGeometry = trackGeometry(makeLineGeometry(goldSegments));
    routeMaterial = lineMaterial(COLORS.cyan, 0.48);
    const goldLineMaterial = lineMaterial(COLORS.gold, 0.65);
    routeGroup.add(new THREE.LineSegments(cyanGeometry, routeMaterial));
    routeGroup.add(new THREE.LineSegments(goldGeometry, goldLineMaterial));

    const padGeometry = trackGeometry(new THREE.CylinderGeometry(0.09, 0.09, 0.035, 8));
    const padMaterial = standardMaterial(COLORS.copper, {
      emissive: COLORS.copper,
      emissiveIntensity: 0.45,
      roughness: 0.5,
    });
    const padCount = mobile ? 12 : 18;
    const pads = new THREE.InstancedMesh(padGeometry, padMaterial, padCount);
    for (let index = 0; index < padCount; index += 1) {
      const t = (index + 0.5) / padCount;
      path.getPointAt(t, pathPoint);
      dummy.position.set(pathPoint.x + (index % 2 ? 0.48 : -0.48), 0.035, pathPoint.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(index % 4 === 0 ? 1.35 : 1);
      dummy.updateMatrix();
      pads.setMatrixAt(index, dummy.matrix);
    }
    pads.instanceMatrix.needsUpdate = true;
    pads.computeBoundingSphere();
    routeGroup.add(pads);
    world.add(routeGroup);
  }

  function buildAvatar() {
    const root = new THREE.Group();
    root.name = "procedural-bill-avatar";
    const fadeMaterials = [];

    function avatarStandard(color, settings = {}) {
      const opacity = settings.opacity ?? 1;
      const material = new THREE.MeshToonMaterial({
        color,
        emissive: settings.emissive ?? 0x000000,
        emissiveIntensity: settings.emissiveIntensity ?? 0,
        transparent: true,
        opacity,
        depthWrite: settings.depthWrite ?? true,
        side: settings.side ?? THREE.FrontSide,
      });
      material.userData.baseOpacity = opacity;
      trackMaterial(material);
      fadeMaterials.push(material);
      return material;
    }

    function avatarBasic(color, settings = {}) {
      const material = basicMaterial(color, { ...settings, transparent: true });
      fadeMaterials.push(material);
      return material;
    }

    const boxGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const sphereGeometry = trackGeometry(new THREE.SphereGeometry(0.5, mobile ? 14 : 20, mobile ? 10 : 14));
    const limbGeometry = trackGeometry(new THREE.CylinderGeometry(0.5, 0.58, 1, mobile ? 10 : 14));
    const torsoGeometry = trackGeometry(new THREE.CapsuleGeometry(0.5, 0.56, mobile ? 4 : 6, mobile ? 10 : 14));
    const smileGeometry = trackGeometry(new THREE.TorusGeometry(0.16, 0.018, 7, 20, Math.PI));

    const hoodieMaterial = avatarStandard(COLORS.charcoal, { roughness: 0.86 });
    const hoodieLightMaterial = avatarStandard(COLORS.charcoalLight, { roughness: 0.82 });
    const goldMaterial = avatarStandard(COLORS.gold, {
      emissive: COLORS.gold,
      emissiveIntensity: 0.11,
      roughness: 0.56,
    });
    const faceMaterial = avatarStandard(COLORS.skin, { roughness: 0.9 });
    const hairMaterial = avatarStandard(COLORS.hair, { roughness: 0.93 });
    const jeansMaterial = avatarStandard(COLORS.jeans, { roughness: 0.8 });
    const jeansLightMaterial = avatarStandard(COLORS.jeansLight, { roughness: 0.78 });
    const shoeMaterial = avatarStandard(COLORS.shoe, { roughness: 0.72 });
    const backpackMaterial = avatarStandard(COLORS.navyLight, { roughness: 0.9 });
    const eyeMaterial = avatarBasic(COLORS.hair);
    const eyeWhiteMaterial = avatarBasic(COLORS.white);
    const noseMaterial = avatarBasic(COLORS.skinShadow);
    const backpack = mesh(boxGeometry, backpackMaterial, [0, 2.12, -0.48], [0.88, 1.02, 0.34], [0.05, 0, 0]);
    root.add(backpack);

    const pelvis = mesh(boxGeometry, jeansLightMaterial, [0, 1.16, 0], [0.78, 0.32, 0.47]);
    const torso = mesh(torsoGeometry, hoodieMaterial, [0, 1.92, 0], [0.98, 0.9, 0.94]);
    const hoodieHem = mesh(boxGeometry, hoodieLightMaterial, [0, 1.5, 0], [0.92, 0.2, 0.56]);
    const goldDetails = new THREE.InstancedMesh(boxGeometry, goldMaterial, 4);
    const goldLayouts = [
      [0, 2.42, -0.68, 0.72, 0.15, 0.05, 0.05, 0, 0],
      [0, 1.72, 0.5, 0.48, 0.045, 0.028, 0, 0, 0],
      [-0.13, 2.18, 0.5, 0.028, 0.24, 0.028, 0, 0, -0.05],
      [0.13, 2.18, 0.5, 0.028, 0.24, 0.028, 0, 0, 0.05],
    ];
    goldLayouts.forEach((layout, index) => {
      dummy.position.set(layout[0], layout[1], layout[2]);
      dummy.scale.set(layout[3], layout[4], layout[5]);
      dummy.rotation.set(layout[6], layout[7], layout[8]);
      dummy.updateMatrix();
      goldDetails.setMatrixAt(index, dummy.matrix);
    });
    goldDetails.instanceMatrix.needsUpdate = true;
    goldDetails.computeBoundingSphere();
    root.add(pelvis, torso, hoodieHem, goldDetails);

    const head = new THREE.Group();
    head.position.set(0, 2.82, 0.02);
    const skinPieces = new THREE.InstancedMesh(sphereGeometry, faceMaterial, 3);
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1.24, 1.32, 1.13);
    dummy.updateMatrix();
    skinPieces.setMatrixAt(0, dummy.matrix);
    [-1, 1].forEach((side, index) => {
      dummy.position.set(side * 0.62, -0.025, 0.015);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.2, 0.3, 0.16);
      dummy.updateMatrix();
      skinPieces.setMatrixAt(index + 1, dummy.matrix);
    });
    skinPieces.instanceMatrix.needsUpdate = true;
    skinPieces.computeBoundingSphere();
    head.add(skinPieces);

    const hairPieces = new THREE.InstancedMesh(sphereGeometry, hairMaterial, 3);
    dummy.position.set(0, 0.42, -0.08);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1.3, 0.58, 1.08);
    dummy.updateMatrix();
    hairPieces.setMatrixAt(0, dummy.matrix);
    [-1, 1].forEach((side, index) => {
      dummy.position.set(side * 0.21, 0.285, 0.49);
      dummy.rotation.set(0.02, side * -0.08, side * 0.34);
      dummy.scale.set(0.38, 0.22, 0.16);
      dummy.updateMatrix();
      hairPieces.setMatrixAt(index + 1, dummy.matrix);
    });
    hairPieces.instanceMatrix.needsUpdate = true;
    hairPieces.computeBoundingSphere();
    head.add(hairPieces);

    const eyeWhites = new THREE.InstancedMesh(sphereGeometry, eyeWhiteMaterial, 2);
    [-1, 1].forEach((side, index) => {
      dummy.position.set(side * 0.215, 0.005, 0.555);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.145, 0.18, 0.06);
      dummy.updateMatrix();
      eyeWhites.setMatrixAt(index, dummy.matrix);
    });
    eyeWhites.instanceMatrix.needsUpdate = true;
    eyeWhites.computeBoundingSphere();
    head.add(eyeWhites);

    const pupils = new THREE.InstancedMesh(sphereGeometry, eyeMaterial, 2);
    [-1, 1].forEach((side, index) => {
      dummy.position.set(side * 0.215, 0.002, 0.592);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.063, 0.088, 0.036);
      dummy.updateMatrix();
      pupils.setMatrixAt(index, dummy.matrix);
    });
    pupils.instanceMatrix.needsUpdate = true;
    pupils.computeBoundingSphere();
    head.add(pupils);

    const brows = new THREE.InstancedMesh(boxGeometry, eyeMaterial, 2);
    [-1, 1].forEach((side, index) => {
      dummy.position.set(side * 0.205, 0.18, 0.557);
      dummy.rotation.set(0, 0, side * -0.13);
      dummy.scale.set(0.2, 0.035, 0.035);
      dummy.updateMatrix();
      brows.setMatrixAt(index, dummy.matrix);
    });
    brows.instanceMatrix.needsUpdate = true;
    brows.computeBoundingSphere();
    const nose = mesh(sphereGeometry, noseMaterial, [0, -0.08, 0.588], [0.06, 0.068, 0.045]);
    const smile = mesh(smileGeometry, eyeMaterial, [0, -0.22, 0.55], [1.08, 0.62, 1], [0, 0, Math.PI]);
    head.add(brows, nose, smile);
    root.add(head);

    function makeArm(side) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.61, 2.29, 0);
      const upper = mesh(limbGeometry, hoodieLightMaterial, [0, -0.27, 0], [0.32, 0.54, 0.32]);
      const elbow = new THREE.Group();
      elbow.position.set(0, -0.53, 0);
      const lower = mesh(limbGeometry, hoodieMaterial, [0, -0.24, 0], [0.28, 0.48, 0.28]);
      const hand = mesh(sphereGeometry, faceMaterial, [0, -0.51, 0], [0.42, 0.44, 0.4]);
      elbow.add(lower, hand);
      shoulder.add(upper, elbow);
      root.add(shoulder);
      return { shoulder, elbow };
    }

    function makeLeg(side) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.25, 1.2, 0);
      const upper = mesh(limbGeometry, jeansLightMaterial, [0, -0.29, 0], [0.37, 0.58, 0.37]);
      const knee = new THREE.Group();
      knee.position.set(0, -0.57, 0);
      const lower = mesh(limbGeometry, jeansMaterial, [0, -0.26, 0], [0.32, 0.52, 0.32]);
      const shoe = mesh(sphereGeometry, shoeMaterial, [0, -0.57, 0.13], [0.5, 0.26, 0.74], [0.04, 0, 0]);
      knee.add(lower, shoe);
      hip.add(upper, knee);
      root.add(hip);
      return { hip, knee };
    }

    const leftArm = makeArm(-1);
    const rightArm = makeArm(1);
    const leftLeg = makeLeg(-1);
    const rightLeg = makeLeg(1);

    root.scale.setScalar(mobile ? 0.82 : 0.9);
    root.userData.fadeMaterials = fadeMaterials;
    root.userData.baseScale = mobile ? 0.82 : 0.9;
    avatarRig = {
      root,
      pelvis,
      torso,
      head,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
    };
    world.add(root);
    return root;
  }

  function buildIntroProps() {
    const group = makeChapterGroup(0);
    const beaconGeometry = trackGeometry(new THREE.CylinderGeometry(0.045, 0.08, 0.56, 6));
    const beaconMaterial = chapterMaterial(group, "standard", COLORS.gold, {
      emissive: COLORS.gold,
      emissiveIntensity: 0.65,
      roughness: 0.5,
    });
    const beacons = new THREE.InstancedMesh(beaconGeometry, beaconMaterial, 5);
    for (let index = 0; index < 5; index += 1) {
      dummy.position.set(-1.7 + index * 0.62, 0.3, 0.2 + (index % 2) * 0.55);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.75 + index * 0.08);
      dummy.updateMatrix();
      beacons.setMatrixAt(index, dummy.matrix);
    }
    beacons.instanceMatrix.needsUpdate = true;
    beacons.computeBoundingSphere();
    group.add(beacons);
    animation.intro = group;
  }

  function buildPocketPilotProps() {
    const group = makeChapterGroup(1);
    const bodyGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const screenGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const bodyMaterial = chapterMaterial(group, "standard", COLORS.charcoal, {
      roughness: 0.45,
      metalness: 0.18,
    });
    const screenMaterials = [
      chapterMaterial(group, "basic", COLORS.cyan, { opacity: 0.92 }),
      chapterMaterial(group, "basic", COLORS.gold, { opacity: 0.92 }),
      chapterMaterial(group, "basic", COLORS.cyanSoft, { opacity: 0.9 }),
    ];
    screenMaterials.forEach((material, index) => {
      loadColorTexture(POCKETPILOT_TEXTURE_URLS[index], material);
    });
    const phones = [];
    const layouts = [
      [-2.2, 1.86, 0.28, -0.08, -0.1],
      [-3.02, 1.54, 0.7, 0.13, 0.08],
      [-1.37, 1.48, 0.61, -0.12, -0.07],
    ];
    layouts.forEach((layout, index) => {
      const phone = new THREE.Group();
      phone.position.set(layout[0], layout[1], layout[2]);
      phone.rotation.set(layout[3], layout[4], index === 1 ? -0.08 : index === 2 ? 0.08 : 0);
      const body = mesh(bodyGeometry, bodyMaterial, [0, 0, 0], [0.68, 1.28, 0.1]);
      const screen = mesh(screenGeometry, screenMaterials[index], [0, 0, 0.075], [0.58, 1.08, 0.035]);
      phone.add(body, screen);
      phone.userData.baseY = phone.position.y;
      phone.userData.baseRotationY = phone.rotation.y;
      phones.push(phone);
      group.add(phone);
    });
    animation.phones = phones;
  }

  function buildWargProps() {
    const group = makeChapterGroup(2);
    const drone = new THREE.Group();
    drone.position.set(-2.15, 2.12, 0.32);
    drone.userData.baseY = drone.position.y;

    const bodyGeometry = trackGeometry(new THREE.OctahedronGeometry(0.42, 0));
    const armGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const rotorGeometry = trackGeometry(new THREE.TorusGeometry(0.25, 0.025, 5, 16));
    const bodyMaterial = chapterMaterial(group, "standard", COLORS.navyLight, {
      roughness: 0.42,
      metalness: 0.22,
    });
    const accentMaterial = chapterMaterial(group, "standard", COLORS.gold, {
      emissive: COLORS.gold,
      emissiveIntensity: 0.28,
      roughness: 0.54,
    });
    const ringMaterial = chapterMaterial(group, "line", COLORS.cyan, { opacity: 0.7 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.scale.set(1.3, 0.48, 0.95);
    drone.add(body);

    const arms = new THREE.InstancedMesh(armGeometry, bodyMaterial, 4);
    const rotors = new THREE.InstancedMesh(rotorGeometry, accentMaterial, 4);
    const rotorPositions = [
      [-0.77, 0, -0.64], [0.77, 0, -0.64], [-0.77, 0, 0.64], [0.77, 0, 0.64],
    ];
    rotorPositions.forEach((position, index) => {
      dummy.position.set(position[0] * 0.52, 0, position[2] * 0.52);
      dummy.rotation.set(0, position[0] * position[2] > 0 ? -0.72 : 0.72, 0);
      dummy.scale.set(0.94, 0.08, 0.08);
      dummy.updateMatrix();
      arms.setMatrixAt(index, dummy.matrix);

      dummy.position.set(position[0], 0.04, position[2]);
      dummy.rotation.set(Math.PI / 2, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      rotors.setMatrixAt(index, dummy.matrix);
    });
    arms.instanceMatrix.needsUpdate = true;
    rotors.instanceMatrix.needsUpdate = true;
    arms.computeBoundingSphere();
    rotors.computeBoundingSphere();
    drone.add(arms, rotors);

    const rings = [
      ...makeCircleSegments(1.4, mobile ? 18 : 26, "xy"),
      ...makeCircleSegments(1.16, mobile ? 18 : 26, "yz"),
    ];
    const ringLines = new THREE.LineSegments(trackGeometry(makeLineGeometry(rings)), ringMaterial);
    drone.add(ringLines);
    group.add(drone);
    animation.drone = drone;
    animation.droneRings = ringLines;
  }

  function buildEmbeddedProps() {
    const group = makeChapterGroup(3);
    const boxGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const cylinderGeometry = trackGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 12));
    const torusGeometry = trackGeometry(new THREE.TorusGeometry(0.52, 0.045, 6, 18));
    const boardMaterial = chapterMaterial(group, "standard", 0x174f4b, {
      roughness: 0.68,
      metalness: 0.08,
    });
    const componentMaterial = chapterMaterial(group, "standard", COLORS.copper, {
      emissive: COLORS.copper,
      emissiveIntensity: 0.12,
      roughness: 0.53,
    });
    const motorMaterial = chapterMaterial(group, "standard", COLORS.charcoalLight, {
      roughness: 0.38,
      metalness: 0.45,
    });
    const ringMaterial = chapterMaterial(group, "standard", COLORS.gold, {
      emissive: COLORS.gold,
      emissiveIntensity: 0.28,
      roughness: 0.42,
    });

    const board = mesh(boxGeometry, boardMaterial, [-2.15, 0.66, 0.12], [2.2, 0.1, 1.46], [0, 0.06, 0]);
    group.add(board);
    const components = new THREE.InstancedMesh(boxGeometry, componentMaterial, 9);
    for (let index = 0; index < 9; index += 1) {
      dummy.position.set(-2.95 + (index % 3) * 0.72, 0.82, -0.34 + Math.floor(index / 3) * 0.42);
      dummy.rotation.set(0, (index % 2) * 0.3, 0);
      dummy.scale.set(0.18 + (index % 2) * 0.08, 0.16 + (index % 3) * 0.035, 0.15);
      dummy.updateMatrix();
      components.setMatrixAt(index, dummy.matrix);
    }
    components.instanceMatrix.needsUpdate = true;
    components.computeBoundingSphere();
    group.add(components);

    const motor = mesh(cylinderGeometry, motorMaterial, [-1.35, 1.19, 0.22], [0.7, 0.62, 0.7], [0, 0, Math.PI / 2]);
    const motorRing = mesh(torusGeometry, ringMaterial, [-1.35, 1.19, 0.22], [1, 1, 1], [0, Math.PI / 2, 0]);
    group.add(motor, motorRing);
    animation.motor = motor;
    animation.motorRing = motorRing;
  }

  function buildAiProps() {
    const group = makeChapterGroup(4);
    const nodeGeometry = trackGeometry(new THREE.IcosahedronGeometry(0.16, 1));
    const nodeMaterial = chapterMaterial(group, "standard", COLORS.cyan, {
      emissive: COLORS.cyan,
      emissiveIntensity: 0.42,
      roughness: 0.44,
    });
    const edgeMaterial = chapterMaterial(group, "line", COLORS.cyanSoft, { opacity: 0.56 });
    const signalMaterial = chapterMaterial(group, "basic", COLORS.gold, {
      opacity: 0.95,
      depthWrite: false,
    });
    const positions = [
      [-3.0, 1.12, -0.42], [-2.45, 2.02, 0.05], [-1.72, 1.24, 0.54],
      [-2.85, 2.75, 0.72], [-1.55, 2.7, -0.28], [-0.95, 1.86, 0.35],
    ];
    const nodes = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, positions.length);
    positions.forEach((position, index) => {
      dummy.position.set(position[0], position[1], position[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(index % 2 === 0 ? 1 : 1.25);
      dummy.updateMatrix();
      nodes.setMatrixAt(index, dummy.matrix);
    });
    nodes.instanceMatrix.needsUpdate = true;
    nodes.computeBoundingSphere();
    group.add(nodes);

    const connections = [[0, 1], [1, 2], [1, 3], [1, 4], [2, 5], [4, 5], [3, 4]].map(([from, to]) => [
      positions[from], positions[to],
    ]);
    const edges = new THREE.LineSegments(trackGeometry(makeLineGeometry(connections)), edgeMaterial);
    group.add(edges);

    const signalGeometry = trackGeometry(new THREE.SphereGeometry(0.07, 7, 5));
    const signals = new THREE.InstancedMesh(signalGeometry, signalMaterial, 3);
    group.add(signals);
    group.userData.nodePositions = positions;
    animation.aiGroup = group;
    animation.aiSignals = signals;
  }

  function buildWaterProps() {
    const group = makeChapterGroup(5);
    const rippleSegments = [];
    [0.62, 1.14, 1.72].forEach((radius) => {
      rippleSegments.push(...makeCircleSegments(radius, mobile ? 22 : 34, "xz", [-1.85, 0.04, 0.08]));
    });
    const rippleMaterial = chapterMaterial(group, "line", COLORS.water, { opacity: 0.62 });
    const ripples = new THREE.LineSegments(trackGeometry(makeLineGeometry(rippleSegments)), rippleMaterial);
    group.add(ripples);

    const hullGeometry = trackGeometry(new THREE.ConeGeometry(0.48, 1.26, 4));
    const markerGeometry = trackGeometry(new THREE.CylinderGeometry(0.05, 0.05, 1.05, 6));
    const hullMaterial = chapterMaterial(group, "standard", COLORS.copper, { roughness: 0.72 });
    const markerMaterial = chapterMaterial(group, "standard", COLORS.gold, {
      emissive: COLORS.gold,
      emissiveIntensity: 0.48,
      roughness: 0.55,
    });
    const boat = mesh(hullGeometry, hullMaterial, [-1.85, 0.28, 0.08], [0.68, 1, 0.34], [0, 0, Math.PI / 2]);
    const marker = mesh(markerGeometry, markerMaterial, [-1.85, 0.84, 0.08], [1, 1, 1]);
    group.add(boat, marker);
    animation.ripples = ripples;
    animation.boat = boat;
  }

  function buildWorkProps() {
    const group = makeChapterGroup(6);
    const panelGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const panelMaterial = chapterMaterial(group, "standard", COLORS.navyLight, {
      roughness: 0.55,
      metalness: 0.12,
    });
    const screenMaterial = chapterMaterial(group, "basic", COLORS.cyanSoft, { opacity: 0.76 });
    const panels = new THREE.InstancedMesh(panelGeometry, panelMaterial, 3);
    const screens = new THREE.InstancedMesh(panelGeometry, screenMaterial, 3);
    const layouts = [[-3.2, 1.64, 0.8, -0.12], [-2.05, 1.88, 0.18, 0.04], [-0.95, 1.46, 0.72, 0.12]];
    layouts.forEach((layout, index) => {
      dummy.position.set(layout[0], layout[1], layout[2]);
      dummy.rotation.set(0, layout[3], 0);
      dummy.scale.set(0.9, 1.18, 0.08);
      dummy.updateMatrix();
      panels.setMatrixAt(index, dummy.matrix);
      dummy.position.z += 0.07;
      dummy.scale.set(0.74, 0.92, 0.025);
      dummy.updateMatrix();
      screens.setMatrixAt(index, dummy.matrix);
    });
    panels.instanceMatrix.needsUpdate = true;
    screens.instanceMatrix.needsUpdate = true;
    panels.computeBoundingSphere();
    screens.computeBoundingSphere();
    group.add(panels, screens);
    animation.workPanels = group;
  }

  function buildProfileProps() {
    const group = makeChapterGroup(7);
    const ringGeometry = trackGeometry(new THREE.TorusGeometry(0.94, 0.055, 6, 28));
    const bustGeometry = trackGeometry(new THREE.CapsuleGeometry(0.42, 0.52, 4, 8));
    const headGeometry = trackGeometry(new THREE.SphereGeometry(0.36, 10, 7));
    const frameMaterial = chapterMaterial(group, "standard", COLORS.gold, {
      emissive: COLORS.gold,
      emissiveIntensity: 0.31,
      roughness: 0.48,
    });
    const portraitMaterial = chapterMaterial(group, "standard", COLORS.cyan, {
      emissive: COLORS.cyan,
      emissiveIntensity: 0.18,
      roughness: 0.62,
    });
    const frame = mesh(ringGeometry, frameMaterial, [-2.05, 1.83, 0.18], [1, 1, 1]);
    const bust = mesh(bustGeometry, portraitMaterial, [-2.05, 1.43, 0.13], [1.02, 0.92, 0.54]);
    const portraitHead = mesh(headGeometry, portraitMaterial, [-2.05, 2.28, 0.14], [1, 1.1, 0.82]);
    group.add(frame, bust, portraitHead);
    animation.profileFrame = frame;
  }

  function buildContactProps() {
    const group = makeChapterGroup(8);
    const platformGeometry = trackGeometry(new THREE.CylinderGeometry(1.2, 1.42, 0.22, 24));
    const lightGeometry = trackGeometry(new THREE.CylinderGeometry(0.055, 0.055, 0.08, 6));
    const platformMaterial = chapterMaterial(group, "standard", COLORS.navyLight, {
      roughness: 0.46,
      metalness: 0.22,
    });
    const lightMaterial = chapterMaterial(group, "standard", COLORS.gold, {
      emissive: COLORS.gold,
      emissiveIntensity: 0.92,
      roughness: 0.44,
    });
    const platform = mesh(platformGeometry, platformMaterial, [0, 0.02, 0], [1, 1, 1]);
    group.add(platform);
    const lights = new THREE.InstancedMesh(lightGeometry, lightMaterial, 12);
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * TAU;
      dummy.position.set(Math.cos(angle) * 1.02, 0.16, Math.sin(angle) * 1.02);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      lights.setMatrixAt(index, dummy.matrix);
    }
    lights.instanceMatrix.needsUpdate = true;
    lights.computeBoundingSphere();
    group.add(lights);
    animation.contactPlatform = platform;
    animation.contactLights = lights;
  }

  function buildScene() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(mobile ? 44 : 36, 1, 0.1, 80);
    world = new THREE.Group();
    world.name = "continuous-avatar-world";
    scene.add(world);

    const hemisphere = new THREE.HemisphereLight(0xc7f5ff, 0x08111d, mobile ? 1.35 : 1.55);
    const key = new THREE.DirectionalLight(0xffe4b2, mobile ? 2.0 : 2.35);
    key.position.set(3.5, 7.5, 5.5);
    const rim = new THREE.PointLight(COLORS.cyan, mobile ? 6 : 9, 12, 2);
    rim.position.set(-3.4, 3.8, 3.2);
    scene.add(hemisphere, key, rim);

    buildRoute();
    avatar = buildAvatar();
    buildIntroProps();
    buildPocketPilotProps();
    buildWargProps();
    buildEmbeddedProps();
    buildAiProps();
    buildWaterProps();
    buildWorkProps();
    buildProfileProps();
    buildContactProps();
  }

  function dispatch(name, detail) {
    if (!canvas || typeof canvas.dispatchEvent !== "function" || typeof CustomEvent === "undefined") return;
    canvas.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function handleContextLost(event) {
    if (disposed) return;
    event.preventDefault();
    contextLost = true;
    initialized = false;
    dispatch("avatarworldcontextlost", { event });
    if (typeof options.onContextLost === "function") options.onContextLost(event);
  }

  function handleContextRestored(event) {
    if (disposed || !renderer || !scene || !camera) return;
    try {
      contextLost = false;
      resize(viewportWidth, viewportHeight, mobile);
      renderer.compile(scene, camera);
      renderer.render(scene, camera);
      initialized = true;
      dispatch("avatarworldcontextrestored", { event });
      if (typeof options.onContextRestored === "function") options.onContextRestored(event);
    } catch (error) {
      initializationError = error;
      contextLost = true;
      dispatch("avatarworlderror", { error });
      if (typeof options.onError === "function") options.onError(error);
    }
  }

  function initialize() {
    if (initialized && !contextLost) return true;
    if (disposed || !canvas || typeof canvas.getContext !== "function") {
      initializationError = new TypeError("A usable canvas is required for the avatar world.");
      return false;
    }

    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: !mobile,
        powerPreference: "high-performance",
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.shadowMap.enabled = false;
      renderer.sortObjects = true;

      buildScene();
      canvas.addEventListener("webglcontextlost", handleContextLost, false);
      canvas.addEventListener("webglcontextrestored", handleContextRestored, false);
      resize();
      update(0, 0);
      renderer.compile(scene, camera);
      renderer.render(scene, camera);
      initialized = true;
      contextLost = false;
      initializationError = null;
      dispatch("avatarworldready", { renderer });
      return true;
    } catch (error) {
      initializationError = error;
      initialized = false;
      contextLost = false;
      if (renderer) {
        try { renderer.dispose(); } catch (_) {}
      }
      renderer = null;
      dispatch("avatarworlderror", { error });
      if (typeof options.onError === "function") options.onError(error);
      return false;
    }
  }

  function updateChapterGroups(progress, timestamp) {
    chapterGroups.forEach((group, index) => {
      const distance = Math.abs(progress - group.userData.stop);
      const influence = 1 - smoothstep(0.052, 0.092, distance);
      group.visible = influence > 0.002;
      if (!group.visible) return;
      const scale = 0.88 + influence * 0.12;
      group.scale.setScalar(scale);
      group.userData.fadeMaterials.forEach((material) => {
        material.opacity = material.userData.baseOpacity * influence;
      });

      const localTime = timestamp * 0.001 + index * 0.77;
      if (index === 0) group.rotation.y = Math.sin(localTime * 0.7) * 0.025;
    });

    if (animation.phones) {
      animation.phones.forEach((phone, index) => {
        phone.position.y = phone.userData.baseY + Math.sin(timestamp * 0.0014 + index * 1.7) * 0.09;
        phone.rotation.y = phone.userData.baseRotationY + Math.sin(timestamp * 0.001 + index) * 0.055;
      });
    }
    if (animation.drone) {
      animation.drone.position.y = animation.drone.userData.baseY + Math.sin(timestamp * 0.002) * 0.11;
      animation.drone.rotation.y = Math.sin(timestamp * 0.0007) * 0.16;
      animation.drone.rotation.z = Math.sin(timestamp * 0.0014) * 0.035;
    }
    if (animation.droneRings) {
      animation.droneRings.rotation.x = timestamp * 0.00018;
      animation.droneRings.rotation.z = timestamp * -0.00022;
    }
    if (animation.motor) animation.motor.rotation.x = timestamp * 0.0016;
    if (animation.motorRing) animation.motorRing.rotation.x = timestamp * -0.0011;
    if (animation.aiGroup) animation.aiGroup.rotation.y = Math.sin(timestamp * 0.00045) * 0.04;
    if (animation.aiSignals && animation.aiGroup?.userData.nodePositions) {
      const nodes = animation.aiGroup.userData.nodePositions;
      for (let index = 0; index < 3; index += 1) {
        const amount = (timestamp * 0.00022 + index * 0.31) % 1;
        const from = nodes[index + 1];
        const to = nodes[index + 2];
        dummy.position.set(
          mix(from[0], to[0], amount),
          mix(from[1], to[1], amount),
          mix(from[2], to[2], amount),
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.78 + Math.sin(amount * Math.PI) * 0.42);
        dummy.updateMatrix();
        animation.aiSignals.setMatrixAt(index, dummy.matrix);
      }
      animation.aiSignals.instanceMatrix.needsUpdate = true;
    }
    if (animation.ripples) {
      const rippleScale = 1 + Math.sin(timestamp * 0.0013) * 0.025;
      animation.ripples.scale.set(rippleScale, 1, rippleScale);
    }
    if (animation.boat) {
      animation.boat.rotation.z = Math.PI / 2 + Math.sin(timestamp * 0.0017) * 0.035;
      animation.boat.position.y = 0.28 + Math.sin(timestamp * 0.0019) * 0.025;
    }
    if (animation.profileFrame) animation.profileFrame.rotation.z = Math.sin(timestamp * 0.0007) * 0.06;
    if (animation.contactLights?.material) {
      const base = animation.contactLights.material.userData.baseOpacity;
      animation.contactLights.material.opacity = base * (0.84 + Math.sin(timestamp * 0.004) * 0.16);
    }
  }

  function updateAvatar(progress, timestamp) {
    const wave = clamp(pulse(progress, 0.035, 0.052) + pulse(progress, 0.962, 0.045));
    const point = pulse(progress, 0.145, 0.052);
    const inspect = pulse(progress, 0.365, 0.056);
    const profilePause = pulse(progress, 0.842, 0.062);
    const contactPause = smoothstep(0.93, 0.965, progress);
    const stillness = clamp(Math.max(profilePause * 0.82, contactPause * 0.94, point * 0.42, inspect * 0.5));
    const walkAmount = 1 - stillness;
    const phase = progress * Math.PI * 38;
    const stride = Math.sin(phase);
    const counterStride = Math.sin(phase + Math.PI);
    const bob = Math.abs(Math.sin(phase)) * 0.045 * walkAmount;
    const idleBob = Math.sin(timestamp * 0.0022) * 0.012 * stillness;

    path.getPointAt(progress, pathPoint);
    path.getTangentAt(clamp(progress, 0.001, 0.999), pathTangent).normalize();
    const platformLift = smoothstep(0.91, 0.96, progress) * 0.1;
    avatar.position.set(pathPoint.x, 0.1 + platformLift + bob + idleBob, pathPoint.z);
    avatar.rotation.y = Math.atan2(pathTangent.x, pathTangent.z);

    const legSwing = 0.54 * walkAmount;
    avatarRig.leftLeg.hip.rotation.x = stride * legSwing;
    avatarRig.rightLeg.hip.rotation.x = counterStride * legSwing;
    avatarRig.leftLeg.knee.rotation.x = Math.max(0, -stride) * 0.58 * walkAmount;
    avatarRig.rightLeg.knee.rotation.x = Math.max(0, -counterStride) * 0.58 * walkAmount;

    let leftArmX = counterStride * 0.42 * walkAmount;
    let rightArmX = stride * 0.42 * walkAmount;
    let leftArmZ = -0.04;
    let rightArmZ = 0.04;
    let leftElbowX = -0.08;
    let rightElbowX = -0.08;
    let leftElbowZ = 0;
    let rightElbowZ = 0;

    leftArmX = mix(leftArmX, -0.2, point);
    leftArmZ = mix(leftArmZ, -1.48, point);
    leftElbowX = mix(leftElbowX, -0.12, point);
    leftElbowZ = mix(leftElbowZ, -0.08, point);

    rightArmX = mix(rightArmX, -0.1, wave);
    rightArmZ = mix(rightArmZ, 2.66, wave);
    rightElbowX = mix(rightElbowX, -0.18, wave);
    rightElbowZ = mix(rightElbowZ, Math.sin(timestamp * 0.0065) * 0.42, wave);

    leftArmX = mix(leftArmX, -0.88, inspect);
    rightArmX = mix(rightArmX, -0.88, inspect);
    leftArmZ = mix(leftArmZ, -0.26, inspect);
    rightArmZ = mix(rightArmZ, 0.26, inspect);
    leftElbowX = mix(leftElbowX, -0.7, inspect);
    rightElbowX = mix(rightElbowX, -0.7, inspect);

    avatarRig.leftArm.shoulder.rotation.set(leftArmX, 0, leftArmZ);
    avatarRig.rightArm.shoulder.rotation.set(rightArmX, 0, rightArmZ);
    avatarRig.leftArm.elbow.rotation.set(leftElbowX, 0, leftElbowZ);
    avatarRig.rightArm.elbow.rotation.set(rightElbowX, 0, rightElbowZ);
    avatarRig.pelvis.rotation.y = stride * 0.055 * walkAmount;
    avatarRig.torso.rotation.y = counterStride * 0.045 * walkAmount;
    avatarRig.torso.rotation.z = Math.sin(phase * 0.5) * 0.012 * walkAmount;
    avatarRig.head.rotation.y = -0.38 * point - 0.28 * inspect + Math.sin(phase * 0.18) * 0.025;
    avatarRig.head.rotation.z = 0.05 * wave;

    avatarRig.root.userData.fadeMaterials.forEach((material) => {
      material.opacity = material.userData.baseOpacity;
    });
    avatarRig.root.visible = progress < 0.9998;
  }

  function updateCamera(progress) {
    const desktopFrames = [
      [-0.15, 4.55, 8.0, -1.7, 1.82], [0.1, 4.8, 8.3, -1.72, 1.9],
      [-0.1, 4.75, 8.6, -1.85, 1.95], [0.05, 4.7, 8.25, -1.7, 1.82],
      [-0.15, 4.9, 8.55, -1.82, 1.98], [0.1, 4.65, 8.15, -1.72, 1.74],
      [-0.05, 4.85, 8.45, -1.78, 1.9], [0.08, 4.55, 7.95, -1.62, 1.83],
      [0, 4.7, 8.2, -1.66, 1.85],
    ];
    const mobileFrames = [
      [0, 5.3, 9.6, -1.05, 3.68], [0, 5.5, 10.0, -1.05, 3.78],
      [0, 5.55, 10.15, -1.05, 3.82], [0, 5.4, 9.9, -1.05, 3.72],
      [0, 5.65, 10.25, -1.05, 3.88], [0, 5.35, 9.8, -1.05, 3.68],
      [0, 5.6, 10.1, -1.05, 3.8], [0, 5.28, 9.65, -1.05, 3.66],
      [0, 5.4, 9.85, -1.05, 3.72],
    ];
    const frames = mobile ? mobileFrames : desktopFrames;
    const scaled = progress * (frames.length - 1);
    const frameIndex = Math.min(frames.length - 2, Math.floor(scaled));
    const amount = smoothstep(0, 1, scaled - frameIndex);
    const first = frames[frameIndex];
    const second = frames[frameIndex + 1];

    cameraPosition.set(
      pathPoint.x + mix(first[0], second[0], amount),
      mix(first[1], second[1], amount),
      pathPoint.z + mix(first[2], second[2], amount),
    );
    cameraTarget.set(
      pathPoint.x + mix(first[3], second[3], amount),
      mix(first[4], second[4], amount),
      pathPoint.z + 0.08,
    );
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraTarget);
  }

  function normalizeUpdateInput(progressOrState, timestamp) {
    if (typeof progressOrState === "object" && progressOrState !== null) {
      const progress = progressOrState.progress ?? progressOrState.globalProgress ?? 0;
      return {
        progress: clamp(Number.isFinite(progress) ? progress : 0),
        timestamp: Number.isFinite(progressOrState.timestamp) ? progressOrState.timestamp : timestamp,
      };
    }
    return {
      progress: clamp(Number.isFinite(progressOrState) ? progressOrState : 0),
      timestamp,
    };
  }

  function update(progressOrState, timestamp = 0) {
    if (!active || !renderer || !scene || !camera || contextLost || disposed) return;
    const state = normalizeUpdateInput(progressOrState, Number.isFinite(timestamp) ? timestamp : 0);
    currentProgress = state.progress;
    updateAvatar(state.progress, state.timestamp);
    updateChapterGroups(state.progress, state.timestamp);
    updateCamera(state.progress);
    if (routeMaterial) routeMaterial.opacity = 0.43 + Math.sin(state.timestamp * 0.0015) * 0.07;
    renderer.render(scene, camera);
    peakDrawCalls = Math.max(peakDrawCalls, renderer.info.render.calls);
    peakTriangles = Math.max(peakTriangles, renderer.info.render.triangles);
    canvas.dataset.avatarDrawCalls = String(peakDrawCalls);
    canvas.dataset.avatarTriangles = String(peakTriangles);
  }

  function resize(width, height, mobileOverride) {
    if (!renderer || !camera || disposed) return;
    const fallbackWidth = typeof window !== "undefined" ? window.innerWidth : canvas.clientWidth;
    const fallbackHeight = typeof window !== "undefined" ? window.innerHeight : canvas.clientHeight;
    viewportWidth = Math.max(1, Math.round(width ?? (canvas.clientWidth || fallbackWidth || 1)));
    viewportHeight = Math.max(1, Math.round(height ?? (canvas.clientHeight || fallbackHeight || 1)));
    mobile = typeof mobileOverride === "boolean"
      ? mobileOverride
      : viewportWidth <= 760 || viewportHeight > viewportWidth * 1.22;
    if (avatarRig?.root) {
      const avatarScale = mobile ? 0.82 : 0.9;
      avatarRig.root.scale.setScalar(avatarScale);
      avatarRig.root.userData.baseScale = avatarScale;
    }
    const deviceRatio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    renderer.setPixelRatio(Math.min(deviceRatio, mobile ? 1 : 1.5));
    renderer.setSize(viewportWidth, viewportHeight, false);
    camera.aspect = viewportWidth / viewportHeight;
    camera.fov = mobile ? 44 : 36;
    camera.updateProjectionMatrix();
    update(currentProgress, typeof performance !== "undefined" ? performance.now() : 0);
  }

  function setActive(nextActive) {
    active = Boolean(nextActive);
    if (active && renderer && scene && camera && !contextLost && !disposed) {
      update(currentProgress, typeof performance !== "undefined" ? performance.now() : 0);
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    initialized = false;
    if (canvas) {
      canvas.removeEventListener("webglcontextlost", handleContextLost, false);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored, false);
      delete canvas.dataset.avatarDrawCalls;
      delete canvas.dataset.avatarTriangles;
    }
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    geometries.clear();
    materials.clear();
    textures.clear();
    if (renderer) {
      renderer.setAnimationLoop(null);
      renderer.renderLists?.dispose();
      renderer.dispose();
    }
    renderer = null;
    scene = null;
    camera = null;
    world = null;
    avatar = null;
    avatarRig = null;
  }

  const lifecycle = {
    initialize,
    update,
    resize,
    setActive,
    dispose,
    get ready() {
      return initialized && !contextLost && !disposed;
    },
    get error() {
      return initializationError;
    },
  };

  if (!initialize()) {
    const error = initializationError || new Error("Unable to initialize the avatar world.");
    dispose();
    throw error;
  }

  return lifecycle;
}

export default createAvatarWorld;
