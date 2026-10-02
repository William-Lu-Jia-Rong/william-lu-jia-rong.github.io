import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "./vendor/addons/loaders/HDRLoader.js";
import { mergeGeometries } from "./vendor/addons/utils/BufferGeometryUtils.js";
import { ASSETS } from "./workshop-shots.js";
import { seekWorkshop } from "./workshop-animation.js";

export async function createWorkshopWorld(
  canvas,
  { signal, onFailure, onInvalidate, poster = false } = {},
) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e9edeb");
  scene.fog = new THREE.Fog("#e9edeb", 18, 48);
  const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 90);
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  let disposed = false;
  let mobile = false;
  let width = 1;
  let height = 1;
  let progress = 0;
  let environment = null;
  let screenPromise = null;
  let phoneScreens = [];
  let quality = 1;
  const keep = (object) => {
    object.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
      for (const material of node.material ? [].concat(node.material) : [])
        materials.add(material);
    });
    return object;
  };
  const contextLost = (event) => {
    event.preventDefault();
    onFailure?.(new Error("WebGL context lost"));
  };
  canvas.addEventListener("webglcontextlost", contextLost);
  function dispose() {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener("webglcontextlost", contextLost);
    geometries.forEach((resource) => resource.dispose());
    materials.forEach((resource) => resource.dispose());
    textures.forEach((resource) => resource.dispose());
    environment?.dispose();
    renderer.dispose();
  }
  signal?.addEventListener("abort", dispose, { once: true });

  try {
    const response = await fetch(ASSETS.model, { signal });
    if (!response.ok) throw new Error(`Workshop asset: ${response.status}`);
    const gltf = await new GLTFLoader().parseAsync(
      await response.arrayBuffer(),
      "",
    );
    keep(gltf.scene);
    if (disposed) {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      throw new Error("Aborted");
    }
    const rig = gltf.scene;
    scene.add(rig);
    // Fine-scale finish varies reflected light without adding texture downloads.
    const grain = new Uint8Array(128 * 128 * 4);
    let seed = 731;
    for (let i = 0; i < grain.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const value = 208 + (seed >>> 27);
      grain.set([value, value, value, 255], i);
    }
    const finishTexture = new THREE.DataTexture(grain, 128, 128);
    finishTexture.wrapS = finishTexture.wrapT = THREE.RepeatWrapping;
    finishTexture.magFilter = THREE.LinearFilter;
    finishTexture.minFilter = THREE.LinearMipmapLinearFilter;
    finishTexture.generateMipmaps = true;
    finishTexture.repeat.set(8, 8);
    finishTexture.needsUpdate = true;
    textures.add(finishTexture);
    for (const material of materials) {
      if (/Ceramic|aluminium|Graphite|Worktop/.test(material.name)) {
        material.roughnessMap = finishTexture;
        material.needsUpdate = true;
      }
    }
    const desktopCamera = rig.getObjectByName("CameraDesktop");
    const mobileCamera = rig.getObjectByName("CameraMobile");
    if (!desktopCamera || !mobileCamera || !gltf.animations.length)
      throw new Error("Workshop camera or animation missing");
    const mixer = new THREE.AnimationMixer(rig);
    const actions = [];
    for (const clip of gltf.animations) {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      actions.push(action);
    }
    const fastener = rig.getObjectByName("Fastener");
    const bit = rig.getObjectByName("Driver_bit");
    const head = rig.getObjectByName("HeadJoint");
    const aircraft = rig.getObjectByName("Drone");
    const screenNodes = ["PhoneScreen", "RouteScreen"].map((name) =>
      rig.getObjectByName(name),
    );

    // Batch static geometry within each animated transform, preserving the rig.
    const animated = new Set();
    for (const clip of gltf.animations)
      for (const track of clip.tracks) {
        const node = rig.getObjectByName(track.name.split(".")[0]);
        if (node) animated.add(node);
      }
    const rotors = [...animated].filter((node) =>
      node.name.startsWith("Rotor"),
    );
    rig.updateMatrixWorld(true);
    const batches = new Map();
    rig.traverse((node) => {
      if (
        !node.isMesh ||
        animated.has(node) ||
        screenNodes.includes(node) ||
        node === bit ||
        node === fastener
      )
        return;
      let owner = node.parent;
      while (owner !== rig && !animated.has(owner)) owner = owner.parent;
      const map = batches.get(owner) || new Map();
      const list = map.get(node.material) || [];
      list.push(node);
      map.set(node.material, list);
      batches.set(owner, map);
    });
    for (const [owner, map] of batches)
      for (const [material, meshes] of map) {
        const inverse = new THREE.Matrix4().copy(owner.matrixWorld).invert();
        const clones = meshes.map((mesh) =>
          mesh.geometry
            .clone()
            .applyMatrix4(
              new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld),
            ),
        );
        const geometry = mergeGeometries(clones);
        clones.forEach((g) => g.dispose());
        if (!geometry) continue;
        const batch = new THREE.Mesh(geometry, material);
        batch.castShadow = true;
        batch.receiveShadow = true;
        owner.add(batch);
        geometries.add(geometry);
        meshes.forEach((mesh) => mesh.removeFromParent());
      }
    rig.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });

    const floor = keep(
      new THREE.Mesh(
        new THREE.PlaneGeometry(150, 150),
        new THREE.MeshStandardMaterial({
          color: "#dce3de",
          roughness: 0.84,
          metalness: 0.05,
        }),
      ),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.008;
    floor.receiveShadow = true;
    scene.add(floor);
    scene.add(new THREE.HemisphereLight("#ffffff", "#7c9087", 1.15));
    const sun = new THREE.DirectionalLight("#fff5e6", 2.7);
    sun.position.set(0, 10, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -5,
      right: 5,
      top: 5,
      bottom: -5,
      near: 0.5,
      far: 30,
    });
    sun.shadow.radius = 4;
    sun.shadow.blurSamples = 8;
    sun.shadow.normalBias = 0.012;
    sun.shadow.bias = -0.0001;
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight("#b9d7ef", 1.0);
    fill.position.set(-5, 4, -6);
    scene.add(fill);
    const rim = new THREE.DirectionalLight("#ffffff", 2.2);
    rim.position.set(3, 5, -5);
    scene.add(rim, rim.target);

    const graph = new THREE.Group();
    graph.position.set(16, 2.85, 0.4);
    graph.scale.setScalar(0.65);
    const nodeMaterial = new THREE.MeshStandardMaterial({
      color: "#147e68",
      emissive: "#147e68",
      emissiveIntensity: 0.3,
      roughness: 0.3,
    });
    const points = [
      [-1.8, 0, 0],
      [-0.8, 0.6, 0],
      [-0.8, -0.6, 0],
      [0.6, 0.75, 0],
      [0.6, -0.65, 0],
      [1.8, 0, 0],
    ].map((p) => new THREE.Vector3(...p));
    for (const point of points) {
      const node = keep(
        new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 8), nodeMaterial),
      );
      node.position.copy(point);
      graph.add(node);
    }
    const edges = [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 4],
      [3, 5],
      [4, 5],
    ];
    const vertices = edges.flatMap(([a, b]) => [
      ...points[a].toArray(),
      ...points[b].toArray(),
    ]);
    const lines = keep(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute(vertices, 3),
        ),
        new THREE.LineBasicMaterial({
          color: "#6c9988",
          transparent: true,
          opacity: 0.7,
        }),
      ),
    );
    graph.add(lines);
    scene.add(graph);
    const packet = keep(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 12, 8),
        new THREE.MeshBasicMaterial({ color: "#cc4b2f" }),
      ),
    );
    graph.add(packet);

    function screen(node, w, h) {
      const plane = keep(
        new THREE.Mesh(
          new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ color: "#d9e4df", toneMapped: false }),
        ),
      );
      plane.position.copy(node.position);
      plane.position.z += 0.013;
      node.parent.add(plane);
      return plane;
    }
    const phone = screen(screenNodes[0], 0.645, 1.3);
    const route = screen(screenNodes[1], 2.16, 1.1);
    async function texture(url) {
      const result = await new THREE.TextureLoader().loadAsync(url);
      if (disposed) {
        result.dispose();
        throw new Error("Aborted");
      }
      result.colorSpace = THREE.SRGBColorSpace;
      result.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      textures.add(result);
      return result;
    }
    function preloadScreens() {
      if (screenPromise || disposed) return screenPromise;
      screenPromise = Promise.allSettled([
        texture(ASSETS.insights),
        texture(ASSETS.scan),
        texture(ASSETS.routes),
      ]).then((results) => {
        if (disposed) return;
        phoneScreens = results
          .slice(0, 2)
          .map((r) => (r.status === "fulfilled" ? r.value : null));
        if (results[2].status === "fulfilled") {
          route.material.map = results[2].value;
          route.material.color.set("white");
          route.material.needsUpdate = true;
        }
        onInvalidate?.();
      });
      return screenPromise;
    }
    // Lighting is optional: a late HDR must never block readable content or 3D.
    fetch(ASSETS.environment, { signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("HDR unavailable");
        const parsed = new HDRLoader().parse(await response.arrayBuffer());
        if (disposed) return;
        const hdr = new THREE.DataTexture(
          parsed.data,
          parsed.width,
          parsed.height,
          THREE.RGBAFormat,
          parsed.type,
        );
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        hdr.needsUpdate = true;
        const pmrem = new THREE.PMREMGenerator(renderer);
        environment = pmrem.fromEquirectangular(hdr);
        scene.environment = environment.texture;
        scene.environmentIntensity = 0.6;
        hdr.dispose();
        pmrem.dispose();
        onInvalidate?.();
      })
      .catch(() => {});

    function resize() {
      width = canvas.clientWidth || window.innerWidth;
      height = canvas.clientHeight || window.innerHeight;
      mobile = width <= 760;
      const shadowSize = quality < 1 ? 512 : mobile ? 1024 : 2048;
      if (sun.shadow.mapSize.x !== shadowSize) {
        sun.shadow.map?.dispose();
        sun.shadow.mapPass?.dispose();
        sun.shadow.map = sun.shadow.mapPass = null;
        sun.shadow.mapSize.set(shadowSize, shadowSize);
        sun.shadow.needsUpdate = true;
      }
      sun.shadow.blurSamples = mobile || quality < 1 ? 4 : 8;
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, mobile ? 1.4 : 1.65) * quality,
      );
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = mobile ? 48 : 39;
      camera.clearViewOffset();
      if (!poster)
        camera.setViewOffset(
          width,
          height,
          mobile ? 0 : -width * 0.2,
          mobile ? -height * 0.24 : 0,
          width,
          height,
        );
      camera.updateProjectionMatrix();
    }
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    function needsIdle() {
      return progress < 0.12 || (progress > 0.375 && progress < 0.52);
    }
    function update(nextProgress, timestamp = null) {
      if (disposed) return;
      progress = seekWorkshop(mixer, actions, nextProgress);
      if (timestamp !== null && !poster) {
        const seconds = timestamp / 1000;
        if (progress < 0.12) head.rotateY(Math.sin(seconds * 0.7) * 0.018);
        if (progress > 0.375 && progress < 0.52) {
          const envelope = Math.min(
            1,
            (progress - 0.375) / 0.04,
            (0.52 - progress) / 0.04,
          );
          aircraft.position.y += Math.sin(seconds * 1.7) * 0.022 * envelope;
          aircraft.rotateZ(Math.sin(seconds * 1.1) * 0.012 * envelope);
          for (const rotor of rotors) rotor.rotateY(seconds * 43);
        }
      }
      rig.updateMatrixWorld(true);
      const source = mobile ? mobileCamera : desktopCamera;
      source.getWorldPosition(position);
      source.getWorldQuaternion(rotation);
      camera.position.copy(position);
      camera.quaternion.copy(rotation);
      const robotPosition = rig.getObjectByName("RobotRoot").position;
      sun.position.x = robotPosition.x - 3;
      sun.target.position.set(robotPosition.x, 0, 0);
      rim.position.x = robotPosition.x + 3;
      rim.target.position.set(robotPosition.x, 1, 0);
      graph.visible = progress >= 0.69 && progress <= 0.885;
      const travel = THREE.MathUtils.clamp((progress - 0.72) / 0.13, 0, 1) * 3;
      const index = Math.min(2, Math.floor(travel));
      const chain = [0, 1, 3, 5];
      packet.position.lerpVectors(
        points[chain[index]],
        points[chain[index + 1]],
        travel - index,
      );
      if (progress > 0.3) preloadScreens();
      const phoneMap =
        phoneScreens[progress < 0.6 ? 1 : 0] || phoneScreens.find(Boolean);
      if (phoneMap && phone.material.map !== phoneMap) {
        phone.material.map = phoneMap;
        phone.material.color.set("white");
        phone.material.needsUpdate = true;
      }
      renderer.render(scene, camera);
      canvas.dataset.progress = progress.toFixed(5);
      canvas.dataset.drawCalls = String(renderer.info.render.calls);
      canvas.dataset.triangles = String(renderer.info.render.triangles);
    }
    resize();
    await renderer.compileAsync(scene, camera);
    if (disposed) throw new Error("Aborted");
    update(0);
    return {
      update,
      needsIdle,
      resize,
      dispose,
      preloadScreens,
      lowerQuality() {
        if (quality > 0.65) {
          quality = 0.65;
          resize();
        }
      },
      diagnostics() {
        const tip = bit?.localToWorld(new THREE.Vector3(0, 0.0325, 0));
        const contact = fastener?.localToWorld(new THREE.Vector3(0, 0.0225, 0));
        return {
          progress,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          contactError:
            progress >= 0.205 && progress <= 0.265 && tip && contact
              ? tip.distanceTo(contact)
              : null,
          mobile,
          quality,
          shadowResolution: sun.shadow.mapSize.x,
          pixelRatio: renderer.getPixelRatio(),
          phoneTextureReady: Boolean(phone.material.map),
          routeTextureReady: Boolean(route.material.map),
        };
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
