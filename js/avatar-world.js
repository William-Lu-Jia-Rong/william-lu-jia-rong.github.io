import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "./vendor/addons/loaders/HDRLoader.js";
import { AVATAR_TIMELINE_RANGES } from "./avatar-timeline.js";

const CHAPTER_STOPS = Object.freeze(AVATAR_TIMELINE_RANGES.slice(0, -1));
const TAU = Math.PI * 2;
const CANONICAL_ROBOT_HEIGHT = 2.2;
const MAX_MODEL_DRAWS = 12;
const MAX_MODEL_TRIANGLES = 50000;
const ROBOT_MODEL_URL = new URL("../assets/3d/poddy-m1.glb?v=2", import.meta.url).href;
const WORKSHOP_HDR_URL = new URL("../assets/3d/aerodynamics-workshop-1k.hdr", import.meta.url).href;
const ROBOT_CLIPS = Object.freeze({
  present: "pose 1 - presentation",
  surprise: "pose 2 - omfg",
  wave: "pose 3 - hello",
  welcome: "pose 4 - warm welcome",
  sad: "pose 5 - sit sad",
  presentFlipped: "pose 6 - presentation flipped",
});
const REQUIRED_ROBOT_CLIPS = Object.freeze(Object.values(ROBOT_CLIPS));
const POCKETPILOT_TEXTURE_URLS = Object.freeze([
  new URL("../images/pocketpilot/screenshot-insights.webp", import.meta.url).href,
  new URL("../images/pocketpilot/screenshot-scan.webp", import.meta.url).href,
  new URL("../images/pocketpilot/screenshot-transactions.webp", import.meta.url).href,
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
  robotWhite: 0xe9f1f3,
  robotGray: 0xaabac4,
  screen: 0x020a12,
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
 * The factory resolves only after the imported robot and lighting assets have
 * loaded, validated, and compiled. It rejects on any startup failure so callers
 * can enter their static fallback path without exposing an incomplete world.
 *
 * @returns {Promise<{initialize: function(): Promise<boolean>, update: function(number|object, number=): void,
 *   resize: function(number=, number=, boolean=): void, setActive: function(boolean): void, dispose: function(): void,
 *   readonly ready: boolean, readonly error: unknown}>}
 */
export async function createAvatarWorld(options = {}) {
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
  const cameraOffset = new THREE.Vector3();
  const targetOffset = new THREE.Vector3();
  const toolStart = new THREE.Vector3();
  const toolTarget = new THREE.Vector3();
  const additiveQuaternion = new THREE.Quaternion();
  const additiveEuler = new THREE.Euler();
  const dummy = new THREE.Object3D();

  let renderer = null;
  let scene = null;
  let camera = null;
  let world = null;
  let avatar = null;
  let avatarMixer = null;
  let avatarActions = null;
  let avatarClips = null;
  let avatarRig = null;
  let environmentRenderTarget = null;
  let environmentContext = null;
  let environmentSourceTexture = null;
  let assetAbortController = null;
  let externalAbortListener = null;
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
  let compactViewport = false;
  let tabletViewport = false;
  let shortViewport = false;
  let travelEnergy = 0;
  let lastAvatarProgress = 0;
  let lastAvatarTimestamp = 0;
  let movementDirection = 1;

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

  const desktopCameraOffsets = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.08, 4.34, 7.46),
    new THREE.Vector3(-0.06, 4.42, 7.62),
    new THREE.Vector3(0.1, 4.34, 7.5),
    new THREE.Vector3(-0.08, 4.46, 7.65),
    new THREE.Vector3(0.1, 4.3, 7.44),
    new THREE.Vector3(-0.08, 4.42, 7.58),
    new THREE.Vector3(0.07, 4.32, 7.42),
    new THREE.Vector3(0, 4.38, 7.5),
  ], false, "catmullrom", 0.45);
  const mobileCameraOffsets = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.04, 4.82, 8.55),
    new THREE.Vector3(-0.04, 4.96, 8.76),
    new THREE.Vector3(0.05, 4.86, 8.62),
    new THREE.Vector3(-0.04, 5.0, 8.84),
    new THREE.Vector3(0.05, 4.82, 8.58),
    new THREE.Vector3(-0.04, 4.95, 8.78),
    new THREE.Vector3(0.04, 4.82, 8.54),
    new THREE.Vector3(0, 4.88, 8.64),
  ], false, "catmullrom", 0.45);
  const desktopTargetOffsets = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.98, 0.1),
    new THREE.Vector3(0.04, 1.02, 0.08),
    new THREE.Vector3(-0.04, 0.95, 0.12),
    new THREE.Vector3(0.04, 1.02, 0.08),
    new THREE.Vector3(-0.03, 0.95, 0.1),
    new THREE.Vector3(0.03, 1, 0.08),
    new THREE.Vector3(0, 0.96, 0.1),
  ], false, "catmullrom", 0.45);
  const mobileTargetOffsets = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.58, 0.1),
    new THREE.Vector3(0.03, 1.65, 0.08),
    new THREE.Vector3(-0.03, 1.57, 0.12),
    new THREE.Vector3(0.03, 1.66, 0.08),
    new THREE.Vector3(-0.03, 1.56, 0.1),
    new THREE.Vector3(0.02, 1.63, 0.08),
    new THREE.Vector3(0, 1.6, 0.1),
  ], false, "catmullrom", 0.45);

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
    group.userData.start = AVATAR_TIMELINE_RANGES[index];
    group.userData.end = AVATAR_TIMELINE_RANGES[index + 1];
    group.userData.stop = index === 0
      ? 0.025
      : index === CHAPTER_STOPS.length - 1
        ? 0.97
        : (group.userData.start + group.userData.end) * 0.5;
    group.userData.index = index;
    path.getPointAt(group.userData.stop, pathPoint);
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

    const padGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const padMaterial = standardMaterial(0xb9854b, {
      emissive: 0x5b351c,
      emissiveIntensity: 0.08,
      roughness: 0.43,
      metalness: 0.55,
    });
    const padCount = mobile ? 12 : 18;
    const pads = new THREE.InstancedMesh(padGeometry, padMaterial, padCount);
    for (let index = 0; index < padCount; index += 1) {
      const t = (index + 0.5) / padCount;
      path.getPointAt(t, pathPoint);
      path.getTangentAt(t, pathTangent).normalize();
      dummy.position.set(pathPoint.x + (index % 2 ? 0.5 : -0.5), 0.025, pathPoint.z);
      dummy.rotation.set(0, Math.atan2(pathTangent.x, pathTangent.z), 0);
      dummy.scale.set(index % 4 === 0 ? 0.28 : 0.22, 0.018, index % 4 === 0 ? 0.38 : 0.3);
      dummy.updateMatrix();
      pads.setMatrixAt(index, dummy.matrix);
    }
    pads.instanceMatrix.needsUpdate = true;
    pads.computeBoundingSphere();
    routeGroup.add(pads);
    world.add(routeGroup);
  }

  function throwIfAssetLoadAborted() {
    if (disposed || assetAbortController?.signal.aborted || options.signal?.aborted) {
      throw new DOMException("Avatar asset loading was aborted.", "AbortError");
    }
  }

  async function fetchArrayBuffer(url) {
    throwIfAssetLoadAborted();
    const response = await fetch(url, {
      cache: "force-cache",
      credentials: "same-origin",
      signal: assetAbortController.signal,
    });
    if (!response.ok) throw new Error(`Unable to load avatar asset (${response.status}): ${url}`);
    const buffer = await response.arrayBuffer();
    throwIfAssetLoadAborted();
    return buffer;
  }

  function createHdrTexture(buffer) {
    const data = new HDRLoader().parse(buffer);
    if (!data?.data || !data.width || !data.height) {
      throw new Error("The workshop HDR did not contain usable image data.");
    }
    const texture = new THREE.DataTexture(
      data.data,
      data.width,
      data.height,
      THREE.RGBAFormat,
      data.type,
    );
    texture.colorSpace = data.colorSpace;
    texture.minFilter = data.minFilter;
    texture.magFilter = data.magFilter;
    texture.generateMipmaps = data.generateMipmaps;
    texture.flipY = data.flipY;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.needsUpdate = true;
    return texture;
  }

  function collectImportedResources(root) {
    const polishedMaterials = new Map();

    function polishMaterial(source, role) {
      const materialKey = `${source.uuid}:${role}`;
      if (polishedMaterials.has(materialKey)) return polishedMaterials.get(materialKey);

      Object.values(source).forEach((value) => {
        if (value?.isTexture) {
          value.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy() || 1);
          textures.add(value);
        }
      });

      const material = new THREE.MeshPhysicalMaterial();
      if (source.isMeshPhysicalMaterial) material.copy(source);
      else THREE.MeshStandardMaterial.prototype.copy.call(material, source);
      material.name = source.name;
      const isScreen = role === "screen";
      const isDetail = role === "detail";
      const isLight = role === "light";
      material.envMapIntensity = isScreen ? 0.72 : isDetail ? 0.92 : 0.7;
      material.clearcoat = isScreen ? 1 : 0.9;
      material.clearcoatRoughness = isScreen ? 0.045 : isDetail ? 0.08 : 0.12;
      material.roughness = isScreen ? 0.12 : isDetail ? 0.22 : 0.28;
      material.metalness = isScreen ? 0.42 : isDetail ? 0.34 : 0.12;

      // Use the authored maps for the visor, normals and surface response, but
      // art-direct the large shells by mesh role. This keeps Poddy crisp and
      // detailed without letting the original bronze atlas muddy the white,
      // navy and cyan portfolio palette.
      if (!isScreen && role !== "body") material.map = null;
      material.color.setHex(isScreen ? 0xd9fbff : isDetail ? 0x132b3b : isLight ? 0xbff8ff : 0xf3f7f7);
      if (isScreen) {
        material.opacity = 0.3;
        material.transparent = true;
        material.depthWrite = false;
      } else if (isLight) {
        material.emissiveMap = null;
        material.emissive.setHex(0x45e6ff);
        material.emissiveIntensity = 2.7;
      } else {
        if (role === "body" && source.emissiveMap) {
          material.emissiveMap = source.emissiveMap;
          material.emissive.setHex(0x45e6ff);
          material.emissiveIntensity = 2.25;
        } else {
          material.emissiveMap = null;
          material.emissive.setHex(0x000000);
          material.emissiveIntensity = 0;
        }
        material.sheen = 0.16;
        material.sheenColor.setHex(0xdffaff);
        material.sheenRoughness = 0.36;
      }
      material.needsUpdate = true;
      materials.add(source);
      trackMaterial(material);
      polishedMaterials.set(materialKey, material);
      return material;
    }

    root.traverse((object) => {
      if (!object.isMesh) return;
      if (object.geometry) geometries.add(object.geometry);
      const objectName = `${object.name} ${object.geometry?.name || ""}`.toLowerCase();
      const role = objectName.includes("screen") || objectName.includes("object_33")
        ? "screen"
        : objectName.includes("lights") || objectName.includes("object_34")
          ? "light"
          : objectName.includes("details") || objectName.includes("object_32")
            ? "detail"
            : "body";
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const replacements = objectMaterials.filter(Boolean).map((material) => polishMaterial(material, role));
      object.material = Array.isArray(object.material) ? replacements : replacements[0];
      object.castShadow = false;
      object.receiveShadow = false;
    });
  }

  function validateRobot(gltf) {
    if (!gltf?.scene) throw new Error("Poddy M1 is missing its scene root.");
    const clipsByName = new Map((gltf.animations || []).map((clip) => [clip.name, clip]));
    const missingClips = REQUIRED_ROBOT_CLIPS.filter((name) => !clipsByName.has(name));
    if (missingClips.length) {
      throw new Error(`Poddy M1 is missing required pose clips: ${missingClips.join(", ")}.`);
    }

    let drawCount = 0;
    let triangleCount = 0;
    let skinnedMeshCount = 0;
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return;
      drawCount += Array.isArray(object.material) ? object.material.length : 1;
      if (object.isSkinnedMesh) skinnedMeshCount += 1;
      const geometry = object.geometry;
      const elementCount = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0;
      triangleCount += elementCount / 3;
    });
    if (!skinnedMeshCount) throw new Error("Poddy M1 does not contain an animated skinned mesh.");
    if (drawCount > MAX_MODEL_DRAWS || triangleCount > MAX_MODEL_TRIANGLES) {
      throw new Error(`Poddy M1 exceeds its render budget (${drawCount} draws, ${Math.ceil(triangleCount)} triangles).`);
    }
    return clipsByName;
  }

  function prepareRobot(gltf, clipsByName) {
    const importedScene = gltf.scene;
    importedScene.name = "poddy-m1-model";
    importedScene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(importedScene);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0.0001) {
      throw new Error("Poddy M1 has invalid model bounds.");
    }

    const center = bounds.getCenter(new THREE.Vector3());
    importedScene.position.x -= center.x;
    importedScene.position.y -= bounds.min.y;
    importedScene.position.z -= center.z;

    const normalizedVisual = new THREE.Group();
    normalizedVisual.name = "normalized-poddy-m1";
    normalizedVisual.scale.setScalar(CANONICAL_ROBOT_HEIGHT / size.y);
    normalizedVisual.add(importedScene);

    avatar = new THREE.Group();
    avatar.name = "poddy-m1-avatar";
    avatar.userData.baseScale = mobile ? 0.72 : 0.66;
    avatar.scale.setScalar(avatar.userData.baseScale);
    avatar.add(normalizedVisual);
    world.add(avatar);

    avatarMixer = new THREE.AnimationMixer(importedScene);
    avatarClips = Object.fromEntries(Object.entries(ROBOT_CLIPS).map(([key, name]) => [key, clipsByName.get(name)]));
    avatarActions = Object.fromEntries(Object.entries(avatarClips).map(([key, clip]) => {
      const action = avatarMixer.clipAction(clip);
      action.enabled = true;
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.setEffectiveWeight(0);
      action.play();
      return [key, action];
    }));
    avatarMixer.update(0);

    const requiredBones = {
      root: "root_b01_01",
      head: "head01_02",
      leftEye: "eye_l_01_03",
      rightEye: "eye_r_01_05",
      leftAntenna: "antenna_l_01_04",
      rightAntenna: "antenna_r_01_06",
      leftArm: "arm_l_01_07",
      rightArm: "arm_r_01_08",
    };
    avatarRig = Object.fromEntries(Object.entries(requiredBones).map(([key, name]) => {
      const bone = importedScene.getObjectByName(name);
      if (!bone?.isBone) throw new Error(`Poddy M1 is missing its ${key} rig bone (${name}).`);
      return [key, bone];
    }));
    avatarRig.leftEye.userData.baseScale = avatarRig.leftEye.scale.clone();
    avatarRig.rightEye.userData.baseScale = avatarRig.rightEye.scale.clone();
    const avatarBoneRest = [];
    importedScene.traverse((object) => {
      if (!object.isBone) return;
      avatarBoneRest.push({
        bone: object,
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
      });
    });
    animation.avatarBoneRest = avatarBoneRest;

    collectImportedResources(importedScene);
    canvas.dataset.avatarModel = "poddy-m1";
    createAvatarShadow();
    createScrewdriver();
  }

  function createAvatarShadow() {
    const textureSize = 64;
    const data = new Uint8Array(textureSize * textureSize * 4);
    for (let y = 0; y < textureSize; y += 1) {
      for (let x = 0; x < textureSize; x += 1) {
        const dx = (x + 0.5) / textureSize * 2 - 1;
        const dy = (y + 0.5) / textureSize * 2 - 1;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const alpha = Math.round(255 * Math.pow(clamp(1 - distance), 1.8));
        const offset = (y * textureSize + x) * 4;
        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = alpha;
      }
    }
    const shadowTexture = new THREE.DataTexture(data, textureSize, textureSize, THREE.RGBAFormat);
    shadowTexture.needsUpdate = true;
    textures.add(shadowTexture);
    const shadowMaterial = trackMaterial(new THREE.MeshBasicMaterial({
      color: 0x01060b,
      map: shadowTexture,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      toneMapped: false,
    }));
    shadowMaterial.userData.baseOpacity = 0.34;
    const shadow = new THREE.Mesh(trackGeometry(new THREE.PlaneGeometry(1.65, 1.18)), shadowMaterial);
    shadow.name = "poddy-contact-shadow";
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.028;
    shadow.renderOrder = -1;
    world.add(shadow);
    animation.avatarShadow = shadow;
  }

  function createScrewdriver() {
    const tool = new THREE.Group();
    tool.name = "poddy-screwdriver";
    tool.visible = false;

    const gripMaterial = standardMaterial(0x173243, {
      roughness: 0.28,
      metalness: 0.52,
    });
    const accentMaterial = standardMaterial(COLORS.cyan, {
      emissive: 0x1c7788,
      emissiveIntensity: 0.72,
      roughness: 0.24,
      metalness: 0.48,
    });
    const steelMaterial = standardMaterial(0xcbd8df, {
      roughness: 0.2,
      metalness: 0.9,
    });

    const grip = mesh(
      trackGeometry(new THREE.CapsuleGeometry(0.105, 0.24, 10, 24)),
      gripMaterial,
      [0, 0, 0],
      [1, 1, 1],
      [Math.PI / 2, 0, 0],
    );
    const accent = mesh(
      trackGeometry(new THREE.BoxGeometry(0.035, 0.15, 0.045)),
      accentMaterial,
      [0.087, 0, 0.035],
      [1, 1, 1],
      [0, 0, 0],
    );
    const shaft = mesh(
      trackGeometry(new THREE.CylinderGeometry(0.027, 0.027, 0.38, 20)),
      steelMaterial,
      [0, 0, 0.3],
      [1, 1, 1],
      [Math.PI / 2, 0, 0],
    );
    const tip = mesh(
      trackGeometry(new THREE.ConeGeometry(0.052, 0.11, 20)),
      steelMaterial,
      [0, 0, 0.535],
      [1, 1, 1],
      [Math.PI / 2, 0, 0],
    );
    tool.add(grip, accent, shaft, tip);
    world.add(tool);
    animation.screwdriver = tool;
  }

  function rebuildEnvironmentLighting(hdrTexture) {
    environmentRenderTarget?.dispose();
    const pmrem = new THREE.PMREMGenerator(renderer);
    try {
      pmrem.compileEquirectangularShader();
      environmentRenderTarget = pmrem.fromEquirectangular(hdrTexture);
      scene.environment = environmentRenderTarget.texture;
    } finally {
      pmrem.dispose();
    }
  }

  function prepareEnvironment(hdrTexture) {
    environmentSourceTexture = hdrTexture;
    textures.add(hdrTexture);
    rebuildEnvironmentLighting(hdrTexture);

    const contextGeometry = trackGeometry(new THREE.SphereGeometry(32, 20, 12));
    const contextMaterial = trackMaterial(new THREE.MeshBasicMaterial({
      map: hdrTexture,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
      toneMapped: true,
    }));
    contextMaterial.userData.baseOpacity = 0.035;
    environmentContext = new THREE.Mesh(contextGeometry, contextMaterial);
    environmentContext.name = "subtle-workshop-context";
    environmentContext.position.set(0, 10, 16.4);
    environmentContext.renderOrder = -10;
    environmentContext.visible = !mobile;
    scene.add(environmentContext);
  }

  function finishAssetLoading(controller) {
    if (assetAbortController !== controller) return;
    if (externalAbortListener) options.signal?.removeEventListener("abort", externalAbortListener);
    externalAbortListener = null;
    assetAbortController = null;
  }

  async function loadOptionalEnvironment(environmentResult, controller) {
    try {
      const { buffer, error } = await environmentResult;
      if (disposed || controller.signal.aborted) return;
      if (error) {
        dispatch("avatarworldassetwarning", { asset: "environment", error });
        return;
      }

      let hdrTexture = null;
      try {
        hdrTexture = createHdrTexture(buffer);
        prepareEnvironment(hdrTexture);
      } catch (error) {
        if (scene) scene.environment = null;
        environmentRenderTarget?.dispose();
        environmentRenderTarget = null;
        if (hdrTexture) {
          textures.delete(hdrTexture);
          hdrTexture.dispose();
        }
        environmentSourceTexture = null;
        dispatch("avatarworldassetwarning", { asset: "environment", error });
      }
    } finally {
      finishAssetLoading(controller);
    }
  }

  async function loadImportedWorldAssets() {
    const controller = new AbortController();
    assetAbortController = controller;
    externalAbortListener = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) externalAbortListener();
    else options.signal?.addEventListener("abort", externalAbortListener, { once: true });

    const optionalEnvironment = fetchArrayBuffer(WORKSHOP_HDR_URL)
      .then((buffer) => ({ buffer, error: null }))
      .catch((error) => ({ buffer: null, error }));
    const modelBuffer = await fetchArrayBuffer(ROBOT_MODEL_URL);
    throwIfAssetLoadAborted();

    const gltf = await new GLTFLoader().parseAsync(modelBuffer, new URL(".", ROBOT_MODEL_URL).href);
    throwIfAssetLoadAborted();
    const clipsByName = validateRobot(gltf);
    prepareRobot(gltf, clipsByName);
    void loadOptionalEnvironment(optionalEnvironment, controller);
  }

  function buildIntroProps() {
    const group = makeChapterGroup(0);
    const platformGeometry = trackGeometry(new THREE.CylinderGeometry(1, 1, 0.04, mobile ? 20 : 32));
    const ringGeometry = trackGeometry(new THREE.TorusGeometry(0.78, 0.025, 6, mobile ? 24 : 36));
    const boxGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const lensGeometry = trackGeometry(new THREE.SphereGeometry(0.5, 8, 6));
    const platformMaterial = chapterMaterial(group, "standard", 0x172027, {
      roughness: 0.68,
      metalness: 0.32,
    });
    const ringMaterial = chapterMaterial(group, "standard", COLORS.cyan, {
      emissive: COLORS.cyan,
      emissiveIntensity: 0.34,
      roughness: 0.35,
      metalness: 0.28,
    });
    const mastMaterial = chapterMaterial(group, "standard", 0x263139, {
      roughness: 0.58,
      metalness: 0.46,
    });
    const lensMaterial = chapterMaterial(group, "standard", 0xb9854b, {
      emissive: 0x6c3d20,
      emissiveIntensity: 0.22,
      roughness: 0.4,
      metalness: 0.52,
    });
    const platform = mesh(platformGeometry, platformMaterial, [0, 0.02, 0.14], [1.2, 1, 1.2]);
    const ring = mesh(ringGeometry, ringMaterial, [0, 0.046, 0.14], [1, 1, 1], [Math.PI / 2, 0, 0]);
    const mast = mesh(boxGeometry, mastMaterial, [1.26, 0.36, 0.18], [0.1, 0.7, 0.12]);
    const mastLens = mesh(lensGeometry, lensMaterial, [1.26, 0.72, 0.24], [0.08, 0.08, 0.05]);
    group.add(platform, ring, mast, mastLens);
    animation.intro = group;
  }

  function buildPocketPilotProps() {
    const group = makeChapterGroup(1);
    const bodyGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const bodyMaterial = chapterMaterial(group, "standard", COLORS.charcoal, {
      roughness: 0.45,
      metalness: 0.18,
    });
    const screenMaterial = chapterMaterial(group, "basic", COLORS.cyan, { opacity: 0.94 });
    const brassMaterial = chapterMaterial(group, "standard", 0xb9854b, {
      roughness: 0.43,
      metalness: 0.55,
    });
    loadColorTexture(POCKETPILOT_TEXTURE_URLS[0], screenMaterial);

    const phone = new THREE.Group();
    phone.position.set(-0.72, 1.62, 0.5);
    phone.rotation.set(-0.08, 0.18, -0.055);
    const body = mesh(bodyGeometry, bodyMaterial, [0, 0, 0], [0.42, 0.82, 0.085]);
    const screen = mesh(bodyGeometry, screenMaterial, [0, 0, 0.057], [0.35, 0.7, 0.024]);
    const sensorNotch = mesh(bodyGeometry, bodyMaterial, [0, 0.345, 0.076], [0.11, 0.02, 0.012]);
    const cradle = mesh(bodyGeometry, brassMaterial, [0, -0.47, -0.03], [0.54, 0.075, 0.24]);
    phone.add(body, screen, sensorNotch, cradle);
    phone.userData.baseY = phone.position.y;
    phone.userData.baseRotationY = phone.rotation.y;
    phone.visible = !mobile;
    group.add(phone);
    animation.phones = [phone];
  }

  function buildWargProps() {
    const group = makeChapterGroup(2);
    const drone = new THREE.Group();
    drone.position.set(-0.46, 1.72, 0.32);
    drone.scale.setScalar(0.78);
    drone.userData.baseY = drone.position.y;

    const bodyGeometry = trackGeometry(new THREE.OctahedronGeometry(0.42, 0));
    const armGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const rotorGeometry = trackGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, mobile ? 8 : 12));
    const propGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const bodyMaterial = chapterMaterial(group, "standard", COLORS.navyLight, {
      roughness: 0.42,
      metalness: 0.22,
    });
    const accentMaterial = chapterMaterial(group, "standard", 0xb9854b, {
      emissive: 0x5b351c,
      emissiveIntensity: 0.08,
      roughness: 0.43,
      metalness: 0.55,
    });
    const ringMaterial = chapterMaterial(group, "line", COLORS.cyan, { opacity: 0.7 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.scale.set(1.3, 0.48, 0.95);
    const controller = mesh(armGeometry, bodyMaterial, [0, 0.18, 0], [0.5, 0.2, 0.38]);
    const statusLens = mesh(armGeometry, accentMaterial, [0, 0.2, 0.205], [0.13, 0.04, 0.025]);
    drone.add(body, controller, statusLens);

    const arms = new THREE.InstancedMesh(armGeometry, bodyMaterial, 4);
    const rotors = new THREE.InstancedMesh(rotorGeometry, accentMaterial, 4);
    const propellers = new THREE.InstancedMesh(propGeometry, bodyMaterial, 8);
    const rotorPositions = [
      [-0.77, 0, -0.64], [0.77, 0, -0.64], [-0.77, 0, 0.64], [0.77, 0, 0.64],
    ];
    rotorPositions.forEach((position, index) => {
      dummy.position.set(position[0] * 0.52, 0, position[2] * 0.52);
      dummy.rotation.set(0, position[0] * position[2] > 0 ? -0.72 : 0.72, 0);
      dummy.scale.set(0.94, 0.08, 0.08);
      dummy.updateMatrix();
      arms.setMatrixAt(index, dummy.matrix);

      dummy.position.set(position[0], 0.06, position[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.34, 0.14, 0.34);
      dummy.updateMatrix();
      rotors.setMatrixAt(index, dummy.matrix);

      for (let blade = 0; blade < 2; blade += 1) {
        dummy.position.set(position[0], 0.17, position[2]);
        dummy.rotation.set(0, blade * Math.PI / 2 + (index % 2) * 0.18, 0);
        dummy.scale.set(0.58, 0.025, 0.055);
        dummy.updateMatrix();
        propellers.setMatrixAt(index * 2 + blade, dummy.matrix);
      }
    });
    arms.instanceMatrix.needsUpdate = true;
    rotors.instanceMatrix.needsUpdate = true;
    propellers.instanceMatrix.needsUpdate = true;
    arms.computeBoundingSphere();
    rotors.computeBoundingSphere();
    propellers.computeBoundingSphere();
    drone.add(arms, rotors, propellers);

    const rings = [
      ...makeCircleSegments(1.4, mobile ? 18 : 26, "xy"),
      ...makeCircleSegments(1.16, mobile ? 18 : 26, "yz"),
    ];
    const ringLines = new THREE.LineSegments(trackGeometry(makeLineGeometry(rings)), ringMaterial);
    drone.add(ringLines);
    group.add(drone);
    animation.drone = drone;
    animation.droneRings = ringLines;
    animation.dronePropellers = propellers;
    animation.droneRotorPositions = rotorPositions;
  }

  function buildEmbeddedProps() {
    const group = makeChapterGroup(3);
    const boxGeometry = trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const cylinderGeometry = trackGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 28));
    const torusGeometry = trackGeometry(new THREE.TorusGeometry(0.52, 0.045, 10, 28));
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
    const screwMaterial = chapterMaterial(group, "standard", 0xcbd7dc, {
      roughness: 0.18,
      metalness: 0.92,
    });
    const slotMaterial = chapterMaterial(group, "standard", 0x17222b, {
      roughness: 0.34,
      metalness: 0.72,
    });

    const board = mesh(boxGeometry, boardMaterial, [0, 0.52, 0.12], [2.05, 0.1, 1.28], [0, 0.06, 0]);
    group.add(board);
    const components = new THREE.InstancedMesh(boxGeometry, componentMaterial, 9);
    for (let index = 0; index < 9; index += 1) {
      dummy.position.set(-0.72 + (index % 3) * 0.72, 0.68, -0.3 + Math.floor(index / 3) * 0.36);
      dummy.rotation.set(0, (index % 2) * 0.3, 0);
      dummy.scale.set(0.18 + (index % 2) * 0.08, 0.16 + (index % 3) * 0.035, 0.15);
      dummy.updateMatrix();
      components.setMatrixAt(index, dummy.matrix);
    }
    components.instanceMatrix.needsUpdate = true;
    components.computeBoundingSphere();
    group.add(components);

    const motorAssembly = new THREE.Group();
    motorAssembly.position.set(0.86, 1.04, 0.2);
    const motor = mesh(cylinderGeometry, motorMaterial, [0, 0, 0], [0.62, 0.54, 0.62], [Math.PI / 2, 0, 0]);
    const motorRing = mesh(torusGeometry, ringMaterial, [0, 0, 0.34], [0.88, 0.88, 0.88]);
    const fastener = mesh(
      trackGeometry(new THREE.CylinderGeometry(0.14, 0.14, 0.075, 28)),
      screwMaterial,
      [0, 0, 0.39],
      [1, 1, 1],
      [Math.PI / 2, 0, 0],
    );
    const slotHorizontal = mesh(boxGeometry, slotMaterial, [0, 0, 0.432], [0.17, 0.038, 0.018]);
    const slotVertical = mesh(boxGeometry, slotMaterial, [0, 0, 0.433], [0.038, 0.17, 0.018]);
    const fastenerSlots = new THREE.Group();
    fastenerSlots.add(slotHorizontal, slotVertical);
    motorAssembly.add(motor, motorRing, fastener, fastenerSlots);
    group.add(motorAssembly);
    animation.motorAssembly = motorAssembly;
    animation.motorBasePosition = motorAssembly.position.clone();
    animation.motor = motor;
    animation.motorRing = motorRing;
    animation.motorFastener = fastener;
    animation.motorFastenerSlots = fastenerSlots;
    animation.motorContact = new THREE.Vector3(0.86, 1.04, 0.64);
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
      [-1.02, 1.04, -0.42], [-0.5, 1.88, 0.05], [0.16, 1.18, 0.54],
      [-0.88, 2.5, 0.72], [0.34, 2.42, -0.28], [0.96, 1.7, 0.35],
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
      rippleSegments.push(...makeCircleSegments(radius, mobile ? 22 : 34, "xz", [0, 0.04, 0.08]));
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
    const boat = mesh(hullGeometry, hullMaterial, [-0.82, 0.28, 0.08], [0.6, 0.9, 0.3], [0, 0, Math.PI / 2]);
    const marker = mesh(markerGeometry, markerMaterial, [-0.82, 0.78, 0.08], [0.9, 0.9, 0.9]);
    group.add(boat, marker);
    animation.ripples = ripples;
    animation.boat = boat;
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

    const hemisphere = new THREE.HemisphereLight(0xe8fbff, 0x08111d, mobile ? 1.82 : 2.08);
    const key = new THREE.DirectionalLight(0xf4fbff, mobile ? 2.65 : 3.1);
    key.position.set(3.5, 7.5, 5.5);
    const rim = new THREE.PointLight(COLORS.cyan, mobile ? 6 : 9, 12, 2);
    rim.position.set(-3.4, 3.8, 3.2);
    const avatarFill = new THREE.PointLight(0xe7faff, mobile ? 4.5 : 6.5, 8, 2);
    avatarFill.position.set(2.2, 3.4, 2.8);
    animation.avatarFill = avatarFill;
    scene.add(hemisphere, key, rim, avatarFill);

    buildRoute();
    buildIntroProps();
    buildPocketPilotProps();
    buildWargProps();
    buildEmbeddedProps();
    buildAiProps();
    buildWaterProps();
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
      if (environmentSourceTexture) rebuildEnvironmentLighting(environmentSourceTexture);
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

  async function initialize() {
    if (initialized && !contextLost) return true;
    if (disposed || !canvas || typeof canvas.getContext !== "function") {
      initializationError = new TypeError("A usable canvas is required for the avatar world.");
      return false;
    }

    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.24;
      renderer.shadowMap.enabled = false;
      renderer.sortObjects = true;

      buildScene();
      canvas.addEventListener("webglcontextlost", handleContextLost, false);
      canvas.addEventListener("webglcontextrestored", handleContextRestored, false);
      await loadImportedWorldAssets();
      throwIfAssetLoadAborted();
      if (contextLost) throw new Error("WebGL context was lost during avatar startup.");
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
      const start = group.userData.start;
      const end = group.userData.end;
      const span = Math.max(end - start, 0.00001);
      const influenceIn = index === 0
        ? 1
        : smoothstep(start - 0.02, start + span * 0.16, progress);
      const influenceOut = index === chapterGroups.length - 1
        ? 1
        : 1 - smoothstep(end - span * 0.16, end + 0.02, progress);
      const influence = influenceIn * influenceOut;
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
    if (animation.dronePropellers && animation.droneRotorPositions) {
      animation.droneRotorPositions.forEach((position, rotorIndex) => {
        for (let blade = 0; blade < 2; blade += 1) {
          dummy.position.set(position[0], 0.17, position[2]);
          dummy.rotation.set(0, timestamp * 0.006 + blade * Math.PI / 2 + rotorIndex * 0.18, 0);
          dummy.scale.set(0.58, 0.025, 0.055);
          dummy.updateMatrix();
          animation.dronePropellers.setMatrixAt(rotorIndex * 2 + blade, dummy.matrix);
        }
      });
      animation.dronePropellers.instanceMatrix.needsUpdate = true;
    }
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
    if (animation.contactLights?.material) {
      const base = animation.contactLights.material.userData.baseOpacity;
      animation.contactLights.material.opacity = base * (0.84 + Math.sin(timestamp * 0.004) * 0.16);
    }
  }

  function chapterLocalProgress(progress, chapterIndex) {
    const start = AVATAR_TIMELINE_RANGES[chapterIndex];
    const end = AVATAR_TIMELINE_RANGES[chapterIndex + 1];
    return clamp((progress - start) / Math.max(end - start, 0.00001));
  }

  function chapterGesture(progress, chapterIndex, center = 0.5, radius = 0.42) {
    if (progress < AVATAR_TIMELINE_RANGES[chapterIndex]
      || progress > AVATAR_TIMELINE_RANGES[chapterIndex + 1]) return 0;
    return pulse(chapterLocalProgress(progress, chapterIndex), center, radius);
  }

  function setAvatarAction(name, weight) {
    const action = avatarActions?.[name];
    const clip = avatarClips?.[name];
    if (!action || !clip) return;
    action.enabled = true;
    action.setEffectiveWeight(clamp(weight));
    action.time = Math.max(0, clip.duration - 0.00001);
  }

  function updateAvatar(state) {
    if (!avatar || !avatarMixer || !avatarActions) return;
    const { progress, timestamp } = state;

    const elapsed = lastAvatarTimestamp > 0
      ? clamp((timestamp - lastAvatarTimestamp) / 1000, 0, 0.08)
      : 0;
    const progressDelta = progress - lastAvatarProgress;
    if (Math.abs(progressDelta) > 0.00002) movementDirection = Math.sign(progressDelta);
    const measuredVelocity = Number.isFinite(state.velocity)
      ? Math.abs(state.velocity)
      : elapsed > 0
        ? Math.abs(progressDelta) / elapsed
        : 0;
    const targetTravelEnergy = clamp(measuredVelocity * 9);
    const response = 1 - Math.exp(-elapsed * (targetTravelEnergy > travelEnergy ? 11 : 6));
    travelEnergy = mix(travelEnergy, targetTravelEnergy, response);
    lastAvatarProgress = progress;
    lastAvatarTimestamp = timestamp;

    const introWave = chapterGesture(progress, 0, 0.38, 0.34);
    const pocketPoint = chapterGesture(progress, 1, 0.5, 0.43);
    const flightSurprise = chapterGesture(progress, 2, 0.48, 0.4) * 0.74;
    const embeddedLocal = state.chapterIndex === 3
      ? state.chapterProgress
      : chapterLocalProgress(progress, 3);
    const screwReach = state.chapterIndex === 3
      ? smoothstep(0.08, 0.34, embeddedLocal) * (1 - smoothstep(0.84, 0.98, embeddedLocal))
      : 0;
    const aiWelcome = chapterGesture(progress, 4, 0.5, 0.42) * 0.55;
    const profileWelcome = chapterGesture(progress, 7, 0.5, 0.43) * 0.72;
    const contactWave = chapterGesture(progress, 8, 0.58, 0.39);
    const wave = clamp(introWave + contactWave);
    const welcome = clamp(aiWelcome + profileWelcome);
    const gestureTotal = wave + pocketPoint + flightSurprise + screwReach + welcome;
    const gestureScale = gestureTotal > 1 ? 1 / gestureTotal : 1;
    const waveWeight = wave * gestureScale;
    // Zero-duration pose clips do not necessarily rewrite every bone channel.
    // Restore the imported local transforms first so head sway, antenna motion
    // and scroll gestures are deterministic instead of accumulating each frame.
    animation.avatarBoneRest?.forEach(({ bone, position, quaternion, scale }) => {
      bone.position.copy(position);
      bone.quaternion.copy(quaternion);
      bone.scale.copy(scale);
    });
    setAvatarAction("wave", waveWeight);
    setAvatarAction("presentFlipped", pocketPoint * gestureScale);
    setAvatarAction("surprise", flightSurprise * gestureScale);
    setAvatarAction("present", screwReach * gestureScale);
    setAvatarAction("welcome", welcome * gestureScale);
    setAvatarAction("sad", 0);
    avatarMixer.update(0);

    const idleSway = Math.sin(timestamp * 0.00105);
    if (avatarRig?.head) {
      additiveEuler.set(0, idleSway * 0.035, Math.sin(timestamp * 0.00072) * 0.025, "XYZ");
      avatarRig.head.quaternion.multiply(additiveQuaternion.setFromEuler(additiveEuler));
    }
    if (avatarRig?.leftAntenna && avatarRig?.rightAntenna) {
      avatarRig.leftAntenna.rotation.z += Math.sin(timestamp * 0.0018) * 0.055;
      avatarRig.rightAntenna.rotation.z -= Math.sin(timestamp * 0.0018 + 0.55) * 0.055;
    }
    const blinkCycle = (timestamp * 0.00028) % 1;
    const blink = 1 - pulse(blinkCycle, 0.965, 0.025) * 0.84;
    if (avatarRig?.leftEye && avatarRig?.rightEye) {
      const leftBase = avatarRig.leftEye.userData.baseScale;
      const rightBase = avatarRig.rightEye.userData.baseScale;
      avatarRig.leftEye.scale.set(leftBase.x * blink, leftBase.y, leftBase.z);
      avatarRig.rightEye.scale.set(rightBase.x * blink, rightBase.y, rightBase.z);
    }

    path.getPointAt(progress, pathPoint);
    path.getTangentAt(clamp(progress, 0.001, 0.999), pathTangent).normalize();
    const deterministicHover = Math.sin(progress * TAU * 8.5) * 0.035;
    const idleHover = Math.sin(timestamp * 0.00125) * 0.012;
    const platformLift = smoothstep(0.94, 0.975, progress) * 0.08;
    avatar.position.set(pathPoint.x, 0.105 + deterministicHover + idleHover + platformLift, pathPoint.z);
    // Keep the expressive visor oriented toward the viewer while the floating
    // chassis follows and banks along the route. This reads more like an
    // attentive guide than a character drifting sideways along the spline.
    avatar.rotation.y = Math.atan2(
      camera.position.x - pathPoint.x,
      camera.position.z - pathPoint.z,
    );
    avatar.rotation.z = -movementDirection * travelEnergy * 0.055;
    avatar.visible = progress < 0.9998;

    if (animation.avatarShadow) {
      animation.avatarShadow.position.x = pathPoint.x;
      animation.avatarShadow.position.z = pathPoint.z;
      const shadowScale = 0.9 - deterministicHover * 1.8;
      animation.avatarShadow.scale.set(shadowScale, shadowScale, shadowScale);
      animation.avatarShadow.material.opacity = animation.avatarShadow.material.userData.baseOpacity
        * (0.86 - Math.abs(deterministicHover) * 2.2);
      animation.avatarShadow.visible = avatar.visible;
    }
    if (animation.avatarFill) {
      animation.avatarFill.position.set(pathPoint.x + 2.1, 3.15, pathPoint.z + 2.5);
    }

    updateScrewdriverInteraction(state, screwReach);
  }

  function updateScrewdriverInteraction(state, reach) {
    const tool = animation.screwdriver;
    if (!tool || !animation.motorAssembly) return;

    const local = state.chapterIndex === 3 ? state.chapterProgress : chapterLocalProgress(state.progress, 3);
    const engaged = state.chapterIndex === 3
      ? smoothstep(0.3, 0.43, local) * (1 - smoothstep(0.76, 0.9, local))
      : 0;
    const spin = local * TAU * 7.5;
    tool.visible = reach > 0.015;

    if (tool.visible) {
      toolStart.set(avatar.position.x + 0.42, avatar.position.y + 0.9, avatar.position.z + 0.04);
      toolTarget.copy(animation.motorContact);
      chapterGroups[3].localToWorld(toolTarget);
      toolTarget.z -= 0.535;
      tool.position.lerpVectors(toolStart, toolTarget, smoothstep(0.08, 0.72, reach));
      tool.rotation.set(0, 0, spin * engaged);
      const breathe = 1 + engaged * Math.sin(spin * 2) * 0.018;
      tool.scale.setScalar(breathe);
    }

    const base = animation.motorBasePosition;
    animation.motorAssembly.position.set(
      base.x + Math.sin(spin * 2.2) * engaged * 0.012,
      base.y + Math.cos(spin * 1.8) * engaged * 0.014,
      base.z,
    );
    animation.motorAssembly.rotation.z = Math.sin(spin * 2) * engaged * 0.02;
    if (animation.motorFastenerSlots) animation.motorFastenerSlots.rotation.z = spin * engaged;
    if (animation.motorRing) {
      const ringScale = 0.88 * (1 + engaged * (0.08 + Math.sin(spin * 2) * 0.025));
      animation.motorRing.scale.setScalar(ringScale);
    }
  }

  function updateCamera(progress) {
    (mobile ? mobileCameraOffsets : desktopCameraOffsets).getPointAt(progress, cameraOffset);
    (mobile ? mobileTargetOffsets : desktopTargetOffsets).getPointAt(progress, targetOffset);
    cameraPosition.copy(pathPoint).add(cameraOffset);
    const compactTargetOffset = compactViewport ? -0.2 : 0;
    cameraTarget.copy(pathPoint).add(targetOffset);
    cameraTarget.x += compactTargetOffset;
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraTarget);
  }

  function locateChapter(progress) {
    for (let index = 0; index < AVATAR_TIMELINE_RANGES.length - 1; index += 1) {
      if (progress < AVATAR_TIMELINE_RANGES[index + 1]
        || index === AVATAR_TIMELINE_RANGES.length - 2) {
        return {
          chapterIndex: index,
          chapterProgress: chapterLocalProgress(progress, index),
        };
      }
    }
    return { chapterIndex: AVATAR_TIMELINE_RANGES.length - 2, chapterProgress: 1 };
  }

  function normalizeUpdateInput(progressOrState, timestamp) {
    if (typeof progressOrState === "object" && progressOrState !== null) {
      const progress = progressOrState.progress ?? progressOrState.globalProgress ?? 0;
      const normalizedProgress = clamp(Number.isFinite(progress) ? progress : 0);
      const located = locateChapter(normalizedProgress);
      return {
        progress: normalizedProgress,
        chapterIndex: Number.isInteger(progressOrState.chapterIndex)
          ? progressOrState.chapterIndex
          : located.chapterIndex,
        chapterProgress: Number.isFinite(progressOrState.chapterProgress)
          ? clamp(progressOrState.chapterProgress)
          : located.chapterProgress,
        velocity: Number.isFinite(progressOrState.velocity) ? progressOrState.velocity : null,
        timestamp: Number.isFinite(progressOrState.timestamp) ? progressOrState.timestamp : timestamp,
      };
    }
    const progress = clamp(Number.isFinite(progressOrState) ? progressOrState : 0);
    const located = locateChapter(progress);
    return {
      progress,
      chapterIndex: located.chapterIndex,
      chapterProgress: located.chapterProgress,
      velocity: null,
      timestamp,
    };
  }

  function update(progressOrState, timestamp = 0) {
    if (!active || !renderer || !scene || !camera || contextLost || disposed) return;
    const state = normalizeUpdateInput(progressOrState, Number.isFinite(timestamp) ? timestamp : 0);
    currentProgress = state.progress;
    path.getPointAt(state.progress, pathPoint);
    updateCamera(state.progress);
    updateAvatar(state);
    updateChapterGroups(state.progress, state.timestamp);
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
    compactViewport = viewportWidth <= 820 && viewportHeight < 620;
    tabletViewport = !mobile && viewportWidth < 1180;
    shortViewport = !mobile && viewportHeight < 700;
    if (avatar) {
      const avatarScale = compactViewport
        ? 0.58
        : mobile
          ? 0.68
          : tabletViewport || shortViewport
            ? 0.58
            : 0.64;
      avatar.scale.setScalar(avatarScale);
      avatar.userData.baseScale = avatarScale;
    }
    if (environmentContext) environmentContext.visible = !mobile;
    if (animation.phones) {
      animation.phones.forEach((phone) => {
        phone.visible = !mobile;
      });
    }
    const deviceRatio = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const renderRatio = mobile
      ? 1.5
      : Math.min(Math.max(deviceRatio, 1.25), 1.75);
    renderer.setPixelRatio(renderRatio);
    renderer.setSize(viewportWidth, viewportHeight, false);
    camera.aspect = viewportWidth / viewportHeight;
    camera.fov = compactViewport ? 46 : mobile ? 43 : tabletViewport || shortViewport ? 38 : 35;
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
    assetAbortController?.abort();
    if (externalAbortListener) options.signal?.removeEventListener("abort", externalAbortListener);
    externalAbortListener = null;
    avatarMixer?.stopAllAction();
    if (avatarMixer) avatarMixer.uncacheRoot(avatarMixer.getRoot());
    if (canvas) {
      canvas.removeEventListener("webglcontextlost", handleContextLost, false);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored, false);
      delete canvas.dataset.avatarDrawCalls;
      delete canvas.dataset.avatarTriangles;
      delete canvas.dataset.avatarModel;
    }
    if (scene) scene.environment = null;
    environmentRenderTarget?.dispose();
    environmentRenderTarget = null;
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
    avatarMixer = null;
    avatarActions = null;
    avatarClips = null;
    avatarRig = null;
    environmentContext = null;
    environmentSourceTexture = null;
    assetAbortController = null;
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

  if (!(await initialize())) {
    const error = initializationError || new Error("Unable to initialize the avatar world.");
    dispose();
    throw error;
  }

  return lifecycle;
}

export default createAvatarWorld;
