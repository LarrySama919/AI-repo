/* Ambient three.js backdrop for the user dashboard: low-poly blobs drifting in
   brand colours, with pointer parallax smoothed by Motion (vanilla) springs. */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js";
import { motionValue, spring } from "https://cdn.jsdelivr.net/npm/motion@12/+esm";

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

  const pointerX = motionValue(0);
  const pointerY = motionValue(0);
  const springX = spring(pointerX, { stiffness: 42, damping: 15 });
  const springY = spring(pointerY, { stiffness: 42, damping: 15 });
  window.addEventListener("pointermove", (e) => {
    pointerX.set((e.clientX / window.innerWidth - 0.5) * 2);
    pointerY.set((e.clientY / window.innerHeight - 0.5) * 2);
  });

  const clock = new THREE.Clock();
  function frame() {
    const t = clock.getElapsedTime();
    blobs.forEach((mesh) => {
      const { speed, phase, spin, baseY } = mesh.userData;
      mesh.position.y = baseY + Math.sin(t * speed + phase) * 0.7;
      mesh.rotation.x += spin * 0.004;
      mesh.rotation.y += spin * 0.006;
    });
    group.rotation.y = springX.get() * 0.16;
    group.rotation.x = springY.get() * 0.12;
    renderer.render(scene, camera);
    if (!reduceMotion && !document.hidden) requestAnimationFrame(frame);
  }
  frame();
}
