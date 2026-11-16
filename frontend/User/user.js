/* Skinwise dashboard — GSAP interactions (frontend demo, no backend) */
(async () => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  const RING_LEN = 2 * Math.PI * 68; // r=68 score ring circumference

  // Respect reduced-motion users (and allow ?static for instant render)
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    new URLSearchParams(location.search).has("static")
  ) {
    gsap.globalTimeline.timeScale(60);
  }

  /* ---------------- component partials ---------------- */
  // The dashboard shell holds empty [data-include] slots; each is swapped for
  // its component file before any element lookups below run.
  async function loadComponents() {
    const slots = $$("[data-include]");
    await Promise.all(
      slots.map(async (slot) => {
        const res = await fetch(slot.dataset.include);
        if (!res.ok) throw new Error("Could not load " + slot.dataset.include);
        slot.outerHTML = await res.text();
      })
    );
  }

  try {
    await loadComponents();
  } catch (err) {
    console.error(err);
    document.body.innerHTML =
      '<p style="padding:48px;font:600 15px system-ui,sans-serif;color:#243932">Dashboard components failed to load. Serve the project over HTTP (e.g. <code>python -m http.server</code>) instead of opening the file directly.</p>';
    return;
  }

  /* ---------------- toast ---------------- */
  const toastEl = $("#toast");
  let toastTimer;
  function toast(msg) {
    $("#toast-text").textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-toast]");
    if (t) toast(t.dataset.toast);
  });

  /* ---------------- animated counters ---------------- */
  function runCounters(scope) {
    $$(".count", scope).forEach((el) => {
      const target = +el.dataset.count;
      const suffix = el.dataset.suffix || "";
      const obj = { v: 0 };
      gsap.to(obj, {
        v: target,
        duration: 1.4,
        ease: "power2.out",
        onUpdate: () => (el.textContent = Math.round(obj.v) + suffix),
      });
    });
  }

  /* ---------------- score ring ---------------- */
  function drawRing(ringEl, pct, delay = 0.2) {
    if (!ringEl) return;
    gsap.fromTo(
      ringEl,
      { strokeDashoffset: RING_LEN },
      { strokeDashoffset: RING_LEN * (1 - pct / 100), duration: 1.6, delay, ease: "power3.out" }
    );
  }

  /* ---------------- view switching ---------------- */
  let currentView = "overview";
  let viewTween = null;

  function animateViewIn(view) {
    const cards = $$("[data-anim='card']", view);
    gsap.fromTo(
      view.querySelector(".view-head"),
      { y: 30, opacity: 0, rotateX: -12, transformPerspective: 800, filter: "blur(6px)" },
      { y: 0, opacity: 1, rotateX: 0, filter: "blur(0px)", duration: 0.6, ease: "power3.out", clearProps: "transform,filter,opacity" }
    );
    if (cards.length) {
      gsap.fromTo(
        cards,
        { y: 46, opacity: 0, scale: 0.9, rotateX: -14, transformPerspective: 900, filter: "blur(8px)" },
        { y: 0, opacity: 1, scale: 1, rotateX: 0, filter: "blur(0px)", duration: 0.75, stagger: 0.075, delay: 0.08, ease: "back.out(1.4)", clearProps: "transform,filter,opacity" }
      );
    }
    if (view.id === "view-overview") {
      runCounters(view);
      drawRing($(".card-score .ring-fg", view), 82, 0.35);
      gsap.to($(".trend-line", view), { strokeDashoffset: 0, duration: 1.8, delay: 0.4, ease: "power2.inOut" });
      gsap.to($(".trend-area", view), { opacity: 1, duration: 0.9, delay: 1.2 });
      gsap.fromTo(
        $$(".trend-dots circle", view),
        { opacity: 0, scale: 0 },
        { opacity: 1, scale: 1, duration: 0.4, stagger: 0.12, delay: 0.7, ease: "back.out(2)", transformOrigin: "center" }
      );
      gsap.fromTo(
        $$(".recent-list li", view),
        { x: -14, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.5, stagger: 0.09, delay: 0.35, ease: "power2.out" }
      );
    }
    if (view.id === "view-progress") {
      runCounters(view);
      $$(".bar", view).forEach((bar, i) => {
        gsap.to(bar, { height: bar.dataset.h, duration: 1.1, delay: 0.25 + i * 0.12, ease: "power3.out" });
      });
      $$(".metric-fill", view).forEach((fill, i) => {
        gsap.to(fill, { width: fill.dataset.w, duration: 1.2, delay: 0.3 + i * 0.12, ease: "power3.out" });
      });
    }
    if (view.id === "view-history") {
      gsap.fromTo(
        $$(".tl-dot", view),
        { scale: 0 },
        { scale: 1, duration: 0.45, stagger: 0.12, delay: 0.25, ease: "back.out(2.4)" }
      );
    }
  }

  function switchView(name) {
    if (viewTween) viewTween.progress(1);
    const outgoing = $(".view.is-active");
    const incoming = $("#view-" + name);
    if (!incoming || incoming === outgoing) return;

    $$(".side-item").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
    const activeBtn = $(`.side-item[data-view="${name}"]`);
    if (activeBtn) {
      gsap.fromTo(activeBtn, { scale: 0.9 }, { scale: 1, duration: 0.5, ease: "back.out(3)", clearProps: "transform" });
    }
    currentView = name;
    history.replaceState(null, "", "#" + name);

    const show = () => {
      outgoing.classList.remove("is-active");
      incoming.classList.add("is-active");
      window.scrollTo({ top: 0, behavior: "instant" });
      animateViewIn(incoming);
    };

    if (outgoing) {
      viewTween = gsap.to(outgoing, { opacity: 0, y: -26, scale: 0.98, filter: "blur(10px)", duration: 0.3, ease: "power3.in", onComplete: () => {
        gsap.set(outgoing, { clearProps: "opacity,transform,filter" });
        viewTween = null;
        show();
      }});
    } else show();

    $("#sidebar").classList.remove("open");
  }

  $$(".side-item[data-view]").forEach((btn) =>
    btn.addEventListener("click", () => switchView(btn.dataset.view))
  );
  document.addEventListener("click", (e) => {
    const jump = e.target.closest("[data-view-jump]");
    if (jump) switchView(jump.dataset.viewJump);
  });

  /* chip filters (visual only) */
  document.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) {
      chip.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      gsap.fromTo(chip, { scale: 0.9 }, { scale: 1, duration: 0.3, ease: "back.out(3)" });
    }
  });

  /* ---------------- product detail modal ---------------- */
  const PRODUCTS = {
    hydra: {
      emoji: "🧴", name: "Hydra Barrier Cream", price: "$24.00", match: "92% match",
      stars: "★★★★★", rating: "4.8", count: "1,284 reviews",
      desc: "Ceramide-rich cream for dry, compromised barriers. Recommended after scans that find dryness or flaking.",
      reviews: [
        { init: "SA", name: "Su Su Aung", stars: "5.0", text: "Cleared up the dry patches on my cheeks in about a week. Matches what my scan recommended.", meta: "Nov 6 · Facial scan user" },
        { init: "MK", name: "Min Khant", stars: "4.5", text: "Rich texture, great for night use. A bit heavy in humid weather during the day.", meta: "Nov 3 · Body scan user" },
        { init: "TZ", name: "Thiri Zin", stars: "5.0", text: "My hydration score went from 61% to 78% in three weeks of using this.", meta: "Oct 30 · Verified buyer" },
      ],
    },
    spf: {
      emoji: "☀️", name: "Mineral SPF 50", price: "$18.50", match: "90% match",
      stars: "★★★★★", rating: "4.9", count: "2,041 reviews",
      desc: "Lightweight daily sunscreen with zinc oxide. No white cast, no sting around the eyes.",
      reviews: [
        { init: "AL", name: "Aung Lwin", stars: "5.0", text: "Finally an SPF that doesn't pill under moisturizer. I wear it every morning.", meta: "Nov 7 · Verified buyer" },
        { init: "NM", name: "Nang Moe", stars: "4.8", text: "No white cast on medium skin tones. Slight shine by midday but nothing major.", meta: "Oct 28 · Facial scan user" },
      ],
    },
    gel: {
      emoji: "🫧", name: "Gentle Gel Cleanser", price: "$14.00", match: "87% match",
      stars: "★★★★☆", rating: "4.6", count: "876 reviews",
      desc: "pH-balanced gel cleanser that removes sunscreen without stripping sensitive skin.",
      reviews: [
        { init: "KH", name: "Kyaw Htet", stars: "4.5", text: "Very gentle, doesn't foam much, but my skin feels clean and calm.", meta: "Nov 1 · Sensitive skin" },
        { init: "EW", name: "Ei Wai", stars: "4.7", text: "Took off my SPF 50 in one wash. No tight feeling afterwards.", meta: "Oct 22 · Verified buyer" },
      ],
    },
    calm: {
      emoji: "🌿", name: "Calm Soothing Gel", price: "$16.00", match: "84% match",
      stars: "★★★★☆", rating: "4.7", count: "654 reviews",
      desc: "Centella gel for irritated or rash-prone areas. Cooling and fragrance-free.",
      reviews: [
        { init: "SM", name: "Su Myat", stars: "5.0", text: "The rash on my arm from my body scan calmed down in four days.", meta: "Nov 5 · Body scan user" },
        { init: "HN", name: "Hnin Hnin", stars: "4.4", text: "Soothing and light, but the tube runs out fast if you use it on large areas.", meta: "Oct 19 · Verified buyer" },
      ],
    },
  };

  const pmOverlay = $("#product-modal");
  let pmCurrent = null;
  let pmRating = 0;

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function renderPmReviews(p) {
    $("#pm-review-list").innerHTML = p.reviews.map((r) => `
      <article class="card review-card">
        <span class="avatar avatar-sm">${esc(r.init)}</span>
        <div>
          <strong>${esc(r.name)}</strong> <span class="pill pill-soft">★ ${esc(r.stars)}</span>
          <p>“${esc(r.text)}”</p>
          <small>${esc(r.meta)}</small>
        </div>
      </article>`).join("");
  }

  function openProduct(id) {
    const p = PRODUCTS[id];
    if (!p) return;
    pmCurrent = id;
    pmRating = 0;
    $("#pm-emoji").textContent = p.emoji;
    $("#pm-match").textContent = p.match;
    $("#pm-name").textContent = p.name;
    $("#pm-price").textContent = p.price;
    $("#pm-desc").textContent = p.desc;
    $("#pm-stars").innerHTML = `${p.stars} <em>${esc(p.rating)}</em>`;
    $("#pm-count").textContent = p.count;
    $("#pm-text").value = "";
    $$("#pm-star-input button").forEach((b) => b.classList.remove("lit"));
    renderPmReviews(p);
    pmOverlay.classList.add("is-open");
    pmOverlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    gsap.fromTo("#pm-review-list .review-card", { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.08, delay: 0.2, ease: "power2.out" });
  }

  function closeProduct() {
    pmOverlay.classList.remove("is-open");
    pmOverlay.setAttribute("aria-hidden", "true");
    if (!overlay.classList.contains("is-open")) document.body.style.overflow = "";
  }

  document.addEventListener("click", (e) => {
    const opener = e.target.closest("[data-open-product]");
    if (opener) openProduct(opener.dataset.openProduct);
  });
  pmOverlay.addEventListener("click", (e) => { if (e.target === pmOverlay) closeProduct(); });

  const pmStars = $("#pm-star-input");
  pmStars.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-star]");
    if (!btn) return;
    pmRating = +btn.dataset.star;
    $$("button", pmStars).forEach((b, i) => {
      b.classList.toggle("lit", i < pmRating);
      if (i < pmRating) gsap.fromTo(b, { scale: 0.6, rotate: -20 }, { scale: 1, rotate: 0, duration: 0.4, delay: i * 0.05, ease: "back.out(3)" });
    });
  });
  pmStars.addEventListener("mouseover", (e) => {
    const btn = e.target.closest("[data-star]");
    if (btn) $$("button", pmStars).forEach((b, i) => b.classList.toggle("lit", i < +btn.dataset.star));
  });
  pmStars.addEventListener("mouseleave", () => {
    $$("button", pmStars).forEach((b, i) => b.classList.toggle("lit", i < pmRating));
  });

  $("#pm-submit").addEventListener("click", () => {
    if (!pmCurrent) return;
    if (!pmRating) { toast("Pick a star rating first"); return; }
    const text = $("#pm-text").value.trim() || "Rating only — no written comments.";
    PRODUCTS[pmCurrent].reviews.unshift({ init: "WL", name: "Win Lin Hein", stars: pmRating.toFixed(1), text, meta: "Just now · You" });
    renderPmReviews(PRODUCTS[pmCurrent]);
    $("#pm-text").value = "";
    pmRating = 0;
    $$("#pm-star-input button").forEach((b) => b.classList.remove("lit"));
    gsap.fromTo("#pm-review-list .review-card:first-child", { y: -12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" });
    toast("Review submitted (demo) ✓");
  });

  /* ---------------- scan flow overlay ---------------- */
  const overlay = $("#scan-overlay");
  const stepIds = ["step-mode", "step-upload", "step-symptoms", "step-processing", "step-result"];
  let scanMode = "skincare";
  let scanStepIndex = 0;
  let stepTween = null;
  let processingTL = null;
  let selectedImage = null;
  let predictionResult = null;
  let imagePreviewUrl = null;
  let uploadController = null;

  function setProgress() {
    $("#scan-progress-fill").style.width = ((scanStepIndex + 1) / stepIds.length) * 100 + "%";
  }

  function showStep(id, dir = 1) {
    if (stepTween) stepTween.progress(1);
    const outgoing = $(".scan-step.is-active");
    const incoming = $("#" + id);
    scanStepIndex = stepIds.indexOf(id);
    setProgress();
    if (outgoing === incoming) return;

    const swap = () => {
      if (outgoing) outgoing.classList.remove("is-active");
      incoming.classList.add("is-active");
      gsap.fromTo(
        incoming.children,
        { x: 30 * dir, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.5, stagger: 0.07, ease: "power3.out" }
      );
    };
    if (outgoing) {
      stepTween = gsap.to(outgoing, { x: -30 * dir, opacity: 0, duration: 0.22, ease: "power2.in", onComplete: () => {
        gsap.set(outgoing, { x: 0, opacity: 1 });
        stepTween = null;
        swap();
      }});
    } else swap();
  }

  function openScan(preMode) {
    if (preMode) setMode(preMode);
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    resetScanFlow();
    showStep("step-mode");
    gsap.fromTo(".scan-panel", { y: 26, scale: 0.97 }, { y: 0, scale: 1, duration: 0.45, ease: "power3.out" });
  }

  function closeScan() {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    if (!pmOverlay.classList.contains("is-open")) document.body.style.overflow = "";
    if (processingTL) processingTL.kill();
    if (uploadController) uploadController.abort();
    uploadController = null;
    stopWebcam();
  }

  function resetScanFlow() {
    if (uploadController) uploadController.abort();
    uploadController = null;
    stopWebcam();
    selectedImage = null;
    predictionResult = null;
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = null;
    $("#scan-file-input").value = "";
    $("#upload-next").disabled = true;
    $("#quality-check").className = "quality-check";
    $("#quality-text").textContent = "Checking image quality…";
    dropzone.classList.remove("is-scanning");
    $$(".symptom-chip").forEach((c) => c.classList.remove("is-picked"));
    $$("#proc-steps li").forEach((li) => {
      li.className = "";
      $(".proc-state", li).textContent = "waiting";
    });
    $$(".mode-card").forEach((m) => m.classList.toggle("is-picked", m.dataset.mode === scanMode));
    const preview = scanMode === "condition" ? "assets/body-scan.png" : "assets/face-scan.png";
    $("#drop-preview").src = preview;
    $("#proc-preview").src = preview;
    $("#result-confidence").dataset.count = "0";
    $("#result-confidence").textContent = "0";
    $("#result-prediction").textContent = "Upload a photo to see the model prediction.";
    $("#result-confidence-detail").textContent = "Confidence will appear here after analysis.";
    $("#result-summary").textContent = `${scanMode === "condition" ? "Condition & risk assessment" : "Skin care analysis"} · Ready for review`;
    scanStepIndex = 0;
    setProgress();
  }

  function setMode(mode) {
    scanMode = mode;
    $$(".mode-card").forEach((m) => m.classList.toggle("is-picked", m.dataset.mode === mode));
    $("#drop-preview").src = mode === "condition" ? "assets/body-scan.png" : "assets/face-scan.png";
    $("#proc-preview").src = $("#drop-preview").src;
  }

  $$("[data-open-scan]").forEach((b) => b.addEventListener("click", () => openScan(b.dataset.openScan)));
  $$(".mode-card").forEach((b) =>
    b.addEventListener("click", () => {
      setMode(b.dataset.mode);
      gsap.fromTo(b, { scale: 0.94 }, { scale: 1, duration: 0.45, ease: "back.out(2.5)" });
      setTimeout(() => showStep("step-upload"), 260);
    })
  );
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeScan(); });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-scan]")) closeScan();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (pmOverlay.classList.contains("is-open")) closeProduct();
    else if (overlay.classList.contains("is-open")) closeScan();
  });
  $$("[data-scan-back]").forEach((b) =>
    b.addEventListener("click", () => {
      const prev = stepIds[Math.max(0, scanStepIndex - 1)];
      showStep(prev, -1);
    })
  );
  $("#quick-scan").addEventListener("click", () => openScan());

  /* Upload the selected image to the prediction API. */
  const dropzone = $("#dropzone");
  async function uploadImage(file) {
    if (!file) return;
    if (uploadController) uploadController.abort();
    uploadController = null;
    selectedImage = null;
    predictionResult = null;
    $("#upload-next").disabled = true;
    dropzone.classList.remove("is-scanning");
    if (!file.type.startsWith("image/")) {
      $("#quality-check").className = "quality-check show fail";
      $("#quality-text").textContent = "Please choose a valid image file.";
      return;
    }

    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    selectedImage = file;
    predictionResult = null;
    imagePreviewUrl = URL.createObjectURL(file);
    $("#drop-preview").src = imagePreviewUrl;
    $("#proc-preview").src = imagePreviewUrl;
    $("#upload-next").disabled = true;

    const qc = $("#quality-check");
    const beam = $("#drop-beam");
    qc.className = "quality-check show";
    $("#quality-text").textContent = "Uploading photo and analyzing…";
    dropzone.classList.add("is-scanning");

    const controller = new AbortController();
    uploadController = controller;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", scanMode);

    gsap.fromTo(beam, { top: "-34%" }, { top: "104%", duration: 1.1, ease: "power1.inOut", repeat: 1, yoyo: true });
    try {
      const response = await fetch("/api/predict", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("The prediction service returned an invalid response.");
      }
      if (!response.ok) {
        throw new Error(result && typeof result.detail === "string" ? result.detail : "The prediction service could not analyze this image.");
      }
      if (
        !result ||
        typeof result !== "object" ||
        result.success !== true ||
        typeof result.predicted_class !== "string" ||
        !result.predicted_class.trim() ||
        !Number.isFinite(result.confidence) ||
        result.confidence < 0 ||
        result.confidence > 1
      ) {
        throw new Error("The prediction service returned incomplete prediction data.");
      }
      if (uploadController !== controller) return;

      predictionResult = result;
      dropzone.classList.remove("is-scanning");
      qc.classList.add("pass");
      $("#quality-text").textContent = "✓ Analysis complete. Continue to review your results.";
      gsap.fromTo(qc, { scale: 0.96 }, { scale: 1, duration: 0.4, ease: "back.out(2)" });
      $("#upload-next").disabled = false;
      gsap.fromTo($("#upload-next"), { scale: 0.9 }, { scale: 1, duration: 0.5, ease: "back.out(2.5)" });
    } catch (error) {
      if (controller.signal.aborted) return;
      dropzone.classList.remove("is-scanning");
      qc.className = "quality-check show fail";
      const message = error instanceof Error ? error.message : "An unexpected error occurred.";
      $("#quality-text").textContent = `Analysis failed: ${message} Choose another photo to retry.`;
    } finally {
      if (uploadController === controller) uploadController = null;
    }
  }

  $("#browse-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#scan-file-input").click();
  });

  /* ---------------- in-browser webcam capture ---------------- */
  const stepUpload = $("#step-upload");
  const webcamVideo = $("#webcam-video");
  const webcamCanvas = $("#webcam-canvas");
  const webcamHint = $("#webcam-hint");
  let webcamStream = null;

  function stopWebcam() {
    if (webcamStream) {
      webcamStream.getTracks().forEach((t) => t.stop());
      webcamStream = null;
    }
    webcamVideo.srcObject = null;
    stepUpload.classList.remove("is-webcam");
  }

  async function openWebcam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("Camera is unavailable here — choose a file instead.");
      $("#scan-file-input").click();
      return;
    }
    stepUpload.classList.add("is-webcam");
    webcamHint.textContent = "Starting camera…";
    try {
      try {
        webcamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      } catch {
        webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      webcamVideo.srcObject = webcamStream;
      await webcamVideo.play().catch(() => {});
      webcamHint.textContent = "Position the area in the frame, then capture.";
      gsap.fromTo(".webcam-frame", { scale: 0.96, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "power3.out" });
    } catch {
      webcamHint.textContent = "Camera access was blocked. Cancel and choose a file instead.";
    }
  }

  function captureWebcamPhoto() {
    const w = webcamVideo.videoWidth;
    const h = webcamVideo.videoHeight;
    if (!webcamStream || !w || !h) { toast("The camera is not ready yet."); return; }
    webcamCanvas.width = w;
    webcamCanvas.height = h;
    webcamCanvas.getContext("2d").drawImage(webcamVideo, 0, 0, w, h);
    webcamCanvas.toBlob((blob) => {
      if (!blob) { toast("Could not capture the photo."); return; }
      const file = new File([blob], `webcam-${Date.now()}.jpg`, { type: "image/jpeg" });
      stopWebcam();
      uploadImage(file);
    }, "image/jpeg", 0.92);
  }

  $("#camera-btn").addEventListener("click", openWebcam);
  $("#webcam-cancel").addEventListener("click", stopWebcam);
  $("#webcam-capture").addEventListener("click", captureWebcamPhoto);

  $("#scan-file-input").addEventListener("change", (e) => {
    uploadImage(e.target.files[0]);
    e.target.value = "";
  });
  dropzone.addEventListener("click", (e) => {
    if (!e.target.closest("button") && e.target.id !== "scan-file-input") $("#scan-file-input").click();
  });
  ["dragover", "dragenter"].forEach((ev) => dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    gsap.to(dropzone, { scale: 1.02, duration: 0.25 });
  }));
  dropzone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    gsap.to(dropzone, { scale: 1, duration: 0.25 });
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    gsap.to(dropzone, { scale: 1, duration: 0.25 });
    uploadImage(e.dataTransfer.files[0]);
  });
  $("#upload-next").addEventListener("click", () => {
    if (selectedImage && predictionResult) showStep("step-symptoms");
  });

  /* symptom chips */
  $$(".symptom-chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      chip.classList.toggle("is-picked");
      gsap.fromTo(chip, { scale: 0.9 }, { scale: 1, duration: 0.35, ease: "back.out(3)" });
    })
  );

  /* processing timeline → result */
  $("#symptoms-next").addEventListener("click", () => {
    if (!predictionResult) {
      toast("Upload a photo and wait for the analysis to finish.");
      return;
    }
    showStep("step-processing");
    const items = $$("#proc-steps li");
    processingTL = gsap.timeline({ delay: 0.4 });

    items.forEach((li, i) => {
      processingTL.add(() => {
        items.forEach((x) => x.classList.remove("doing"));
        li.classList.add("doing");
        $(".proc-state", li).textContent = "running…";
        gsap.fromTo(li, { x: 0 }, { x: 6, duration: 0.3 });
      });
      processingTL.to({}, { duration: i === 1 ? 1.6 : 1.0 }); // CNN step takes longer
      processingTL.add(() => {
        li.classList.remove("doing");
        li.classList.add("done");
        $(".proc-state", li).textContent = "done ✓";
      });
    });

    processingTL.add(() => {
      showStep("step-result");
      presentResult();
    });
  });

  function presentResult() {
    const classNames = {
      akiec: "Actinic keratoses",
      bcc: "Basal cell carcinoma",
      bkl: "Benign keratosis-like lesions",
      df: "Dermatofibroma",
      mel: "Melanoma",
      nv: "Melanocytic nevi",
      vasc: "Vascular lesions",
      "Redness": "Redness",
      "dark spots": "Dark spots",
      "inflammatory acne": "Inflammatory acne",
      "non inflammatory acne black heads": "Blackheads",
      "non inflammatory acne white heads": "Whiteheads",
      "pigmentation": "Pigmentation",
      "pores": "Visible pores",
      "wrinkles": "Wrinkles",
    };
    const confidence = predictionResult ? Math.round(predictionResult.confidence * 100) : 0;
    const prediction = predictionResult
      ? classNames[predictionResult.predicted_class] || predictionResult.predicted_class.replace(/[_-]+/g, " ")
      : "No live prediction available. Upload a photo to run an analysis.";
    $("#result-prediction").textContent = predictionResult
      ? `Model prediction: ${prediction}.`
      : prediction;
    $("#result-confidence-detail").textContent = predictionResult
      ? `Model confidence: ${confidence}%.`
      : "Confidence will appear here after analysis.";
    const highConcern = predictionResult && scanMode === "condition" && ["mel", "bcc", "akiec"].includes(predictionResult.predicted_class);
    $("#result-summary").textContent = `${scanMode === "condition" ? "Condition & risk assessment" : "Skin care analysis"} · Results ready`;
    const guidance = $("#step-result .result-grid article:nth-child(2)");
    if (highConcern) {
      $("#result-guidance-title").textContent = "Professional assessment recommended";
      $("#result-guidance-note").textContent = "This model signal is not a cancer probability or diagnosis. We are withholding product suggestions. Please arrange an assessment with a qualified clinician.";
      guidance.querySelector(".recs-row").hidden = true;
    } else {
      $("#result-guidance-title").textContent = scanMode === "skincare" ? "General skin care" : "General care information";
      $("#result-guidance-note").textContent = scanMode === "skincare"
        ? "This broad image label is not a diagnosis. Pigmentation is not a melasma-specific class, and the sample product catalog is not personalized or medical advice."
        : "No high-concern class was returned, but this does not rule out a medical condition. Seek care if the area changes or worries you.";
      guidance.querySelector(".recs-row").hidden = true;
    }
    const historyEntry = {
      mode: scanMode,
      label: predictionResult ? (classNames[predictionResult.predicted_class] || predictionResult.predicted_class) : "No model result",
      confidence,
      createdAt: new Date().toISOString(),
      concern: Boolean(highConcern)
    };
    if (predictionResult) saveScan(historyEntry);
    $("#result-confidence").dataset.count = String(confidence);
    $("#result-confidence").dataset.suffix = "%";
    runCounters($("#step-result"));
    drawRing($(".ring-result", $("#step-result")), confidence, 0.3);
    gsap.fromTo($(".result-check"), { scale: 0, rotate: -90 }, { scale: 1, rotate: 0, duration: 0.6, delay: 0.15, ease: "back.out(2)" });
    gsap.fromTo($$("#step-result .result-block"), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, stagger: 0.12, delay: 0.25, ease: "power3.out" });
  }

  function saveScan(entry) {
    let entries = [];
    try { entries = JSON.parse(localStorage.getItem("skinwise.scans") || "[]"); } catch { entries = []; }
    entries.unshift(entry);
    entries = entries.slice(0, 50);
    localStorage.setItem("skinwise.scans", JSON.stringify(entries));
    renderHistory();
  }

  function renderHistory() {
    let entries = [];
    try { entries = JSON.parse(localStorage.getItem("skinwise.scans") || "[]"); } catch { entries = []; }
    const list = $("#history-list");
    if (!list) return;
    $("#dashboard-scan-count").textContent = entries.length
      ? `${entries.length} saved ${entries.length === 1 ? "analysis" : "analyses"}`
      : "No analyses saved yet.";
    list.innerHTML = entries.length ? entries.map((entry) => {
      const date = new Date(entry.createdAt).toLocaleString();
      const title = entry.mode === "condition" ? "Skin condition & risk assessment" : "Skin care & cosmetic analysis";
      const status = entry.concern
        ? "Model signal needs professional assessment. No product suggestions were provided."
        : "Model output is informational only and is not a diagnosis.";
      return `<article class="tl-item"><span class="tl-dot"></span><div class="tl-card"><span class="tl-date">${esc(date)}</span><h3>${esc(title)}</h3><p>${esc(entry.label)} · model confidence ${Number(entry.confidence)}%</p><p>${esc(status)}</p></div></article>`;
    }).join("") : '<article class="card"><h3>No saved analyses yet</h3><p>Start an analysis to add your first report here.</p></article>';
  }
  renderHistory();

  /* ---------------- mobile menu ---------------- */
  $("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

  /* ---------------- sidebar collapse ---------------- */
  const app = $(".app");
  const collapseBtn = $("#collapse-btn");
  const mqDesktop = window.matchMedia("(min-width: 961px)");
  let collapsed = false;

  function setCollapse(next, animate = true) {
    collapsed = next;
    app.classList.toggle("collapsed", collapsed);
    const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
    collapseBtn.setAttribute("aria-label", label);
    collapseBtn.title = label;

    // Collapse is desktop-only; the mobile drawer uses the hamburger instead.
    if (!mqDesktop.matches) { app.style.removeProperty("--sidebar-w"); return; }

    gsap.to(app, { "--sidebar-w": collapsed ? "86px" : "264px", duration: animate ? 0.6 : 0, ease: "power4.inOut" });

    if (animate) {
      gsap.fromTo(
        ".side-item svg, .side-logout svg",
        { scale: 1, rotate: 0 },
        { scale: 1.3, rotate: -9, duration: 0.16, yoyo: true, repeat: 1, stagger: 0.045, ease: "power2.inOut", clearProps: "scale,rotate" }
      );
      gsap.fromTo(
        ".side-item",
        { x: collapsed ? 10 : -10, opacity: 0.4 },
        { x: 0, opacity: 1, duration: 0.5, stagger: 0.04, ease: "power3.out", clearProps: "transform,opacity" }
      );
    }
  }

  collapseBtn.addEventListener("click", () => setCollapse(!collapsed));
  const onMQChange = (e) => { if (!e.matches && collapsed) setCollapse(false, false); };
  if (mqDesktop.addEventListener) mqDesktop.addEventListener("change", onMQChange);
  else if (mqDesktop.addListener) mqDesktop.addListener(onMQChange);

  /* ---------------- entrance ---------------- */
  // Components are already in the DOM by this point, so run immediately
  // rather than waiting for the window load event.
  (function enter() {
    if (window.matchMedia("(min-width: 961px)").matches) {
      gsap.fromTo(".sidebar", { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: "power3.out" });
    } else {
      gsap.fromTo(".sidebar", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power3.out" });
    }
    gsap.fromTo(".topbar", { y: -18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, delay: 0.1, ease: "power3.out" });
    const initial = location.hash.replace("#", "");
    if (initial === "scan-start") openScan();
    else if (initial === "sample-report") {
      openScan();
      showStep("step-result");
      presentResult();
    }
    else if (initial.startsWith("product-")) openProduct(initial.slice(8));
    else if (initial && initial !== "overview" && $("#view-" + initial)) switchView(initial);
    else animateViewIn($("#view-overview"));
  })();
})();
