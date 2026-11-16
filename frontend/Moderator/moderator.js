(() => {
  const app = document.querySelector("#app");
  const sidebar = document.querySelector("#sidebar");
  const toastEl = document.querySelector("#toast");
  const dialog = document.querySelector("#detail-dialog");
  let toastTimer;

  function notify(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
  }

  const profileForm = document.querySelector("#profile-form");
  const defaultProfile = {
    name: "Skinwise Moderator",
    email: "moderator@skinwise.example",
    photo: ""
  };
  const profileStorageKey = "skinwise-moderator-profile";
  let currentProfile = { ...defaultProfile };
  let profilePhotoData = "";
  let profilePhotoReader = null;
  const profilePhotoInput = profileForm.elements.namedItem("photo");
  const removeProfilePhotoButton = document.querySelector("[data-profile-remove-photo]");

  function normalizeProfile(savedProfile) {
    if (!savedProfile || typeof savedProfile !== "object" || Array.isArray(savedProfile)) return { ...defaultProfile };
    const photo = typeof savedProfile.photo === "string"
      && savedProfile.photo.length <= 1400000
      && /^data:image\/(?:png|jpeg|webp);base64,/i.test(savedProfile.photo)
      ? savedProfile.photo
      : "";
    return {
      name: typeof savedProfile.name === "string" && savedProfile.name.trim() ? savedProfile.name.trim() : defaultProfile.name,
      email: typeof savedProfile.email === "string" && savedProfile.email.trim() ? savedProfile.email.trim() : defaultProfile.email,
      photo
    };
  }

  function renderProfilePhoto(photo) {
    document.querySelectorAll("[data-profile-photo]").forEach((image) => {
      image.hidden = !photo;
      if (photo) image.src = photo;
      else image.removeAttribute("src");
    });
    removeProfilePhotoButton.hidden = !photo;
  }

  function renderProfile(profile) {
    profileForm.elements.namedItem("name").value = profile.name;
    profileForm.elements.namedItem("email").value = profile.email;
    document.querySelectorAll("[data-profile-name]").forEach((element) => {
      element.textContent = profile.name;
    });
    const nameParts = profile.name.trim().split(/\s+/).filter(Boolean);
    const initialsParts = nameParts[0]?.toLowerCase() === "skinwise" ? nameParts.slice(1) : nameParts;
    const initials = profile.name === defaultProfile.name
      ? "MO"
      : initialsParts.slice(0, 2).map((part) => Array.from(part)[0].toUpperCase()).join("") || "MO";
    document.querySelectorAll("[data-profile-avatar]").forEach((element) => {
      element.querySelector("[data-profile-initials]").textContent = initials;
    });
    profilePhotoData = profile.photo;
    renderProfilePhoto(profilePhotoData);
  }

  try {
    const savedProfile = window.localStorage.getItem(profileStorageKey);
    if (savedProfile) currentProfile = normalizeProfile(JSON.parse(savedProfile));
  } catch {
    notify("Saved profile could not be loaded. The default profile is shown.");
  }
  renderProfile(currentProfile);

  profilePhotoInput.addEventListener("change", () => {
    if (profilePhotoReader) {
      const previousReader = profilePhotoReader;
      profilePhotoReader = null;
      previousReader.abort();
    }
    const file = profilePhotoInput.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      profilePhotoInput.value = "";
      notify("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 1024 * 1024) {
      profilePhotoInput.value = "";
      notify("Choose an image smaller than 1 MB.");
      return;
    }

    const reader = new FileReader();
    profilePhotoReader = reader;
    reader.addEventListener("load", () => {
      if (profilePhotoReader !== reader) return;
      profilePhotoReader = null;
      if (typeof reader.result !== "string") {
        notify("The selected photo could not be read. Choose another image.");
        return;
      }
      profilePhotoData = reader.result;
      renderProfilePhoto(profilePhotoData);
      notify("Photo selected. Save your profile to keep it.");
    });
    reader.addEventListener("error", () => {
      if (profilePhotoReader !== reader) return;
      profilePhotoReader = null;
      notify("The selected photo could not be read. Choose another image.");
    });
    reader.readAsDataURL(file);
  });

  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!profileForm.reportValidity()) return;
    if (profilePhotoReader) {
      notify("Wait for the profile photo to finish loading, then save again.");
      return;
    }
    const formData = new FormData(profileForm);
    const updatedProfile = {
      name: String(formData.get("name") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      photo: profilePhotoData
    };
    if (!updatedProfile.name) {
      profileForm.elements.namedItem("name").focus();
      notify("Enter a name before saving your profile.");
      return;
    }

    currentProfile = updatedProfile;
    renderProfile(currentProfile);
    try {
      window.localStorage.setItem(profileStorageKey, JSON.stringify(currentProfile));
      notify("Profile saved in this browser demo.");
    } catch {
      notify("Profile updated for this visit, but browser storage is unavailable.");
    }
  });
  removeProfilePhotoButton.addEventListener("click", () => {
    if (profilePhotoReader) {
      const reader = profilePhotoReader;
      profilePhotoReader = null;
      reader.abort();
    }
    profilePhotoInput.value = "";
    profilePhotoData = "";
    renderProfilePhoto("");
    notify("Photo removed. Save your profile to keep the change.");
  });
  document.querySelector("[data-profile-reset]").addEventListener("click", () => {
    if (profilePhotoReader) {
      const reader = profilePhotoReader;
      profilePhotoReader = null;
      reader.abort();
    }
    profilePhotoInput.value = "";
    renderProfile(currentProfile);
    notify("Unsaved profile changes discarded.");
  });

  function animateCounters(view) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    view.querySelectorAll(".stat-num").forEach((counter) => {
      if (counter.dataset.countAnimated) return;
      const finalText = counter.textContent.trim();
      const match = finalText.match(/^([+-]?)([\d,]+)(\.\d+)?(%|s)?$/);
      if (!match) return;

      const decimals = match[3] ? match[3].length - 1 : 0;
      const target = Number(`${match[1]}${match[2].replace(/,/g, "")}${match[3] || ""}`);
      const sign = target < 0 ? "-" : match[1] === "+" ? "+" : "";
      const magnitude = Math.abs(target);
      const startedAt = performance.now();
      counter.dataset.countAnimated = "true";

      function tick(now) {
        const progress = Math.min((now - startedAt) / 700, 1);
        const eased = 1 - (1 - progress) ** 3;
        const current = magnitude * eased;
        const formatted = new Intl.NumberFormat(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals
        }).format(current);
        counter.textContent = `${sign}${formatted}${match[4] || ""}`;
        if (progress < 1) window.requestAnimationFrame(tick);
      }

      window.requestAnimationFrame(tick);
    });
  }

  function closeAnimatedDialog(target) {
    if (!target.open || target.classList.contains("is-closing")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      target.close();
      return;
    }

    function finishClose(event) {
      if (event.target !== target || event.animationName !== "dialog-out") return;
      target.removeEventListener("animationend", finishClose);
      target.classList.remove("is-closing");
      target.close();
    }

    target.addEventListener("animationend", finishClose);
    target.classList.add("is-closing");
  }

  function openView(name) {
    const view = document.querySelector(`#view-${name}`);
    if (!view) return;
    document.querySelectorAll(".view").forEach((item) => item.classList.toggle("is-active", item === view));
    document.querySelectorAll(".side-item[data-view]").forEach((item) => item.classList.toggle("is-active", item.dataset.view === name));
    document.querySelector("#global-search").value = "";
    view.querySelectorAll("tbody tr").forEach((row) => row.hidden = false);
    history.replaceState(null, "", `#${name}`);
    sidebar.classList.remove("open");
    animateCounters(view);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) window.scrollTo(0, 0);
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.querySelectorAll(".side-item[data-view]").forEach((button) => button.addEventListener("click", () => openView(button.dataset.view)));
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-go]");
    if (target) openView(target.dataset.go);
  });
  const collapseButton = document.querySelector("#collapse-btn");
  collapseButton.addEventListener("click", () => {
    const collapsed = app.classList.toggle("collapsed");
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
    collapseButton.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    collapseButton.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  });
  document.querySelector("#menu-toggle").addEventListener("click", () => sidebar.classList.toggle("open"));
  document.querySelector("#global-search").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelector(".view.is-active").querySelectorAll("tbody tr").forEach((row) => row.hidden = !row.textContent.toLowerCase().includes(query));
  });
  document.addEventListener("change", (event) => {
    if (!event.target.matches(".table-filter")) return;
    const filter = event.target.value.toLowerCase();
    event.target.closest(".table-card").querySelectorAll("tbody tr").forEach((row) => {
      row.hidden = filter !== "all" && !`${row.dataset.status || ""} ${row.textContent}`.toLowerCase().includes(filter);
    });
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const row = button.closest("tr");
    const name = button.dataset.user || row?.querySelector("td strong")?.textContent || "this record";

    if (action === "details") {
      document.querySelector("#dialog-title").textContent = name;
      document.querySelector("#dialog-copy").textContent = "Sample account and report details. This moderator workspace is a frontend prototype and is not connected to a live database.";
      dialog.showModal();
      return;
    }
    if (action === "ban" || action === "delete" || action === "hide") {
      const prompt = action === "ban" ? "Ban this user?" : action === "delete" ? "Delete this product?" : "Hide this review?";
      if (!window.confirm(prompt)) return;
    }
    if (action === "ban" || action === "unban") {
      const banned = action === "ban";
      const status = row?.querySelector(".pill");
      if (status) {
        status.textContent = banned ? "Banned" : "Active";
        status.className = `pill ${banned ? "pill-warn" : "pill-good"}`;
        row.dataset.status = banned ? "banned" : "active";
      }
      button.textContent = banned ? "Unban" : "Ban";
      button.dataset.action = banned ? "unban" : "ban";
      button.classList.toggle("danger-text", !banned);
      notify(`${name} ${banned ? "banned" : "unbanned"} in this demo.`);
      return;
    }
    if (action === "select-product") {
      document.querySelectorAll("#view-products tbody tr").forEach((entry) => entry.classList.toggle("selected-row", entry === row));
      notify(`${name} selected.`);
      return;
    }
    if (action === "edit") {
      const priceCell = row?.children[2];
      if (!priceCell) return;
      const updatedPrice = window.prompt(`Update price for ${name}:`, priceCell.textContent.replace("$", ""));
      if (updatedPrice === null) return;
      if (!/^\d+(\.\d{1,2})?$/.test(updatedPrice.trim())) {
        notify("Enter a valid product price.");
        return;
      }
      priceCell.textContent = `$${Number(updatedPrice).toFixed(2)}`;
      notify(`${name} updated in this demo.`);
      return;
    }
    if (action === "delete" || action === "hide") {
      row?.remove();
      notify(action === "delete" ? "Product deleted from this demo list." : "Review hidden in this demo.");
      return;
    }
    if (action === "approve" || action === "resolve") {
      const status = row?.querySelector(".pill");
      if (status) {
        status.textContent = action === "approve" ? "Approved" : "Resolved";
        status.className = "pill pill-good";
      }
      button.textContent = action === "approve" ? "Approved" : "Reviewed";
      button.disabled = true;
      notify(action === "approve" ? "Review approved in this demo." : "Report marked as reviewed.");
      return;
    }
    if (action === "export") {
      const table = document.querySelector(".view.is-active table");
      if (!table) {
        notify("No tabular data is available to export in this view.");
        return;
      }
      const csv = [...table.rows].map((tr) => [...tr.cells].map((cell) => `"${cell.innerText.replace(/"/g, '""').replace(/\s+/g, " ").trim()}"`).join(",")).join("\r\n");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      link.download = `${document.querySelector(".view.is-active").dataset.title.toLowerCase().replace(/\s+/g, "-")}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      notify("CSV export downloaded.");
      return;
    }
    if (action === "logout") notify("Logout is not connected in this frontend prototype.");
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => closeAnimatedDialog(dialog)));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAnimatedDialog(dialog);
  });
  const initialView = location.hash.slice(1);
  if (initialView && document.querySelector(`#view-${initialView}`)) openView(initialView);
  else animateCounters(document.querySelector(".view.is-active"));
})();
