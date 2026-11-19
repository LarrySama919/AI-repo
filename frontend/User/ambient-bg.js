/* Ambient three.js backdrop with low-poly brand-colour blobs and spring-smoothed pointer parallax. */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const canvas = document.createElement("canvas");
canvas.id = "ambient-bg";
canvas.setAttribute("aria-hidden", "true");
document.body.prepend(canvas);

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
} catch {
  renderer = null;
}
if (!renderer) {
  canvas.remove();
} else {
  start();
}

function start() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 16;

  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const key = new THREE.DirectionalLight(0xfff4e0, 1.2);
  key.position.set(4, 6, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcc795f, 0.55);
  rim.position.set(-6, -4, 4);
  scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  const palette = [0xd8e0d1, 0x324f43, 0xcc795f, 0xe7ead9, 0x4a6f5c, 0xf4e9d7];
  const blobs = palette.map((color, i) => {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.4 + (i % 3) * 0.8, 1),
      new THREE.MeshStandardMaterial({
        color,
        flatShading: true,
        transparent: true,
        opacity: 0.14 + (i % 2) * 0.07,
        roughness: 0.9,
      })
    );
    const angle = (i / palette.length) * Math.PI * 2;
    mesh.position.set(Math.cos(angle) * 8, Math.sin(angle) * 4, -3 - (i % 3) * 1.5);
    mesh.userData = { speed: 0.22 + i * 0.06, phase: i * 1.7, spin: 0.1 + (i % 3) * 0.05, baseY: mesh.position.y };
    group.add(mesh);
    return mesh;
  });

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", () => { resize(); if (reduceMotion) renderer.render(scene, camera); });

  const pointerTarget = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0, vx: 0, vy: 0 };
  window.addEventListener("pointermove", (e) => {
    pointerTarget.x = (e.clientX / window.innerWidth - 0.5) * 2;
    pointerTarget.y = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  const clock = new THREE.Clock();
  function frame() {
    const delta = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (!reduceMotion) {
      pointer.vx += (42 * (pointerTarget.x - pointer.x) - 15 * pointer.vx) * delta;
      pointer.vy += (42 * (pointerTarget.y - pointer.y) - 15 * pointer.vy) * delta;
      pointer.x += pointer.vx * delta;
      pointer.y += pointer.vy * delta;
    }
    blobs.forEach((mesh) => {
      const { speed, phase, spin, baseY } = mesh.userData;
      mesh.position.y = baseY + Math.sin(t * speed + phase) * 0.7;
      mesh.rotation.x += spin * 0.004;
      mesh.rotation.y += spin * 0.006;
    });
    group.rotation.y = pointer.x * 0.16;
    group.rotation.x = pointer.y * 0.12;
    renderer.render(scene, camera);
    if (!reduceMotion && !document.hidden) requestAnimationFrame(frame);
  }
  frame();
}
