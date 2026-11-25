import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";

const heroArt = document.querySelector(".hero-art");
const stage = document.querySelector("#scan-stage");

if (heroArt && stage) {
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const state = {
    paused: false,
    wire: false,
    visible: true,
    pointerY: 0,
    targetRotY: 0,
    targetRotX: 0,
    rotY: 0,
    rotX: 0,
    lastPointer: 0,
    time: 0,
  };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (error) {
    heroArt.classList.add("no-3d");
  }

  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.id = "scan-canvas";
    // three.js sets an inline display:block on created canvases, which would override the body-mode rule
    canvas.style.display = "";
    const oldCanvas = document.querySelector("#scan-canvas");
    if (oldCanvas) oldCanvas.replaceWith(canvas);
    else stage.prepend(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
    const rig = new THREE.Group();
    scene.add(rig);

    scene.add(new THREE.HemisphereLight("#ffffff", "#83937b", 0.95));

    const key = new THREE.DirectionalLight("#ffffff", 2.25);
    key.position.set(-2.4, 3.2, 3.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -2.6;
    key.shadow.camera.right = 2.6;
    key.shadow.camera.top = 2.6;
    key.shadow.camera.bottom = -2.6;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 12;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    const rim = new THREE.DirectionalLight("#e2f2d8", 1.9);
    rim.position.set(3.4, 1.4, -2.2);
    scene.add(rim);

    const fill = new THREE.DirectionalLight("#ffffff", 0.45);
    fill.position.set(0.4, -1.4, 3);
    scene.add(fill);

    const scanUniforms = {
      uScanY: { value: 0 },
      uScanWidth: { value: 0.024 },
      uScanGlow: { value: 0 },
    };

    const skinMaterial = new THREE.MeshPhysicalMaterial({
      color: "#dbe3cf",
      roughness: 0.52,
      metalness: 0,
      clearcoat: 0.22,
      clearcoatRoughness: 0.55,
      transparent: true,
      opacity: 1,
    });

    skinMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uScanY = scanUniforms.uScanY;
      shader.uniforms.uScanWidth = scanUniforms.uScanWidth;
      shader.uniforms.uScanGlow = scanUniforms.uScanGlow;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vScanWorldPos;")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvScanWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;"
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vScanWorldPos;\nuniform float uScanY;\nuniform float uScanWidth;\nuniform float uScanGlow;"
        )
        .replace(
          "vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;",
          `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
           float scanDist = vScanWorldPos.y - uScanY;
           float scanHalo = exp(-pow(scanDist / (uScanWidth * 2.2), 2.0));
           float scanCore = exp(-pow(scanDist / uScanWidth, 2.0));
           outgoingLight += vec3(0.62, 0.95, 0.5) * scanHalo * 0.34 * uScanGlow;
           outgoingLight += vec3(0.94, 1.0, 0.88) * scanCore * 3.1 * uScanGlow;`
        );
      skinMaterial.userData.shader = shader;
    };

    const wireMaterial = new THREE.LineBasicMaterial({
      color: "#5f7a60",
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    const beamMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uStrength: { value: 0.1 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uStrength;
        void main() {
          float line = exp(-pow((vUv.y - 0.5) * 8.0, 2.0));
          float ends = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
          float alpha = line * ends * uStrength;
          gl_FragColor = vec4(vec3(0.9, 1.0, 0.84) * alpha, alpha);
        }`,
    });
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.36), beamMaterial);
    beam.visible = false;
    scene.add(beam);

    let modelWidth = 2.5;
    let scanMin = -0.3;
    let scanMax = 1.05;
    let ready = false;

    function layout() {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (!width || !height) return false;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const targetWidth = modelWidth * 1.07;
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      camera.position.set(0, 0.02, targetWidth / (2 * Math.tan(halfFov) * camera.aspect));
      camera.lookAt(0, 0.02, 0);
      camera.updateProjectionMatrix();
      return true;
    }

    const loader = new GLTFLoader();
    let root = null;

    function smoothstep(edge0, edge1, x) {
      const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
      return t * t * (3 - 2 * t);
    }

    function updateIntro(elapsed) {
      if (motionQuery.matches) {
        skinMaterial.opacity = 1;
        wireMaterial.opacity = 0;
        scanUniforms.uScanGlow.value = 1;
        return;
      }
      const reveal = smoothstep(0.6, 1.9, elapsed);
      skinMaterial.opacity = THREE.MathUtils.lerp(0.04, state.wire ? 0.16 : 1, reveal);
      wireMaterial.opacity = THREE.MathUtils.lerp(0.55, state.wire ? 0.6 : 0, reveal);
      scanUniforms.uScanGlow.value = smoothstep(1.1, 2.1, elapsed);
    }

    function setScanPosition(phase) {
      const y = scanMin + (scanMax - scanMin) * phase;
      scanUniforms.uScanY.value = y;
      beam.position.set(0, y, 0.82);
      beam.quaternion.copy(camera.quaternion);
    }

    loader.load(
      "./assets/face-scan.glb?v=3d2",
      (gltf) => {
        root = gltf.scene;
        const meshes = [];
        root.traverse((child) => {
          if (child.isMesh) meshes.push(child);
        });
        if (!meshes.length) throw new Error("No mesh found in face-scan.glb");

        const bounds = new THREE.Box3().setFromObject(root);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const scale = 2.36 / size.y;
        root.scale.setScalar(scale);
        root.position.sub(center.multiplyScalar(scale));
        root.position.y -= 0.22;

        meshes.forEach((mesh) => {
          mesh.material = skinMaterial;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const wire = new THREE.LineSegments(new THREE.WireframeGeometry(mesh.geometry), wireMaterial);
          wire.renderOrder = 2;
          mesh.add(wire);
        });

        rig.add(root);

        const fitted = new THREE.Box3().setFromObject(root);
        modelWidth = fitted.max.x - fitted.min.x;
        const modelHeight = fitted.max.y - fitted.min.y;
        scanMin = fitted.min.y + modelHeight * 0.36;
        scanMax = fitted.max.y - modelHeight * 0.045;
        setScanPosition(0.35);

        layout();
        ready = true;
        heroArt.classList.add("has-3d");
        beam.visible = !motionQuery.matches;
      },
      undefined,
      (error) => {
        console.warn("3D face scan unavailable, using illustration fallback.", error);
        heroArt.classList.add("no-3d");
      }
    );

    layout();
    new ResizeObserver(() => layout()).observe(stage);

    heroArt.addEventListener("pointermove", (event) => {
      const rect = heroArt.getBoundingClientRect();
      const nx = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      const ny = THREE.MathUtils.clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
      state.targetRotY = nx * 0.3;
      state.targetRotX = ny * 0.1;
      state.lastPointer = performance.now();
    });

    heroArt.addEventListener("pointerleave", () => {
      state.targetRotY = 0;
      state.targetRotX = 0;
      state.lastPointer = 0;
    });

    const wireButton = document.querySelector("#scan-wireframe");
    const pauseButton = document.querySelector("#scan-pause");

    wireButton?.addEventListener("click", () => {
      state.wire = !state.wire;
      wireButton.setAttribute("aria-pressed", String(state.wire));
      wireButton.setAttribute("aria-label", state.wire ? "Show solid view" : "Toggle mesh view");
    });

    pauseButton?.addEventListener("click", () => {
      state.paused = !state.paused;
      pauseButton.setAttribute("aria-pressed", String(state.paused));
      pauseButton.setAttribute("aria-label", state.paused ? "Resume scan animation" : "Pause scan animation");
    });

    new IntersectionObserver(
      (entries) => {
        state.visible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 }
    ).observe(heroArt);

    const clock = new THREE.Clock();
    let elapsed = 0;

    function frame() {
      requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      elapsed += dt;

      if (!ready || !state.visible || document.hidden) return;
      if (heroArt.dataset.mode === "body") return;
      if (!stage.clientWidth) return;

      const reduced = motionQuery.matches;
      const active = !state.paused;
      if (active && !reduced) state.time += dt;

      const idle = performance.now() - state.lastPointer > 2600;
      if (idle && active && !reduced) {
        state.targetRotY = Math.sin(state.time * 0.42) * 0.055;
        state.targetRotX = Math.sin(state.time * 0.3) * 0.02;
      }
      state.rotY += (state.targetRotY - state.rotY) * Math.min(1, dt * 5);
      state.rotX += (state.targetRotX - state.rotX) * Math.min(1, dt * 5);
      rig.rotation.y = state.rotY;
      rig.rotation.x = state.rotX;

      updateIntro(elapsed);

      const phase = reduced ? 0.62 : 0.5 - 0.5 * Math.cos((state.time * Math.PI * 2) / 8.5);
      setScanPosition(phase);
      beam.visible = !reduced;
      beamMaterial.uniforms.uStrength.value = 0.1;

      renderer.render(scene, camera);
    }

    frame();
  }
}
