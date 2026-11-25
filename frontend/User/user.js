/* Skinwise user dashboard */
(async () => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const noAnimation = { kill() {}, progress() { return this; } };
  const gsap = window.gsap || {
    globalTimeline: { timeScale() {} },
    to(_target, vars = {}) { vars.onUpdate?.(); vars.onComplete?.(); return noAnimation; },
    fromTo(_target, _from, vars = {}) { vars.onUpdate?.(); vars.onComplete?.(); return noAnimation; },
    set() {},
    timeline() {
      return {
        add(callback) { if (typeof callback === "function") callback(); return this; },
        to() { return this; },
        kill() {},
      };
    },
  };

  function readAuthenticatedUser() {
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[storageName];
        const token = storage.getItem("skinwise.access_token");
        const user = JSON.parse(storage.getItem("skinwise.user") || "null");
        if (
          token && user && typeof user.full_name === "string" && user.full_name.trim() &&
          typeof user.email === "string" && user.email.trim()
        ) {
          return { storage, user };
        }
      } catch {
        // Continue to the other storage, then send the visitor to sign in.
      }
    }
    return null;
  }

  const auth = readAuthenticatedUser();
  if (!auth) {
    window.location.replace("../login/login.html");
    return;
  }

  function initialsFor(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "U";
    return (parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`
      : parts[0].slice(0, 2)
    ).toLocaleUpperCase();
  }

  const RING_LEN = 2 * Math.PI * 68; // r=68 score ring circumference

  // Respect reduced-motion users (and allow ?static for instant render)
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    new URLSearchParams(location.search).has("static")
  ) {
    gsap.globalTimeline.timeScale(60);
  }

  /* ---------------- component partials ---------------- */
  // Load nested component slots before any element lookups below run.
  async function loadComponents() {
    let slots = $$("[data-include]");
    while (slots.length) {
      await Promise.all(
        slots.map(async (slot) => {
          const res = await fetch(slot.dataset.include, { cache: "no-store" });
          if (!res.ok) throw new Error("Could not load " + slot.dataset.include);
          slot.outerHTML = await res.text();
        })
      );
      slots = $$("[data-include]");
    }
  }

  try {
    await loadComponents();
  } catch (err) {
    console.error(err);
    document.body.innerHTML =
      '<p style="padding:48px;font:600 15px system-ui,sans-serif;color:#243932">Dashboard components failed to load. Serve the project over HTTP (e.g. <code>python -m http.server</code>) instead of opening the file directly.</p>';
    return;
  }

  const dropdownRecords = [];
  const dropdownBySelect = new WeakMap();
  const reduceDropdownMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    new URLSearchParams(location.search).has("static");

  function syncAnimatedDropdown(record) {
    const selectedIndex = record.select.selectedIndex;
    const selectedOption = record.select.options[selectedIndex];
    record.valueLabel.textContent = selectedOption ? selectedOption.textContent.trim() : "";
    record.trigger.setAttribute(
      "aria-label",
      [record.labelText, record.valueLabel.textContent].filter(Boolean).join(": ")
    );
    record.options.forEach((optionButton, index) => {
      optionButton.setAttribute("aria-selected", String(index === selectedIndex));
    });
    if (record.select.value) {
      record.trigger.removeAttribute("aria-invalid");
      record.trigger.removeAttribute("aria-describedby");
      record.error.hidden = true;
    }
  }

  function positionAnimatedDropdown(record) {
    const bounds = record.trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const width = Math.min(bounds.width, window.innerWidth - viewportPadding * 2);
    const left = Math.max(viewportPadding, Math.min(bounds.left, window.innerWidth - width - viewportPadding));
    record.menu.style.width = `${width}px`;
    record.menu.style.left = `${left}px`;
    record.menu.style.maxHeight = `${Math.max(120, Math.min(280, window.innerHeight - viewportPadding * 2))}px`;

    const menuHeight = Math.min(record.menu.scrollHeight, window.innerHeight - viewportPadding * 2);
    const roomBelow = window.innerHeight - bounds.bottom - viewportPadding;
    const openAbove = roomBelow < menuHeight + 8 && bounds.top > menuHeight + viewportPadding;
    const top = openAbove
      ? bounds.top - menuHeight - 8
      : Math.min(bounds.bottom + 8, window.innerHeight - menuHeight - viewportPadding);
    record.menu.style.top = `${Math.max(viewportPadding, top)}px`;
    record.menu.style.transformOrigin = openAbove ? "bottom center" : "top center";
    record.menu.dataset.side = openAbove ? "top" : "bottom";
  }

  function closeAnimatedDropdown(record, restoreFocus = false) {
    if (!record.open) return;
    record.open = false;
    record.trigger.setAttribute("aria-expanded", "false");
    record.menu.setAttribute("aria-hidden", "true");
    if (restoreFocus) record.trigger.focus();
    record.menu.classList.remove("is-open");
    clearTimeout(record.closeTimer);
    if (reduceDropdownMotion) {
      record.menu.hidden = true;
      return;
    }
    record.closeTimer = setTimeout(() => {
      if (!record.open) record.menu.hidden = true;
    }, 230);
  }

  function focusAnimatedOption(record, index) {
    const availableOptions = record.options
      .map((option, optionIndex) => ({ option, optionIndex }))
      .filter(({ option }) => !option.disabled);
    if (!availableOptions.length) return;
    const current = availableOptions.findIndex(({ optionIndex }) => optionIndex === index);
    const selected = current >= 0 ? current : 0;
    availableOptions[selected].option.focus();
    availableOptions[selected].option.scrollIntoView({ block: "nearest" });
  }

  function openAnimatedDropdown(record, direction = 1) {
    if (record.open) return;
    dropdownRecords.forEach((other) => {
      if (other !== record) closeAnimatedDropdown(other);
    });
    record.open = true;
    clearTimeout(record.closeTimer);
    record.menu.hidden = false;
    record.menu.setAttribute("aria-hidden", "false");
    record.trigger.setAttribute("aria-expanded", "true");
    positionAnimatedDropdown(record);

    requestAnimationFrame(() => {
      if (!record.open) return;
      record.menu.classList.add("is-open");
      const selectedIndex = direction < 0 ? record.select.options.length - 1 : record.select.selectedIndex;
      focusAnimatedOption(record, selectedIndex);
    });
  }

  function initializeAnimatedDropdowns() {
    $$("select").forEach((select, index) => {
      const field = select.closest("label") || select.parentElement;
      const required = select.required;
      const visibleLabel = field?.querySelector(":scope > span")?.textContent.trim();
      const textLabel = field
        ? [...field.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent.trim())
            .filter(Boolean)
            .join(" ")
        : "";
      const labelText = visibleLabel || textLabel || "Choose an option";
      const wrapper = document.createElement("div");
      wrapper.className = "motion-dropdown";

      const trigger = document.createElement("button");
      trigger.className = "motion-dropdown-trigger";
      trigger.id = `${select.id}-trigger`;
      trigger.type = "button";
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-required", String(select.required));

      const valueLabel = document.createElement("span");
      valueLabel.className = "motion-dropdown-value";
      const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      chevron.setAttribute("viewBox", "0 0 16 16");
      chevron.setAttribute("aria-hidden", "true");
      chevron.classList.add("motion-dropdown-chevron");
      const chevronPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      chevronPath.setAttribute("d", "m4 6 4 4 4-4");
      chevronPath.setAttribute("fill", "none");
      chevronPath.setAttribute("stroke", "currentColor");
      chevronPath.setAttribute("stroke-linecap", "round");
      chevronPath.setAttribute("stroke-linejoin", "round");
      chevronPath.setAttribute("stroke-width", "1.6");
      chevron.append(chevronPath);
      trigger.append(valueLabel, chevron);

      const menu = document.createElement("div");
      menu.className = "motion-dropdown-menu";
      menu.id = `motion-dropdown-menu-${index + 1}`;
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", labelText);
      menu.setAttribute("aria-hidden", "true");
      menu.hidden = true;

      const error = document.createElement("span");
      error.className = "motion-dropdown-error";
      error.id = `${menu.id}-error`;
      error.setAttribute("role", "alert");
      error.textContent = "Choose an option to continue.";
      error.hidden = true;

      const record = {
        select,
        trigger,
        valueLabel,
        menu,
        error,
        labelText,
        options: [],
        open: false,
        typeahead: "",
        typeaheadTimer: 0,
        closeTimer: 0,
      };
      trigger.setAttribute("aria-controls", menu.id);
      select.classList.add("motion-dropdown-native");
      select.setAttribute("aria-hidden", "true");
      select.tabIndex = -1;
      if (required) select.required = false;
      select.insertAdjacentElement("afterend", wrapper);
      wrapper.append(trigger);
      if (required) wrapper.append(error);
      document.body.append(menu);

      [...select.options].forEach((option, optionIndex) => {
        const optionButton = document.createElement("button");
        optionButton.type = "button";
        optionButton.className = "motion-dropdown-option";
        optionButton.setAttribute("role", "option");
        optionButton.setAttribute("aria-selected", "false");
        optionButton.textContent = option.textContent.trim();
        optionButton.disabled = option.disabled;
        optionButton.tabIndex = -1;
        optionButton.addEventListener("click", () => {
          if (optionButton.disabled) return;
          select.selectedIndex = optionIndex;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
          syncAnimatedDropdown(record);
          closeAnimatedDropdown(record, true);
        });
        menu.append(optionButton);
        record.options.push(optionButton);
      });

      trigger.addEventListener("click", () => {
        if (record.open) closeAnimatedDropdown(record);
        else openAnimatedDropdown(record);
      });
      trigger.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
        event.preventDefault();
        openAnimatedDropdown(record, event.key === "ArrowUp" ? -1 : 1);
      });
      select.addEventListener("change", () => syncAnimatedDropdown(record));
      menu.addEventListener("keydown", (event) => {
        const activeIndex = record.options.indexOf(document.activeElement);
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeAnimatedDropdown(record, true);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          let nextIndex = activeIndex + direction;
          while (
            nextIndex >= 0 &&
            nextIndex < record.options.length &&
            record.options[nextIndex].disabled
          ) nextIndex += direction;
          if (nextIndex < 0) nextIndex = record.options.length - 1;
          if (nextIndex >= record.options.length) nextIndex = 0;
          focusAnimatedOption(record, nextIndex);
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          focusAnimatedOption(record, event.key === "Home" ? 0 : record.options.length - 1);
        } else if (event.key === "Tab") {
          const focusable = [...document.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )].filter((element) =>
            !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length
          );
          const triggerIndex = focusable.indexOf(trigger);
          const nextFocus = focusable[triggerIndex + (event.shiftKey ? -1 : 1)];
          closeAnimatedDropdown(record);
          if (nextFocus) {
            event.preventDefault();
            nextFocus.focus();
          }
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          record.typeahead += event.key.toLocaleLowerCase();
          clearTimeout(record.typeaheadTimer);
          record.typeaheadTimer = setTimeout(() => { record.typeahead = ""; }, 600);
          const match = record.options.findIndex((option) =>
            !option.disabled && option.textContent.toLocaleLowerCase().startsWith(record.typeahead)
          );
          if (match >= 0) focusAnimatedOption(record, match);
        }
      });
      dropdownBySelect.set(select, record);
      dropdownRecords.push(record);
      syncAnimatedDropdown(record);
    });

    document.addEventListener("click", (event) => {
      dropdownRecords.forEach((record) => {
        if (record.open && !record.trigger.contains(event.target) && !record.menu.contains(event.target)) {
          closeAnimatedDropdown(record);
        }
      });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const openRecord = dropdownRecords.find((record) => record.open);
        if (openRecord) {
          event.preventDefault();
          event.stopPropagation();
          closeAnimatedDropdown(openRecord, true);
        }
        return;
      }
      if (event.key !== "Tab") return;
      dropdownRecords.forEach((record) => {
        if (record.open && !record.menu.contains(event.target)) closeAnimatedDropdown(record);
      });
    });
    window.addEventListener("resize", () => {
      dropdownRecords.filter((record) => record.open).forEach(positionAnimatedDropdown);
    });
    window.addEventListener("scroll", () => {
      dropdownRecords.filter((record) => record.open).forEach(positionAnimatedDropdown);
    }, true);
  }

  function refreshAnimatedDropdown(select) {
    const record = dropdownBySelect.get(select);
    if (record) syncAnimatedDropdown(record);
  }

  initializeAnimatedDropdowns();

  const displayName = auth.user.full_name.trim();
  const displayEmail = auth.user.email;
  const initials = initialsFor(displayName);
  $$('[data-auth-name]').forEach((element) => { element.textContent = displayName; });
  $$('[data-auth-email]').forEach((element) => { element.textContent = displayEmail; });
  $$('[data-auth-initials]').forEach((element) => { element.textContent = initials; });
  const nameInput = $("[data-auth-name-input]");
  const emailInput = $("[data-auth-email-input]");
  if (nameInput) nameInput.value = displayName;
  if (emailInput) emailInput.value = displayEmail;

  function logout() {
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        window[storageName].removeItem("skinwise.access_token");
        window[storageName].removeItem("skinwise.user");
      } catch {
        // Still leave the dashboard after logout if browser storage is unavailable.
      }
    }
    window.location.replace("../login/login.html");
  }
  $(".side-logout")?.addEventListener("click", logout);

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
      renderOverviewCharts();
      runCounters(view);
      const hasData = getScans().length > 0;

      const line = $("#trend-line", view);
      if (hasData && line && line.getAttribute("d")) {
        const len = line.getTotalLength();
        gsap.fromTo(line, { strokeDasharray: len, strokeDashoffset: len }, { strokeDasharray: len, strokeDashoffset: 0, duration: 1.5, delay: 0.35, ease: "power2.inOut" });
        gsap.fromTo($("#trend-area", view), { opacity: 0 }, { opacity: 1, duration: 0.9, delay: 0.85, ease: "power2.out" });
        gsap.fromTo(
          $$("#trend-dots circle", view),
          { opacity: 0, scale: 0, transformOrigin: "center" },
          { opacity: 1, scale: 1, duration: 0.45, stagger: 0.09, delay: 0.5, ease: "back.out(2.4)" }
        );
        gsap.fromTo(
          $$("#trend-x span", view),
          { opacity: 0, y: 6 },
          { opacity: 1, y: 0, duration: 0.4, stagger: 0.05, delay: 0.7, ease: "power2.out" }
        );
      }
      if (!hasData) {
        if (ghostDrift) ghostDrift.kill();
        ghostDrift = gsap.to(line, { strokeDashoffset: -24, duration: 1.4, repeat: -1, ease: "none" });
        gsap.fromTo($("#trend-ghost-note", view), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.6, delay: 0.5, ease: "power2.out" });
      }

      const donut = $("#mix-donut", view);
      gsap.fromTo($(".mix-ring", view), { scale: 0.82, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, delay: 0.3, ease: "back.out(1.7)", clearProps: "transform,opacity" });
      if (hasData) {
        const target = Number(donut.dataset.mix) || 0;
        const sweep = { v: 0 };
        gsap.to(sweep, {
          v: target,
          duration: 1.3,
          delay: 0.4,
          ease: "power3.out",
          onUpdate: () => donut.style.setProperty("--mix", sweep.v.toFixed(4)),
        });
      }
      gsap.fromTo(
        $$("#mix-legend li", view),
        { x: -12, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.45, stagger: 0.1, delay: 0.55, ease: "power2.out" }
      );

      gsap.fromTo(
        $$("#find-list .find-row", view),
        { x: -18, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.5, stagger: 0.07, delay: 0.4, ease: "power2.out" }
      );
      if (hasData) {
        $$("#find-list .find-fill", view).forEach((fill, i) => {
          gsap.fromTo(fill, { width: "0%" }, { width: fill.dataset.w, duration: 1.1, delay: 0.55 + i * 0.07, ease: "power3.out" });
        });
      }
    }
    if (view.id === "view-progress") {
      renderProgressList();
      runCounters(view);
      $$(".bar", view).forEach((bar, i) => {
        gsap.to(bar, { height: bar.dataset.h, duration: 1.1, delay: 0.25 + i * 0.12, ease: "power3.out" });
      });
      $$(".metric-fill", view).forEach((fill, i) => {
        gsap.to(fill, { width: fill.dataset.w, duration: 1.2, delay: 0.3 + i * 0.12, ease: "power3.out" });
      });
    }
    if (view.id === "view-history") {
      const dots = $$(".tl-dot", view);
      if (dots.length) {
        gsap.fromTo(dots, { scale: 0 }, { scale: 1, duration: 0.45, stagger: 0.12, delay: 0.25, ease: "back.out(2.4)" });
      }
    }
  }

  function switchView(name) {
    if (viewTween) viewTween.progress(1);
    const outgoing = $(".view.is-active");
    const incoming = $("#view-" + name);
    if (!incoming || incoming === outgoing) return;

    currentView = name;
    if (name !== "overview" && ghostDrift) { ghostDrift.kill(); ghostDrift = null; }
    history.replaceState(null, "", "#" + name);
    document.dispatchEvent(new CustomEvent("skinwise:view", { detail: name }));

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
  }

  document.addEventListener("click", (e) => {
    const jump = e.target.closest("[data-view-jump]");
    if (jump) {
      switchView(jump.dataset.viewJump);
      if (jump.dataset.aiMode) setTimeout(() => setAiMode(jump.dataset.aiMode), 330);
    }
  });


  function setAiMode(mode, fromCard) {
    const analysisPanel      = $("#skin-analysis-panel");
    const recommendationPanel = $("#skincare-recommendation-panel");
    if (!analysisPanel || !recommendationPanel) return;

    const showRecommendation = mode === "recommendation";

    /* --- update active tab state --- */
    $$(".ai-module-card").forEach((card) => {
      const active = card.dataset.aiMode === mode;
      card.classList.toggle("is-active", active);
      card.setAttribute("aria-pressed", String(active));
    });

    /* --- determine which content card to animate in --- */
    const incomingPanel = showRecommendation ? recommendationPanel : analysisPanel;
    const outgoingPanel = showRecommendation ? analysisPanel : recommendationPanel;

    /* --- pick the animatable card element inside each panel --- */
    const incomingCard = showRecommendation
      ? $("#recommendation-msg-card")
      : $("#scan-flow");

    /* hide outgoing first */
    outgoingPanel.hidden = true;

    /* update tail direction on the incoming card */
    if (incomingCard) incomingCard.dataset.aiTail = mode;

    /* show incoming panel (hidden:false needed before measuring) */
    incomingPanel.hidden = false;

    /* --- GSAP: card shoots down from the clicked tab --- */
    if (fromCard && incomingCard && typeof gsap !== "undefined") {
      const tabRect  = fromCard.getBoundingClientRect();
      const cardRect = incomingCard.getBoundingClientRect();

      /* vertical travel: from bottom of tab to card's natural position */
      const dy = tabRect.bottom - cardRect.top + 10;

      gsap.killTweensOf(incomingCard);

      gsap.fromTo(
        incomingCard,
        {
          y: dy,
          scaleY: 0.55,
          scaleX: 0.92,
          opacity: 0,
          transformOrigin: "top center",
        },
        {
          y: 0,
          scaleY: 1,
          scaleX: 1,
          opacity: 1,
          duration: 0.5,
          ease: "back.out(1.3)",
        }
      );
    } else if (incomingCard && typeof gsap !== "undefined") {
      /* soft fade-in if no card ref (e.g. view-jump path) */
      gsap.fromTo(
        incomingCard,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.35, ease: "power3.out" }
      );
    }
  }

  document.addEventListener("click", (event) => {
    const aiCard = event.target.closest("[data-ai-mode]:not([data-view-jump])");
    if (aiCard) setAiMode(aiCard.dataset.aiMode, aiCard);
  });

  /* chip filters (visual only) */
  document.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) {
      chip.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      gsap.fromTo(chip, { scale: 0.97 }, { scale: 1, duration: 0.2, ease: "power2.out" });
    }
  });

  /* ---------------- collection pagination ---------------- */
  const paginationStates = new WeakMap();

  function setupPagination(container, nav, {
    threshold = 6,
    pageSize = 6,
    predicate = () => true,
    reset = false,
  } = {}) {
    if (!container || !nav) return;
    let state = paginationStates.get(container);
    if (!state || reset) {
      state = { page: 1 };
      paginationStates.set(container, state);
    }

    const items = [...container.children];
    const matching = items.filter(predicate);
    const totalPages = Math.ceil(matching.length / pageSize);
    if (matching.length <= threshold) {
      items.forEach((item) => { item.hidden = !predicate(item); });
      nav.hidden = true;
      nav.replaceChildren();
      state.page = 1;
      return;
    }

    state.page = Math.min(Math.max(1, state.page), totalPages);
    nav.hidden = false;
    const start = (state.page - 1) * pageSize;
    const end = start + pageSize;
    matching.forEach((item, index) => {
      item.hidden = index < start || index >= end;
    });
    items.filter((item) => !predicate(item)).forEach((item) => { item.hidden = true; });

    nav.innerHTML = `
      <button type="button" data-page-action="prev" ${state.page === 1 ? "disabled" : ""} aria-label="Previous page">←</button>
      ${Array.from({ length: totalPages }, (_, index) => `
        <button type="button" data-page="${index + 1}" class="${state.page === index + 1 ? "is-active" : ""}" aria-label="Page ${index + 1}" ${state.page === index + 1 ? 'aria-current="page"' : ""}>${index + 1}</button>
      `).join("")}
      <button type="button" data-page-action="next" ${state.page === totalPages ? "disabled" : ""} aria-label="Next page">→</button>`;
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page], [data-page-action]");
    if (!button) return;
    const nav = button.closest(".pagination");
    const containerId = nav?.id === "history-pagination"
      ? "history-list"
      : nav?.id === "progress-pagination"
        ? "tracked-scans-list"
        : nav?.id === "products-pagination"
          ? null
          : nav?.id === "doctors-pagination"
            ? "doctor-grid"
            : null;
    const container = containerId ? $("#" + containerId) : nav?.id === "products-pagination" ? $(".product-grid") : null;
    if (!container) return;
    const state = paginationStates.get(container);
    if (!state) return;
    if (button.dataset.page) state.page = Number(button.dataset.page);
    if (button.dataset.pageAction === "prev") state.page -= 1;
    if (button.dataset.pageAction === "next") state.page += 1;
    if (nav.id === "doctors-pagination") filterDoctors();
    else if (nav.id === "history-pagination") setupPagination(container, nav, { threshold: 6, pageSize: 6 });
    else if (nav.id === "progress-pagination") setupPagination(container, nav, { threshold: 6, pageSize: 6 });
    else setupPagination(container, nav, { threshold: 8, pageSize: 8 });
  });

  /* ---------------- skincare recommendation workflow ---------------- */
  const recommendationForm = $("#recommendation-form");
  if (recommendationForm) {
    const generateButton = $("#generate-recommendations");
    const skinTypeInputs = $$('input[name="skin-type"]', recommendationForm);
    const concernInputs = $$('input[name="skin-concern"]', recommendationForm);

    function updateRecommendationState() {
      generateButton.disabled = !skinTypeInputs.some((input) => input.checked) ||
        !concernInputs.some((input) => input.checked);
    }
    recommendationForm.addEventListener("change", updateRecommendationState);

    recommendationForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const skinType = skinTypeInputs.find((input) => input.checked)?.value;
      const concerns = concernInputs.filter((input) => input.checked).map((input) => input.value);
      if (!skinType || !concerns.length) return;

      const allergies = $("#recommendation-allergies").value.trim();
      const currentProducts = $("#recommendation-products").value.trim();
      const recommendations = [];
      if (concerns.includes("Dryness") || skinType === "Dry" || skinType === "Sensitive") {
        recommendations.push({
          icon: "🧴",
          name: "Barrier-support moisturizer",
          description: "Look for ceramides, glycerin, or hyaluronic acid. Apply to slightly damp skin.",
          usage: "Use morning and evening",
        });
      }
      if (concerns.includes("Acne") || skinType === "Oily" || skinType === "Combination") {
        recommendations.push({
          icon: "🫧",
          name: "Gentle gel cleanser",
          description: "Choose a mild, fragrance-free cleanser that does not leave the skin tight.",
          usage: "Use once or twice daily",
        });
      }
      if (concerns.includes("Dark spots") || concerns.includes("Wrinkles")) {
        recommendations.push({
          icon: "✨",
          name: "Even-tone serum",
          description: "Consider niacinamide or vitamin C. Patch test first and introduce one product at a time.",
          usage: "Use in the morning or evening as directed",
        });
      }
      if (concerns.includes("Redness") || skinType === "Sensitive") {
        recommendations.push({
          icon: "🌿",
          name: "Soothing fragrance-free formula",
          description: "Look for centella or colloidal oat, and avoid known irritants.",
          usage: "Apply after cleansing",
        });
      }
      recommendations.push({
        icon: "☀️",
        name: "Broad-spectrum SPF 30+",
        description: "Use a daily sunscreen suited to your skin type. Reapply outdoors according to the label.",
        usage: "Use every morning",
      });
      if (allergies) {
        recommendations.forEach((item) => {
          item.description += ` Avoid your noted sensitivity: ${allergies}.`;
        });
      }

      $("#recommendation-empty").hidden = true;
      const output = $("#recommendation-output");
      output.hidden = false;
      output.innerHTML = `
        <h3>Recommended for ${esc(skinType)} skin</h3>
        <p class="recommendation-summary">Concerns: ${esc(concerns.join(", "))}${currentProducts ? `<br />Current products: ${esc(currentProducts)}` : ""}</p>
        ${recommendations.slice(0, 5).map((item) => `
          <article class="recommendation-product">
            <span class="recommendation-product-icon">${item.icon}</span>
            <div><h4>${esc(item.name)}</h4><p>${esc(item.description)}</p><small>${esc(item.usage)}</small></div>
          </article>`).join("")}
        <p class="directory-disclaimer">This routine is general guidance, not a diagnosis or prescription. Stop use and seek professional advice if irritation occurs.</p>`;
      toast("Recommendations ready");
    });
  }

  /* ---------------- dermatologist directory search ---------------- */
  const doctorSearch = $("#doctor-search-input");
  const doctorLocation = $("#doctor-location");
  function filterDoctors(reset = false) {
    if (!doctorSearch || !doctorLocation) return;
    const query = doctorSearch.value.trim().toLowerCase();
    const location = doctorLocation.value;
    setupPagination(
      $("#doctor-grid"),
      $("#doctors-pagination"),
      {
        threshold: 6,
        pageSize: 6,
        reset,
        predicate: (card) => (
          (!query || card.dataset.search.includes(query)) &&
          (location === "Any" || card.dataset.location === location)
        ),
      }
    );
  }
  doctorSearch?.addEventListener("input", () => filterDoctors(true));
  doctorLocation?.addEventListener("change", () => filterDoctors(true));
  document.addEventListener("click", (event) => {
    const profileButton = event.target.closest(".doctor-profile-button");
    if (!profileButton) return;
    const card = profileButton.closest(".doctor-card");
    const details = card?.querySelector(".doctor-profile-details");
    if (!details) return;
    const willOpen = details.hidden;
    details.hidden = !willOpen;
    profileButton.setAttribute("aria-expanded", String(willOpen));
    profileButton.textContent = willOpen ? "Hide profile ↑" : "View profile →";
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

  const pmInfo = document.querySelector(".pm-info");
  const pmToggle = $("#pm-collapse-toggle");
  const pmToggleText = $("#pm-toggle-text");
  function setPmCollapsed(collapsed) {
    pmInfo.classList.toggle("is-collapsed", collapsed);
    pmToggle.setAttribute("aria-expanded", String(!collapsed));
    pmToggleText.textContent = collapsed ? "Show details" : "Hide details";
  }
  pmToggle.addEventListener("click", () => setPmCollapsed(!pmInfo.classList.contains("is-collapsed")));

  const reviewScroller = document.querySelector(".pm-reviews");
  const revealIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in-view"); revealIO.unobserve(en.target); }
    });
  }, { root: reviewScroller, threshold: 0.12 });
  function observeReviews() {
    $$("#pm-review-list .review-card").forEach((c) => { if (!c.classList.contains("in-view")) revealIO.observe(c); });
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
    setPmCollapsed(false);
    pmOverlay.classList.add("is-open");
    pmOverlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    observeReviews();
  }

  function closeProduct() {
    pmOverlay.classList.remove("is-open");
    pmOverlay.setAttribute("aria-hidden", "true");
    if (!progressDetailOverlay.classList.contains("is-open")) document.body.style.overflow = "";
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
    btn.classList.remove("pop");
    void btn.offsetWidth;
    btn.classList.add("pop");
    $$("button", pmStars).forEach((b, i) => {
      b.classList.toggle("lit", i < pmRating);
      if (i < pmRating) gsap.fromTo(b, { scale: 0.6, rotate: -20 }, { scale: 1, rotate: 0, duration: 0.4, delay: i * 0.05, ease: "back.out(3)", clearProps: "transform" });
    });
  });
  pmStars.addEventListener("mouseover", (e) => {
    const btn = e.target.closest("[data-star]");
    if (btn) $$("button", pmStars).forEach((b, i) => b.classList.toggle("lit", i < +btn.dataset.star));
  });
  pmStars.addEventListener("mouseleave", () => {
    $$("button", pmStars).forEach((b, i) => b.classList.toggle("lit", i < pmRating));
  });
  // Peek-Rating style: the stars rise in a wave toward the pointer as it moves across them.
  pmStars.addEventListener("pointermove", (e) => {
    const sigma = 34;
    $$("button", pmStars).forEach((b) => {
      const r = b.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const lift = 10 * Math.exp(-(dx * dx) / (2 * sigma * sigma));
      b.style.transform = `translateY(${-lift}px) scale(${1 + lift / 60})`;
    });
  });
  pmStars.addEventListener("pointerleave", () => {
    $$("button", pmStars).forEach((b) => { b.style.transform = ""; });
  });

  $("#pm-submit").addEventListener("click", () => {
    if (!pmCurrent) return;
    if (!pmRating) { toast("Pick a star rating first"); return; }
    const text = $("#pm-text").value.trim() || "Rating only — no written comments.";
    PRODUCTS[pmCurrent].reviews.unshift({ init: initials, name: displayName, stars: pmRating.toFixed(1), text, meta: "Just now · You" });
    renderPmReviews(PRODUCTS[pmCurrent]);
    $("#pm-text").value = "";
    pmRating = 0;
    $$("#pm-star-input button").forEach((b) => { b.classList.remove("lit"); b.style.transform = ""; });
    observeReviews();
    gsap.fromTo("#pm-review-list .review-card:first-child", { scale: 0.94 }, { scale: 1, duration: 0.5, ease: "back.out(2.4)", clearProps: "transform" });
    toast("Review submitted (demo) ✓");
  });

  /* ---------------- AI analysis flow ---------------- */
  const stepIds = ["step-upload", "step-processing", "step-result"];
  let scanMode = "skincare";
  let scanStepIndex = 0;
  let stepTween = null;
  let processingTL = null;
  let selectedImage = null;
  let predictionResult = null;
  let imagePreviewUrl = null;
  let uploadController = null;
  let activeHistoryEntryId = null;

  function createScanId() {
    return `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function updateProgressButton() {
    const scan = getScans().find((entry) => entry.id === activeHistoryEntryId);
    $("#result-progress-button").textContent = scan?.tracked
      ? "View in progress tracker →"
      : "Track progress →";
  }

  function setProgress() {
    const progress = $("#scan-progress-fill");
    progress.style.width = ((scanStepIndex + 1) / stepIds.length) * 100 + "%";
    progress.parentElement.setAttribute("aria-valuenow", String(scanStepIndex + 1));
  }

  function modeTitle(mode) {
    if (mode === "hair") return "Hair & scalp analysis";
    if (mode === "condition") return "Condition & risk assessment";
    return "Skin care analysis";
  }

  function modePreview(mode) {
    return mode === "skincare" ? "assets/face-scan.png" : "assets/body-scan.png";
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

  function beginScan() {
    scanMode = "skincare";
    resetScanFlow();
    switchView("scan");
    showStep("step-upload");
  }

  function resetScanFlow() {
    if (uploadController) uploadController.abort();
    uploadController = null;
    if (processingTL) processingTL.kill();
    processingTL = null;
    stopWebcam();
    selectedImage = null;
    predictionResult = null;
    activeHistoryEntryId = null;
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = null;
    $("#scan-file-input").value = "";
    $("#symptoms-next").disabled = true;
    $("#quality-check").className = "quality-check";
    $("#quality-status-mark").dataset.status = "waiting";
    $("#quality-text").textContent = "Checking image quality…";
    dropzone.classList.remove("is-scanning");
    $$(".symptom-chip").forEach((chip) => {
      chip.classList.remove("is-picked");
      chip.setAttribute("aria-pressed", "false");
    });
    $("#symptom-location").value = "";
    $("#symptom-onset").value = "";
    $("#symptom-change").value = "";
    $("#symptom-severity").value = "";
    refreshAnimatedDropdown($("#symptom-onset"));
    refreshAnimatedDropdown($("#symptom-change"));
    refreshAnimatedDropdown($("#symptom-severity"));
    $("#symptom-triggers").value = "";
    $("#symptom-notes").value = "";
    $$("#proc-steps li").forEach((li) => {
      li.className = "";
      $(".status-mark", li).dataset.status = "waiting";
      $(".proc-state", li).textContent = "waiting";
    });
    const preview = modePreview(scanMode);
    $("#drop-preview").src = preview;
    $("#proc-preview").src = preview;
    $("#result-confidence").dataset.count = "0";
    $("#result-confidence").textContent = "0";
    $("#result-disease-label").textContent = "Awaiting image";
    $("#result-disease-detail").textContent = "";
    $("#result-cosmetic-label").textContent = "Awaiting image";
    $("#result-cosmetic-detail").textContent = "";
    $("#result-prediction").textContent = "Upload a photo to see the model predictions.";
    $("#result-confidence-detail").textContent = "Model scores will appear here after analysis.";
    $("#result-symptom-summary").replaceChildren();
    $("#result-symptoms-section").hidden = true;
    $("#result-worsening-warning").hidden = true;
    $("#skincare-tips").replaceChildren();
    $("#skincare-tips").hidden = true;
    $("#analysis-products").replaceChildren();
    $("#analysis-products").hidden = true;
    $("#product-results-title").hidden = true;
    $("#product-disclaimer").textContent = "";
    $("#product-disclaimer").hidden = true;
    const doctorButton = $("#result-doctor-button");
    if (doctorButton) doctorButton.hidden = true;
    $("#result-summary").textContent = `${modeTitle(scanMode)} · Ready for review`;
    scanStepIndex = 0;
    setProgress();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (pmOverlay.classList.contains("is-open")) closeProduct();
  });
  document.addEventListener("skinwise:view", (event) => {
    if (event.detail === "scan") return;
    stopWebcam();
  });
  $$("[data-scan-back]").forEach((b) =>
    b.addEventListener("click", () => {
      const prev = stepIds[Math.max(0, scanStepIndex - 1)];
      showStep(prev, -1);
    })
  );
  $("#quick-scan").addEventListener("click", beginScan);
  $("#new-scan-button").addEventListener("click", beginScan);

  /* Upload the selected image to the prediction API. */
  const dropzone = $("#dropzone");
  async function uploadImage(file) {
    if (!file) return;
    if (uploadController) uploadController.abort();
    uploadController = null;
    selectedImage = null;
    predictionResult = null;
    $("#symptoms-next").disabled = true;
    dropzone.classList.remove("is-scanning");
    if (!file.type.startsWith("image/")) {
      $("#quality-check").className = "quality-check show fail";
      $("#quality-status-mark").dataset.status = "fail";
      $("#quality-text").textContent = "Please choose a valid image file.";
      return;
    }

    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    selectedImage = file;
    predictionResult = null;
    imagePreviewUrl = URL.createObjectURL(file);
    $("#drop-preview").src = imagePreviewUrl;
    $("#proc-preview").src = imagePreviewUrl;
    $("#symptoms-next").disabled = true;

    const qc = $("#quality-check");
    const beam = $("#drop-beam");
    qc.className = "quality-check show";
    $("#quality-status-mark").dataset.status = "loading";
    $("#quality-text").textContent = scanMode === "hair"
      ? "Analyzing photo with the hair model…"
      : "Analyzing photo with the skin models…";
    dropzone.classList.add("is-scanning");

    const controller = new AbortController();
    uploadController = controller;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", scanMode);

    gsap.fromTo(beam, { top: "-34%" }, { top: "104%", duration: 1.1, ease: "power1.inOut", repeat: 1, yoyo: true });
    try {
      const endpoint = scanMode === "hair" ? "/api/predict" : "/api/analyze-skin";
      const response = await fetch(endpoint, {
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
      const validScore = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
      const validDualResult = result && result.success === true &&
        result.disease && result.cosmetic &&
        typeof result.disease.label === "string" && typeof result.cosmetic.label === "string" &&
        validScore(result.disease.confidence) && validScore(result.cosmetic.confidence) &&
        typeof result.disease.is_known === "boolean" && typeof result.cosmetic.is_known === "boolean";
      const validHairResult = result && result.success === true &&
        typeof result.predicted_class === "string" && result.predicted_class.trim() &&
        validScore(result.confidence);
      if (scanMode === "hair" ? !validHairResult : !validDualResult) {
        throw new Error("The prediction service returned incomplete prediction data.");
      }
      if (uploadController !== controller) return;

      predictionResult = result;
      dropzone.classList.remove("is-scanning");
      qc.classList.add("pass");
      $("#quality-status-mark").dataset.status = "done";
      $("#quality-text").textContent = "Photo analysis complete. Review your answers, then view results.";
      gsap.fromTo(qc, { scale: 0.96 }, { scale: 1, duration: 0.4, ease: "back.out(2)" });
      $("#symptoms-next").disabled = false;
      gsap.fromTo($("#symptoms-next"), { scale: 0.96 }, { scale: 1, duration: 0.4, ease: "back.out(2)" });
    } catch (error) {
      if (controller.signal.aborted) return;
      dropzone.classList.remove("is-scanning");
      qc.className = "quality-check show fail";
      $("#quality-status-mark").dataset.status = "fail";
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
  /* symptom chips */
  $$(".symptom-chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      const selected = !chip.classList.contains("is-picked");
      if (chip.dataset.symptom === "none" && selected) {
        $$(".symptom-chip").forEach((item) => {
          item.classList.remove("is-picked");
          item.setAttribute("aria-pressed", "false");
        });
      } else if (chip.dataset.symptom !== "none" && selected) {
        const noneChip = $('.symptom-chip[data-symptom="none"]');
        noneChip.classList.remove("is-picked");
        noneChip.setAttribute("aria-pressed", "false");
      }
      chip.classList.toggle("is-picked", selected);
      chip.setAttribute("aria-pressed", String(selected));
      gsap.fromTo(chip, { scale: 0.97 }, { scale: 1, duration: 0.2, ease: "power2.out" });
    })
  );

  function collectSymptoms() {
    return {
      selected: $$(".symptom-chip.is-picked").map((chip) => chip.dataset.symptom),
      location: $("#symptom-location").value.trim(),
      onset: $("#symptom-onset").value,
      change: $("#symptom-change").value,
      severity: $("#symptom-severity").value,
      possibleTriggers: $("#symptom-triggers").value.trim(),
      notes: $("#symptom-notes").value.trim(),
    };
  }

  function renderSymptomSummary(symptoms) {
    const section = $("#result-symptoms-section");
    const list = $("#result-symptom-summary");
    list.replaceChildren();
    if (!symptoms || typeof symptoms !== "object") {
      section.hidden = true;
      return;
    }

    const selected = Array.isArray(symptoms.selected)
      ? symptoms.selected.map((value) => {
        const chip = $$(".symptom-chip").find((item) => item.dataset.symptom === String(value));
        return chip ? chip.textContent.trim() : "";
      }).filter(Boolean)
      : [];
    const answers = [
      ["Symptoms", selected.join(", ")],
      ["Area", symptoms.location],
      ["Started", symptoms.onset],
      ["Changes", symptoms.change],
      ["Severity", symptoms.severity],
      ["Possible triggers", symptoms.possibleTriggers],
      ["Additional notes", symptoms.notes],
    ];
    answers.forEach(([label, value]) => {
      if (typeof value !== "string" || !value.trim()) return;
      const item = document.createElement("li");
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      item.append(strong, document.createTextNode(value));
      list.append(item);
    });
    section.hidden = list.children.length === 0;
  }

  /* processing timeline → result */
  $("#symptoms-next").addEventListener("click", () => {
    if (!selectedImage || !predictionResult) {
      toast("Choose a photo and wait for its analysis to finish.");
      return;
    }
    showStep("step-processing");
    const items = $$("#proc-steps li");
    processingTL = gsap.timeline({ delay: 0.4 });

    items.forEach((li, i) => {
      processingTL.add(() => {
        items.forEach((x) => x.classList.remove("doing"));
        li.classList.add("doing");
        $(".status-mark", li).dataset.status = "loading";
        $(".proc-state", li).textContent = "running…";
        gsap.fromTo(li, { x: 0 }, { x: 6, duration: 0.3 });
      });
      processingTL.to({}, { duration: i === 1 ? 1.6 : 1.0 }); // CNN step takes longer
      processingTL.add(() => {
        li.classList.remove("doing");
        li.classList.add("done");
        $(".status-mark", li).dataset.status = "done";
        $(".proc-state", li).textContent = "done";
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
      "other pigmentation": "Other pigmentation",
      "melasma": "Melasma",
      "pores": "Visible pores",
      "wrinkles": "Wrinkles",
    };
    const dualResult = Boolean(predictionResult?.disease && predictionResult?.cosmetic);
    const selectedResult = dualResult
      ? scanMode === "condition" ? predictionResult.disease : predictionResult.cosmetic
      : null;
    const confidence = predictionResult
      ? Math.round((selectedResult?.confidence ?? predictionResult.confidence) * 100)
      : 0;
    const isUnknown = dualResult
      ? !selectedResult.is_known
      : Boolean(predictionResult && predictionResult.is_known === false);
    const displayLabel = (label) =>
      classNames[label] || String(label || "Unknown / uncertain").replace(/[_-]+/g, " ");
    const describeModel = (result) => {
      const score = Math.round(result.confidence * 100);
      if (!result.is_known) {
        const candidate = displayLabel(result.candidate_label);
        return result.uncertainty_reason === "no_calibrated_threshold"
          ? `Unaccepted candidate: ${candidate} · ${score}% model score · no calibrated OOD threshold is configured.`
          : `Closest candidate: ${candidate} · ${score}% model score · below the calibrated threshold.`;
      }
      return `${score}% top-class model score; this is not a probability of disease.`;
    };

    if (dualResult) {
      $("#result-disease-label").textContent = predictionResult.disease.label === "Unknown / uncertain"
        ? predictionResult.disease.label : displayLabel(predictionResult.disease.label);
      $("#result-disease-detail").textContent = describeModel(predictionResult.disease);
      $("#result-cosmetic-label").textContent = predictionResult.cosmetic.label === "Unknown / uncertain"
        ? predictionResult.cosmetic.label : displayLabel(predictionResult.cosmetic.label);
      $("#result-cosmetic-detail").textContent = describeModel(predictionResult.cosmetic);
      $("#result-prediction").textContent = "The two models classify different image categories; neither output is a diagnosis.";
      $("#result-confidence-detail").textContent = predictionResult.safety?.message || predictionResult.disclaimer;
    } else {
      const candidateName = predictionResult
        ? displayLabel(predictionResult.candidate_class || predictionResult.predicted_class)
        : "No live prediction available. Upload a photo to run an analysis.";
      $("#result-prediction").textContent = predictionResult
        ? isUnknown ? `Unknown / uncertain. Closest candidate: ${candidateName}.` : `Model prediction: ${candidateName}.`
        : candidateName;
      $("#result-confidence-detail").textContent = predictionResult
        ? `Top-class model score: ${confidence}%. This score is not a probability of disease.`
        : "Confidence will appear here after analysis.";
    }
    const highConcern = dualResult
      ? Boolean(predictionResult.safety?.professional_review_recommended)
      : Boolean(predictionResult && scanMode === "condition" && ["mel", "bcc", "akiec"].includes(predictionResult.predicted_class));
    $("#result-summary").textContent = `${modeTitle(scanMode)} · Results ready`;
    const symptomAnswers = collectSymptoms();
    const reportedWorsening = scanMode !== "hair" && symptomAnswers.change === "Getting worse";
    $("#result-worsening-warning").hidden = !reportedWorsening;
    renderSymptomSummary(symptomAnswers);
    const tipsList = $("#skincare-tips");
    tipsList.replaceChildren();
    const skincareTips = dualResult && scanMode === "skincare" && Array.isArray(predictionResult.skincare_tips)
      ? predictionResult.skincare_tips : [];
    skincareTips.forEach((tip) => {
      const item = document.createElement("li");
      item.textContent = tip;
      tipsList.append(item);
    });
    tipsList.hidden = skincareTips.length === 0;
    const productContainer = $("#analysis-products");
    const productDisclaimer = $("#product-disclaimer");
    const recommendationData = dualResult ? predictionResult.product_recommendations : null;
    const recommendedProducts = scanMode === "skincare" && !isUnknown && !highConcern && Array.isArray(recommendationData?.products)
      ? recommendationData.products : [];
    recommendedProducts.forEach((product) => {
      const card = document.createElement("article");
      card.className = "analysis-product";
      const imageFrame = document.createElement("div");
      imageFrame.className = "analysis-product-image";
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      const fallbackImage = "/frontend/assets/products/default-product.svg";
      const imagePath = typeof product.image === "string" &&
        product.image.startsWith("/frontend/assets/products/") &&
        !product.image.split("/").includes("..") && !product.image.includes("\\")
        ? product.image : fallbackImage;
      image.onerror = () => {
        image.onerror = null;
        image.src = fallbackImage;
      };
      image.src = imagePath;
      imageFrame.append(image);
      const content = document.createElement("div");
      content.className = "analysis-product-content";
      const category = document.createElement("span");
      category.textContent = product.category || "Product type";
      const name = document.createElement("h4");
      name.textContent = product.name || "Skincare product type";
      const description = document.createElement("p");
      description.textContent = product.description || "General product information.";
      content.append(category, name, description);
      card.append(imageFrame, content);
      productContainer.append(card);
    });
    productContainer.hidden = recommendedProducts.length === 0;
    $("#product-results-title").hidden = recommendedProducts.length === 0;
    if (recommendedProducts.length) {
      const concernTitle = String(recommendationData.concern || "skin care").replace(/_/g, " ");
      $("#product-results-title").textContent = `Product ideas for ${concernTitle}`;
      productDisclaimer.textContent = predictionResult.product_disclaimer || "Product types are general information, not individualized treatment.";
      productDisclaimer.hidden = false;
    } else {
      productDisclaimer.hidden = true;
    }
    if (isUnknown) {
      $("#result-guidance-title").textContent = "No supported class recognized";
      $("#result-guidance-note").textContent = highConcern
        ? (predictionResult.safety?.message || "A model signal warrants professional review. Product suggestions are withheld.")
        : "This model has not accepted the selected output. No tailored skincare tips are shown; contact a qualified clinician about a changing or concerning area.";
    } else if (highConcern) {
      $("#result-guidance-title").textContent = "Professional assessment recommended";
      $("#result-guidance-note").textContent = predictionResult.safety?.message || "A model signal warrants professional review. It is not a diagnosis or cancer probability; product suggestions are withheld.";
    } else {
      $("#result-guidance-title").textContent = scanMode === "hair"
        ? "Hair & scalp information"
        : "General skincare tips";
      $("#result-guidance-note").textContent = scanMode === "hair"
        ? "This dataset-label prediction is educational, not a diagnosis or treatment recommendation. A clinician can assess hair loss or scalp symptoms."
        : predictionResult.disclaimer || "General information only; these tips are not a diagnosis or treatment plan.";
    }
    const doctorButton = $("#result-doctor-button");
    if (doctorButton) doctorButton.hidden = !(highConcern || reportedWorsening);
    const historyLabel = dualResult
      ? (isUnknown ? "Unknown / uncertain" : displayLabel(selectedResult.label))
      : (isUnknown ? "Unknown / uncertain" : predictionResult ? displayLabel(predictionResult.predicted_class) : "No model result");
    const historyEntry = {
      id: createScanId(),
      mode: scanMode,
      label: historyLabel,
      confidence,
      createdAt: new Date().toISOString(),
      tracked: false,
      concern: Boolean(highConcern || isUnknown),
      symptoms: symptomAnswers,
      guidanceTitle: $("#result-guidance-title").textContent,
      guidanceNote: $("#result-guidance-note").textContent,
      skincareTips,
      productTitle: recommendedProducts.length ? $("#product-results-title").textContent : "",
      products: recommendedProducts.map((product) => ({
        category: product.category || "Product type",
        name: product.name || "Skincare product type",
        description: product.description || "General product information."
      })),
      productDisclaimer: recommendedProducts.length
        ? predictionResult.product_disclaimer || "Product types are general information, not individualized treatment."
        : ""
    };
    if (predictionResult) {
      activeHistoryEntryId = historyEntry.id;
      saveScan(historyEntry);
    }
    updateProgressButton();
    $("#result-confidence").dataset.count = String(confidence);
    $("#result-confidence").dataset.suffix = "%";
    runCounters($("#step-result"));
    drawRing($(".ring-result", $("#step-result")), confidence, 0.3);
    gsap.fromTo($(".result-check"), { scale: 0, rotate: -90 }, { scale: 1, rotate: 0, duration: 0.6, delay: 0.15, ease: "back.out(2)" });
    gsap.fromTo($$("#step-result .result-section"), { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.12, delay: 0.2, ease: "power3.out" });
  }

  /* ---------------- overview charts ---------------- */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const TREND_W = 560;
  const TREND_H = 165;
  const TREND_PAD_X = 14;
  const TREND_PAD_T = 18;
  const TREND_PAD_B = 20;

  function getScans() {
    try {
      const raw = JSON.parse(localStorage.getItem("skinwise.scans") || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch { return []; }
  }

  function smoothPath(coords) {
    let d = `M ${coords[0][0].toFixed(1)} ${coords[0][1].toFixed(1)}`;
    for (let i = 1; i < coords.length; i += 1) {
      const [px, py] = coords[i - 1];
      const [cx, cy] = coords[i];
      const mx = (px + cx) / 2;
      d += ` C ${mx.toFixed(1)} ${py.toFixed(1)}, ${mx.toFixed(1)} ${cy.toFixed(1)}, ${cx.toFixed(1)} ${cy.toFixed(1)}`;
    }
    return d;
  }

  let ghostDrift = null;

  function renderOverviewCharts() {
    const trendBody = $("#trend-body");
    if (!trendBody) return;
    const scans = getScans();

    /* confidence trend — newest 8, plotted oldest → newest */
    const pts = scans.slice(0, 8).reverse();
    const gridG = $("#trend-grid");
    const lineEl = $("#trend-line");
    const areaEl = $("#trend-area");
    const dotsG = $("#trend-dots");
    const xRow = $("#trend-x");

    gridG.innerHTML = "";
    dotsG.innerHTML = "";
    xRow.innerHTML = "";
    lineEl.setAttribute("d", "");
    areaEl.setAttribute("d", "");
    lineEl.classList.remove("is-ghost");
    lineEl.style.strokeDasharray = "";
    lineEl.style.strokeDashoffset = "";
    if (ghostDrift) { ghostDrift.kill(); ghostDrift = null; }

    const innerW = TREND_W - TREND_PAD_X * 2;
    const innerH = TREND_H - TREND_PAD_T - TREND_PAD_B;
    const yFor = (v) => TREND_PAD_T + (1 - v / 100) * innerH;

    [0, 50, 100].forEach((v) => {
      const y = yFor(v);
      const rule = document.createElementNS(SVG_NS, "line");
      rule.setAttribute("x1", TREND_PAD_X);
      rule.setAttribute("x2", TREND_W - TREND_PAD_X);
      rule.setAttribute("y1", y);
      rule.setAttribute("y2", y);
      gridG.appendChild(rule);
      const tag = document.createElementNS(SVG_NS, "text");
      tag.setAttribute("x", TREND_W - TREND_PAD_X);
      tag.setAttribute("y", y - 5);
      tag.setAttribute("text-anchor", "end");
      tag.textContent = v + "%";
      gridG.appendChild(tag);
    });

    const hasTrend = pts.length > 0;
    $("#trend-ghost-note").hidden = hasTrend;
    $("#trend-state").textContent = hasTrend ? "All time" : "Preview";

    if (hasTrend) {
      const confs = pts.map((s) => Math.min(100, Math.max(0, Number(s.confidence) || 0)));
      const xFor = (i) => (pts.length === 1 ? TREND_W / 2 : TREND_PAD_X + (i / (pts.length - 1)) * innerW);
      const coords = confs.map((v, i) => [xFor(i), yFor(v)]);
      const d = smoothPath(coords);
      lineEl.setAttribute("d", d);
      lineEl.style.strokeDasharray = "none";
      lineEl.style.strokeDashoffset = "0";
      const base = TREND_H - TREND_PAD_B;
      areaEl.setAttribute("d", `${d} L ${coords[coords.length - 1][0].toFixed(1)} ${base} L ${coords[0][0].toFixed(1)} ${base} Z`);
      areaEl.style.opacity = "1";

      coords.forEach(([x, y]) => {
        const dot = document.createElementNS(SVG_NS, "circle");
        dot.setAttribute("cx", x.toFixed(1));
        dot.setAttribute("cy", y.toFixed(1));
        dot.setAttribute("r", "4.6");
        dot.style.opacity = "1";
        dotsG.appendChild(dot);
      });

      pts.forEach((s) => {
        const span = document.createElement("span");
        span.textContent = new Date(s.createdAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
        span.style.opacity = "1";
        xRow.appendChild(span);
      });

      const latest = confs[confs.length - 1];
      let note = "your first saved analysis";
      if (confs.length > 1) {
        const diff = Math.round(latest - confs[confs.length - 2]);
        note = diff === 0 ? "unchanged from the previous analysis" : `${diff > 0 ? "+" : ""}${diff} points vs the previous analysis`;
      }
      $("#trend-sub").textContent = `Last 8 analyses · latest model confidence ${Math.round(latest)}%, ${note}.`;
    } else {
      const wave = [];
      for (let i = 0; i <= 5; i += 1) {
        wave.push([TREND_PAD_X + (i / 5) * innerW, TREND_PAD_T + innerH * (0.5 + 0.17 * Math.sin(i * 1.9 + 0.7))]);
      }
      lineEl.setAttribute("d", smoothPath(wave));
      lineEl.classList.add("is-ghost");
      lineEl.style.strokeDasharray = "2 10";
      lineEl.style.strokeDashoffset = "0";
      $("#trend-sub").textContent = "No analyses yet — this line draws itself from your saved scans.";
    }

    /* scan mix donut */
    const total = scans.length;
    const care = scans.filter((s) => s.mode !== "condition").length;
    const condition = total - care;
    const donut = $("#mix-donut");
    donut.classList.toggle("is-empty", total === 0);
    $("#mix-state").textContent = total ? "All time" : "Preview";
    const frac = total ? care / total : 0;
    donut.dataset.mix = frac.toFixed(4);
    donut.style.setProperty("--mix", frac.toFixed(4));
    const totalEl = $("#mix-total");
    totalEl.dataset.count = total;
    totalEl.textContent = total;
    $("#mix-legend").innerHTML = [
      { c: "var(--green)", name: "Skin care & cosmetic", n: care },
      { c: "var(--orange)", name: "Skin condition & risk", n: condition },
    ]
      .map((row) => `<li style="--c:${row.c}"><i></i>${esc(row.name)}<strong>${row.n}</strong></li>`)
      .join("");

    /* most common findings */
    const counts = new Map();
    scans.forEach((s) => {
      const label = String(s.label || "").trim();
      if (label) counts.set(label, (counts.get(label) || 0) + 1);
    });
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6);
    $("#find-state").textContent = top.length ? "All time" : "Preview";
    const findList = $("#find-list");
    if (top.length) {
      const max = top[0][1];
      findList.innerHTML = top
        .map(([label, n]) => `<div class="find-row">
          <span class="find-name" title="${esc(label)}">${esc(label)}</span>
          <span class="find-track"><span class="find-fill" data-w="${Math.round((n / max) * 100)}%" style="width:${Math.round((n / max) * 100)}%"></span></span>
          <span class="find-count">${n}</span>
        </div>`)
        .join("");
    } else {
      findList.innerHTML = [74, 55, 38]
        .map((w) => `<div class="find-row is-ghost">
          <span class="skel skel-name"></span>
          <span class="find-track"><span class="skel skel-fill" style="--w:${w}%"></span></span>
          <span class="skel skel-count"></span>
        </div>`)
        .join("");
    }
  }

  function saveScan(entry) {
    let entries = [];
    try { entries = JSON.parse(localStorage.getItem("skinwise.scans") || "[]"); } catch { entries = []; }
    entries.unshift(entry);
    entries = entries.slice(0, 50);
    localStorage.setItem("skinwise.scans", JSON.stringify(entries));
    renderHistory();
    renderOverviewCharts();
  }

  function renderHistory() {
    let entries = [];
    try { entries = JSON.parse(localStorage.getItem("skinwise.scans") || "[]"); } catch { entries = []; }
    const list = $("#history-list");
    if (!list) return;
    $("#dashboard-scan-count").textContent = entries.length
      ? `${entries.length} saved ${entries.length === 1 ? "analysis" : "analyses"}`
      : "No analyses saved yet.";
    list.innerHTML = entries.length ? entries.map((entry, index) => {
      const date = new Date(entry.createdAt).toLocaleString();
      const title = entry.mode === "hair"
        ? "Hair & scalp analysis"
        : entry.mode === "condition" ? "Skin condition & risk assessment" : "Skin care & cosmetic analysis";
      const status = entry.concern
        ? "Model signal needs professional assessment. No product suggestions were provided."
        : "Model output is informational only and is not a diagnosis.";
      return `<article class="tl-item"><span class="tl-dot"></span><div class="tl-card" role="button" tabindex="0" data-history-index="${index}" aria-label="View saved analysis result"><span class="tl-date">${esc(date)}</span><h3>${esc(title)}</h3><p>${esc(entry.label)} · model confidence ${Number(entry.confidence)}%</p><p>${esc(status)}</p></div></article>`;
    }).join("") : '<article class="card"><h3>No saved analyses yet</h3><p>Start an analysis to add your first report here.</p></article>';
    setupPagination(list, $("#history-pagination"), { threshold: 6, pageSize: 6 });
  }

  function renderProgressList() {
    const list = $("#tracked-scans-list");
    if (!list) return;
    const scans = getScans();
    const trackedScans = scans
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.tracked);
    const scores = trackedScans
      .map(({ entry }) => Number(entry.confidence))
      .filter((score) => Number.isFinite(score));
    $("#progress-tracked-count").textContent = String(trackedScans.length);
    $("#progress-average-score").textContent = scores.length
      ? `${Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)}%`
      : "—";
    $("#progress-latest-date").textContent = trackedScans.length
      ? new Date(trackedScans[0].entry.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : "No scans yet";
    if (!trackedScans.length) {
      list.innerHTML = '<div class="tracked-scans-empty"><span class="tracked-scans-empty-icon" aria-hidden="true">✦</span><strong>Your timeline starts here</strong><p>Open any scan result and choose “Track progress” to add one.</p></div>';
      setupPagination(list, $("#progress-pagination"), { threshold: 6, pageSize: 6 });
      return;
    }

    list.innerHTML = trackedScans.map(({ entry, index }) => {
      const title = entry.mode === "hair"
        ? "Hair & scalp analysis"
        : entry.mode === "condition" ? "Skin condition analysis" : "Skin care analysis";
      const date = new Date(entry.createdAt);
      const day = Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { day: "2-digit" });
      const month = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short" });
      const checkInLabels = { better: "Feeling better", same: "About the same", worse: "Feeling worse", unsure: "Unsure" };
      const checkInSummary = entry.followUp?.change
        ? ` · Check-in: ${checkInLabels[entry.followUp.change] || "Saved"}`
        : "";
      return `<article class="tracked-scan-row">
        <div class="tracked-scan-date"><strong>${esc(day)}</strong><small>${esc(month)}</small></div>
        <div class="tracked-scan-info">
          <strong>${esc(title)}</strong>
          <small>${esc(String(entry.label || "Unknown / uncertain"))} · ${esc(date.toLocaleString())}${esc(checkInSummary)}</small>
        </div>
        <div class="tracked-scan-meta">
          <span class="tracked-scan-score">${Math.round(Number(entry.confidence) || 0)}% match</span>
          <div class="tracked-scan-actions">
            <button class="btn-ghost" type="button" data-progress-detail-index="${index}">View details</button>
            <button class="btn-ghost progress-untrack" type="button" data-untrack-index="${index}" aria-label="Untrack ${esc(title)}">Untrack</button>
          </div>
        </div>
      </article>`;
    }).join("");
    setupPagination(list, $("#progress-pagination"), { threshold: 6, pageSize: 6 });
  }

  function setScanTracked(id, tracked) {
    const scans = getScans();
    const scan = scans.find((entry) => entry.id === id);
    if (!scan || Boolean(scan.tracked) === tracked) return;
    scan.tracked = tracked;
    localStorage.setItem("skinwise.scans", JSON.stringify(scans));
    renderProgressList();
    updateProgressButton();
  }

  const progressDetailOverlay = $("#progress-detail-overlay");
  let progressDetailReturnFocus = null;

  function closeProgressDetail() {
    progressDetailOverlay.classList.remove("is-open");
    progressDetailOverlay.setAttribute("aria-hidden", "true");
    if (!pmOverlay.classList.contains("is-open")) {
      document.body.style.overflow = "";
    }
    const focusTarget = progressDetailReturnFocus && progressDetailReturnFocus.isConnected
      ? progressDetailReturnFocus
      : $("#progress-timeline-title");
    progressDetailReturnFocus = null;
    focusTarget?.focus();
  }

  function openProgressDetail(index) {
    const scans = getScans();
    const entry = scans[index];
    if (!entry || !entry.tracked || !["skincare", "condition", "hair"].includes(entry.mode)) return;
    if (typeof entry.id !== "string" || !entry.id) {
      entry.id = createScanId();
      localStorage.setItem("skinwise.scans", JSON.stringify(scans));
    }
    progressDetailReturnFocus = document.activeElement;
    progressDetailOverlay.dataset.scanIndex = String(index);
    const date = new Date(entry.createdAt);
    const title = entry.mode === "hair"
      ? "Hair & scalp analysis"
      : entry.mode === "condition" ? "Skin condition analysis" : "Skin care analysis";
    const score = Math.max(0, Math.min(100, Math.round(Number(entry.confidence) || 0)));
    $("#progress-detail-date").textContent = Number.isNaN(date.getTime()) ? "Saved analysis" : date.toLocaleString();
    $("#progress-detail-title").textContent = String(entry.label || "Unknown / uncertain");
    $("#progress-detail-mode").textContent = title;
    $("#progress-detail-score").textContent = `${score}%`;
    $("#progress-detail-finding").textContent = String(entry.label || "Unknown / uncertain");
    $("#progress-detail-guidance-title").textContent = String(entry.guidanceTitle || (
      entry.concern ? "Professional assessment recommended" : "About this result"
    ));
    $("#progress-detail-guidance-note").textContent = String(entry.guidanceNote || (
      entry.concern
        ? "This saved result was flagged for professional assessment. It is not a diagnosis."
        : "Care ideas were not saved for this older analysis. This result is informational and is not a diagnosis."
    ));

    const tips = Array.isArray(entry.skincareTips) ? entry.skincareTips : [];
    const tipsSection = $("#progress-detail-tips-section");
    const tipsList = $("#progress-detail-tips");
    tipsList.replaceChildren();
    tips.forEach((tip) => {
      const item = document.createElement("li");
      item.textContent = String(tip);
      tipsList.append(item);
    });
    tipsSection.hidden = tips.length === 0;

    const products = Array.isArray(entry.products) ? entry.products : [];
    const productsSection = $("#progress-detail-products-section");
    const productsList = $("#progress-detail-products");
    productsList.replaceChildren();
    products.forEach((product) => {
      const card = document.createElement("article");
      card.className = "progress-detail-product";
      const category = document.createElement("small");
      category.textContent = String(product.category || "Product type");
      const name = document.createElement("strong");
      name.textContent = String(product.name || "Skincare product type");
      const description = document.createElement("p");
      description.textContent = String(product.description || "General product information.");
      card.append(category, name, description);
      productsList.append(card);
    });
    productsSection.hidden = products.length === 0;
    $("#progress-detail-products-title").textContent = String(entry.productTitle || "Product ideas");
    $("#progress-detail-product-note").textContent = String(entry.productDisclaimer || "");
    const followUp = entry.followUp && typeof entry.followUp === "object" ? entry.followUp : {};
    $("#progress-followup-change").value = typeof followUp.change === "string" ? followUp.change : "";
    $("#progress-followup-duration").value = typeof followUp.duration === "string" ? followUp.duration : "";
    refreshAnimatedDropdown($("#progress-followup-change"));
    refreshAnimatedDropdown($("#progress-followup-duration"));
    $("#progress-followup-products").value = typeof followUp.products === "string" ? followUp.products : "";
    $("#progress-followup-notes").value = typeof followUp.notes === "string" ? followUp.notes : "";
    $("#progress-followup-saved").textContent = followUp.updatedAt
      ? `Last saved ${new Date(followUp.updatedAt).toLocaleString()}`
      : "Not saved yet";
    progressDetailOverlay.classList.add("is-open");
    progressDetailOverlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    $("[data-close-progress-detail]", progressDetailOverlay).focus();
  }

  function openHistoryResult(index) {
    const scans = getScans();
    const entry = scans[index];
    if (!entry || !["skincare", "condition", "hair"].includes(entry.mode)) return;
    const confidence = Number(entry.confidence);
    if (!Number.isFinite(confidence)) return;

    if (typeof entry.id !== "string" || !entry.id) {
      entry.id = createScanId();
      localStorage.setItem("skinwise.scans", JSON.stringify(scans));
    }
    scanMode = entry.mode;
    resetScanFlow();
    activeHistoryEntryId = entry.id;
    switchView("scan");
    showStep("step-result");

    const score = Math.max(0, Math.min(100, Math.round(confidence)));
    const label = String(entry.label || "Unknown / uncertain");
    $("#result-disease-label").textContent = entry.mode === "condition" ? label : "Not included in this analysis";
    $("#result-disease-detail").textContent = entry.mode === "condition" ? `${score}% model score` : "";
    $("#result-cosmetic-label").textContent = entry.mode === "skincare" ? label : "Not included in this analysis";
    $("#result-cosmetic-detail").textContent = entry.mode === "skincare" ? `${score}% model score` : "";
    $("#result-prediction").textContent = "Saved result from your analysis.";
    $("#result-confidence-detail").textContent = `${score}% model confidence. This is informational only, not a diagnosis.`;
    $("#result-summary").textContent = `${modeTitle(entry.mode)} · Saved result`;
    renderSymptomSummary(entry.symptoms);
    $("#result-guidance-title").textContent = entry.guidanceTitle || (entry.concern
      ? "Professional assessment recommended"
      : entry.mode === "hair" ? "Hair & scalp information" : "General care ideas");
    $("#result-guidance-note").textContent = entry.guidanceNote || (entry.concern
      ? "This saved result was flagged for professional assessment. It is not a diagnosis."
      : "Care ideas were not saved for this older analysis. This result is informational and is not a diagnosis.");
    const reportedWorsening = entry.mode !== "hair" && entry.symptoms?.change === "Getting worse";
    $("#result-worsening-warning").hidden = !reportedWorsening;
    const savedDoctorButton = $("#result-doctor-button");
    if (savedDoctorButton) savedDoctorButton.hidden = !(entry.concern || reportedWorsening);
    const tipsList = $("#skincare-tips");
    tipsList.replaceChildren();
    (Array.isArray(entry.skincareTips) ? entry.skincareTips : []).forEach((tip) => {
      const item = document.createElement("li");
      item.textContent = String(tip);
      tipsList.append(item);
    });
    tipsList.hidden = tipsList.children.length === 0;
    const products = Array.isArray(entry.products) ? entry.products : [];
    const productContainer = $("#analysis-products");
    productContainer.replaceChildren();
    products.forEach((product) => {
      const card = document.createElement("article");
      card.className = "analysis-product";
      const category = document.createElement("span");
      category.textContent = String(product.category || "Product type");
      const name = document.createElement("h4");
      name.textContent = String(product.name || "Skincare product type");
      const description = document.createElement("p");
      description.textContent = String(product.description || "General product information.");
      card.append(category, name, description);
      productContainer.append(card);
    });
    productContainer.hidden = products.length === 0;
    const productTitle = $("#product-results-title");
    productTitle.textContent = entry.productTitle || "Product ideas";
    productTitle.hidden = products.length === 0;
    const productDisclaimer = $("#product-disclaimer");
    productDisclaimer.textContent = entry.productDisclaimer || "";
    productDisclaimer.hidden = products.length === 0 || !entry.productDisclaimer;
    $("#result-confidence").dataset.count = String(score);
    $("#result-confidence").dataset.suffix = "%";
    runCounters($("#step-result"));
    drawRing($(".ring-result", $("#step-result")), score, 0.3);
    updateProgressButton();
  }

  const historyList = $("#history-list");
  historyList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-history-index]");
    if (item) openHistoryResult(Number(item.dataset.historyIndex));
  });
  historyList.addEventListener("keydown", (event) => {
    const item = event.target.closest("[data-history-index]");
    if (!item || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openHistoryResult(Number(item.dataset.historyIndex));
  });
  $("#tracked-scans-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-untrack-index]");
    if (button) {
      const scan = getScans()[Number(button.dataset.untrackIndex)];
      if (scan) setScanTracked(scan.id, false);
      return;
    }
    const details = event.target.closest("[data-progress-detail-index]");
    if (details) openProgressDetail(Number(details.dataset.progressDetailIndex));
  });
  $("#progress-followup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const changeSelect = $("#progress-followup-change");
    const changeDropdown = dropdownBySelect.get(changeSelect);
    if (!changeSelect.value) {
      if (changeDropdown) {
        changeDropdown.trigger.setAttribute("aria-invalid", "true");
        changeDropdown.trigger.setAttribute("aria-describedby", changeDropdown.error.id);
        changeDropdown.error.hidden = false;
        changeDropdown.trigger.focus();
      }
      return;
    }
    const scans = getScans();
    const scan = scans[Number(progressDetailOverlay.dataset.scanIndex)];
    if (!scan || !scan.tracked) return;
    scan.followUp = {
      change: $("#progress-followup-change").value,
      duration: $("#progress-followup-duration").value,
      products: $("#progress-followup-products").value.trim(),
      notes: $("#progress-followup-notes").value.trim(),
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem("skinwise.scans", JSON.stringify(scans));
    $("#progress-followup-saved").textContent = "Saved just now";
    renderProgressList();
  });
  progressDetailOverlay.addEventListener("click", (event) => {
    if (event.target === progressDetailOverlay || event.target.closest("[data-close-progress-detail]")) {
      closeProgressDetail();
    }
    if (event.target.closest("[data-untrack-progress-detail]")) {
      const scan = getScans()[Number(progressDetailOverlay.dataset.scanIndex)];
      if (scan) setScanTracked(scan.id, false);
      closeProgressDetail();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && progressDetailOverlay.classList.contains("is-open")) {
      closeProgressDetail();
    }
  });
  $("#result-progress-button").addEventListener("click", () => {
    setScanTracked(activeHistoryEntryId, true);
  });
  renderHistory();

  /* ---------------- bubble menu bridge ---------------- */
  // The React Bits bubble menu (bubble-menu.js) drives navigation through this hook.
  window.skinwiseNav = { switchView, toast, currentView: () => currentView, logout };

  /* ---------------- entrance ---------------- */
  setupPagination($(".product-grid"), $("#products-pagination"), {
    threshold: 8,
    pageSize: 8,
  });
  if ($("#doctor-grid")) filterDoctors(true);

  // Components are already in the DOM by this point, so run immediately
  // rather than waiting for the window load event.
  (function enter() {
    gsap.fromTo(".topbar", { y: -18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, delay: 0.1, ease: "power3.out" });
    const initial = location.hash.replace("#", "");
    if (initial === "scan-start") beginScan();
    else if (initial === "sample-report") {
      beginScan();
      showStep("step-result");
      presentResult();
    }
    else if (initial.startsWith("product-")) openProduct(initial.slice(8));
    else if (initial && initial !== "overview" && $("#view-" + initial)) switchView(initial);
    else animateViewIn($("#view-overview"));
  })();
})();
