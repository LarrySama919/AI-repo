(() => {
  const app = document.querySelector("#app");
  const sidebar = document.querySelector("#sidebar");
  const toastEl = document.querySelector("#toast");
  const dialog = document.querySelector("#detail-dialog");
  const productDialog = document.querySelector("#product-dialog");
  const productForm = document.querySelector("#product-form");
  const productFormError = document.querySelector("#product-form-error");
  let editingProductRow = null;
  let productImageData = "";
  let uploadedProductImageData = "";
  let isReadingProductImage = false;
  let toastTimer;

  function notify(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
  }

  const profileForm = document.querySelector("#profile-form");
  const defaultProfile = {
    name: "Skinwise Admin",
    email: "admin@skinwise.example",
    photo: ""
  };
  const profileStorageKey = "skinwise-admin-profile";
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
      ? "AD"
      : initialsParts.slice(0, 2).map((part) => Array.from(part)[0].toUpperCase()).join("") || "AD";
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

  function showProductFormError(message) {
    productFormError.textContent = message;
    productFormError.classList.remove("is-visible");
    if (!message) return;
    void productFormError.offsetWidth;
    productFormError.classList.add("is-visible");
  }

  function openView(name) {
    const view = document.querySelector(`#view-${name}`);
    if (!view) return;
    document.querySelectorAll(".view").forEach((item) => item.classList.toggle("is-active", item === view));
    document.querySelectorAll(".side-item[data-view]").forEach((item) => item.classList.toggle("is-active", item.dataset.view === name));
    document.querySelector("#global-search").value = "";
    document.querySelectorAll(`#view-${name} tbody tr`).forEach((row) => row.hidden = false);
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
    const activeView = document.querySelector(".view.is-active");
    activeView.querySelectorAll("tbody tr").forEach((row) => row.hidden = !row.textContent.toLowerCase().includes(query));
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches(".table-filter")) {
      const filter = event.target.value.toLowerCase();
      event.target.closest(".table-card").querySelectorAll("tbody tr").forEach((row) => {
        row.hidden = filter !== "all" && !`${row.dataset.status || ""} ${row.dataset.role || ""} ${row.textContent}`.toLowerCase().includes(filter);
      });
    }
  });

  const datasets = {
    HAM10000: {
      name: "HAM10000 Skin Lesions", records: "10,015", format: "Images + CSV", status: "Passed",
      note: "94% of the expected information is present. No important file-structure issues were found.", progress: 94,
      purpose: "Example skin images and labels used to evaluate skin-analysis tools.",
      contents: "Skin lesion images and a spreadsheet describing each image."
    },
    Sephora: {
      name: "Sephora Products & Reviews", records: "8,642", format: "CSV", status: "Passed",
      note: "97% of the expected information is present. Product and review fields are available.", progress: 97,
      purpose: "Product and customer feedback examples used for catalog insights.",
      contents: "Product details, ratings, and written customer reviews."
    },
    "Amazon Beauty": {
      name: "Amazon Beauty Reviews", records: "12,500", format: "JSONL", status: "Pending",
      note: "This collection has not been checked yet. Select Check files to review its structure.", progress: 0,
      purpose: "Beauty product feedback examples used for review insights.",
      contents: "One product-review record per line, including ratings and written feedback."
    }
  };
  function selectDataset(item) {
    document.querySelectorAll(".dataset-item").forEach((entry) => entry.classList.toggle("is-selected", entry === item));
    const dataset = datasets[item.dataset.dataset];
    if (!dataset) return;
    document.querySelector("#dataset-name").textContent = dataset.name;
    document.querySelector("#dataset-records").textContent = dataset.records;
    document.querySelector("#dataset-format").textContent = dataset.format;
    document.querySelector("#dataset-status").textContent = dataset.status;
    document.querySelector("#dataset-note").textContent = dataset.note;
    document.querySelector("#dataset-purpose").textContent = dataset.purpose;
    document.querySelector("#dataset-contents").textContent = dataset.contents;
    document.querySelector(".dataset-detail .progress-track span").style.width = `${dataset.progress}%`;
    const detail = document.querySelector(".dataset-detail");
    detail.classList.remove("is-changing");
    void detail.offsetWidth;
    detail.classList.add("is-changing");
  }
  document.querySelectorAll(".dataset-item").forEach((item) => item.addEventListener("click", () => {
    selectDataset(item);
  }));

  function showProductImage(source) {
    const preview = document.querySelector("#product-image-preview");
    preview.hidden = !source;
    if (source) preview.querySelector("img").src = source;
  }

  function openProductForm(row) {
    editingProductRow = row;
    productImageData = row?.querySelector(".product-thumb")?.src || "";
    uploadedProductImageData = "";
    isReadingProductImage = false;
    productForm.reset();
    showProductFormError("");
    document.querySelector("#product-dialog-title").textContent = row ? "Edit product" : "Add a product";
    productForm.querySelector('[name="name"]').value = row?.children[0].querySelector("strong")?.textContent || "";
    productForm.querySelector('[name="description"]').value = row?.dataset.description || "";
    productForm.querySelector('[name="category"]').value = row?.children[1].textContent || "";
    productForm.querySelector('[name="price"]').value = row?.children[2].textContent.replace("$", "") || "";
    showProductImage(productImageData);
    productDialog.showModal();
  }

  function addProductImage(cell, source) {
    if (!source) return;
    const image = document.createElement("img");
    image.className = "product-thumb";
    image.src = source;
    image.alt = "";
    cell.append(image);
  }

  function fillProductRow(row, values, image) {
    row.dataset.description = values.description;
    row.dataset.status = "published";
    row.replaceChildren();

    const productCell = row.insertCell();
    addProductImage(productCell, image);
    const productName = document.createElement("strong");
    productName.textContent = values.name;
    productCell.append(productName);
    const description = document.createElement("small");
    description.textContent = values.description;
    productCell.append(description);
    row.insertCell().textContent = values.category;
    row.insertCell().textContent = `$${Number(values.price).toFixed(2)}`;
    row.insertCell().textContent = "—";
    const status = document.createElement("span");
    status.className = "pill pill-good";
    status.textContent = "Published";
    row.insertCell().append(status);
    const actions = row.insertCell();
    [["Select", "select-product", ""], ["Edit", "edit", ""], ["Delete", "delete", "danger-text"]].forEach(([label, actionName, className]) => {
      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = `table-action ${className}`.trim();
      actionButton.dataset.action = actionName;
      actionButton.textContent = label;
      actions.append(actionButton);
    });
  }

  const productImageInput = productForm.querySelector('[name="image"]');
  const productImageUrl = productForm.querySelector('[name="imageUrl"]');
  productImageInput.addEventListener("change", () => {
    const file = productImageInput.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      productImageInput.value = "";
      showProductFormError("Choose a valid image file.");
      return;
    }
    const reader = new FileReader();
    isReadingProductImage = true;
    reader.addEventListener("load", () => {
      isReadingProductImage = false;
      uploadedProductImageData = String(reader.result);
      productImageData = productImageUrl.value || uploadedProductImageData;
      showProductImage(productImageData);
    });
    reader.addEventListener("error", () => {
      isReadingProductImage = false;
      showProductFormError("The selected image could not be read. Try another image.");
    });
    reader.readAsDataURL(file);
  });
  productImageUrl.addEventListener("input", () => {
    productImageData = productImageUrl.value || uploadedProductImageData || editingProductRow?.querySelector(".product-thumb")?.src || "";
    showProductImage(productImageData);
  });
  productForm.addEventListener("submit", (event) => {
    event.preventDefault();
    showProductFormError("");
    if (!productForm.checkValidity()) {
      const invalidField = productForm.querySelector(":invalid");
      const label = invalidField?.closest(".form-field")?.childNodes[0]?.textContent.trim() || "required field";
      showProductFormError(`Please check the ${label.toLowerCase()} field.`);
      productForm.reportValidity();
      return;
    }
    if (isReadingProductImage) {
      showProductFormError("Wait for the product image to finish loading, then save again.");
      return;
    }
    if (!productImageData && !editingProductRow) {
      showProductFormError("Add a product image using an image file or a link.");
      return;
    }
    if (productImageUrl.value) {
      try {
        const imageUrl = new URL(productImageUrl.value);
        if (imageUrl.protocol !== "http:" && imageUrl.protocol !== "https:") throw new Error("Unsupported image link");
      } catch {
        showProductFormError("Enter a valid http or https image link.");
        return;
      }
    }

    const values = Object.fromEntries(new FormData(productForm).entries());
    const row = editingProductRow || document.querySelector("#view-products tbody").insertRow();
    fillProductRow(row, values, productImageData);
    const wasNewProduct = !editingProductRow;
    closeAnimatedDialog(productDialog);
    notify(wasNewProduct ? "Product added to this demo list." : "Product updated in this demo.");
  });
  document.querySelectorAll("[data-close-product]").forEach((button) => button.addEventListener("click", () => closeAnimatedDialog(productDialog)));
  [dialog, productDialog].forEach((target) => target.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAnimatedDialog(target);
  }));
  productDialog.addEventListener("close", () => {
    productForm.reset();
    showProductImage("");
    editingProductRow = null;
    productImageData = "";
    uploadedProductImageData = "";
    isReadingProductImage = false;
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const row = button.closest("tr, .review-entry");
    const name = button.dataset.user || row?.querySelector("td strong, .review-head strong")?.textContent || "this record";

    if (action === "details") {
      document.querySelector("#dialog-title").textContent = name;
      document.querySelector("#dialog-copy").textContent = "Sample account and activity details. This admin dashboard is a frontend prototype and is not connected to a live database.";
      dialog.showModal();
      return;
    }
    if (action === "ban" || action === "demote" || action === "delete" || action === "hide") {
      const prompt = action === "ban" ? "Ban this user?" : action === "demote" ? "Remove this moderator role?" : action === "delete" ? "Delete this product?" : "Hide this review?";
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
    if (action === "promote" || action === "demote") {
      if (row) {
        if (action === "demote" && document.querySelector(".view.is-active").id === "view-moderators") {
          row.remove();
          notify(`${name} demoted to user in this demo.`);
          return;
        }
        row.dataset.role = action === "promote" ? "moderator" : "user";
        const roleCell = row.children[3];
        if (roleCell) roleCell.textContent = action === "promote" ? "Moderator" : "User";
      }
      button.textContent = action === "promote" ? "Demote" : "Promote";
      button.dataset.action = action === "promote" ? "demote" : "promote";
      button.classList.toggle("danger-text", action === "promote");
      notify(`${name} ${action === "promote" ? "promoted to moderator" : "demoted to user"} in this demo.`);
      return;
    }
    if (action === "select-product") {
      document.querySelectorAll("#view-products tbody tr").forEach((entry) => entry.classList.toggle("selected-row", entry === row));
      notify(`${name} selected.`);
      return;
    }
    if (action === "delete" || action === "hide") {
      row?.remove();
      notify(action === "delete" ? "Product removed from this demo list." : "Review hidden in this demo.");
      return;
    }
    if (action === "approve" || action === "resolve") {
      const status = row?.querySelector(".pill");
      if (status) {
        status.textContent = action === "approve" ? "Approved" : "Resolved";
        status.className = "pill pill-good";
      } else {
        button.textContent = "Reviewed";
        button.disabled = true;
      }
      notify(action === "approve" ? "Review approved in this demo." : "Item marked as reviewed.");
      return;
    }
    if (action === "validate") {
      document.querySelector("#dataset-status").textContent = "Passed";
      document.querySelector("#dataset-note").textContent = "File check complete. Required information and file structure passed in this demo.";
      const selectedDataset = document.querySelector(".dataset-item.is-selected");
      if (selectedDataset) {
        const dataset = datasets[selectedDataset.dataset.dataset];
        dataset.status = "Passed";
        dataset.note = document.querySelector("#dataset-note").textContent;
        dataset.progress = 100;
        document.querySelector(".dataset-detail .progress-track span").style.width = "100%";
        selectedDataset.querySelector(".pill").textContent = "Validated";
        selectedDataset.querySelector(".pill").className = "pill pill-good";
      }
      notify("File check completed in this demo.");
      return;
    }
    if (action === "edit") {
      if (row) openProductForm(row);
      return;
    }
    if (action === "add-product") {
      openProductForm(null);
      return;
    }
    if (action === "add-dataset") {
      const name = window.prompt("Dataset name:");
      if (name === null || !name.trim()) return;
      const records = window.prompt("Number of records:", "0");
      if (records === null || !/^\d+$/.test(records.trim())) {
        if (records !== null) notify("Enter a valid record count.");
        return;
      }
      const format = window.prompt("Dataset format:", "CSV");
      if (format === null || !format.trim()) return;
      const datasetId = `dataset-${Date.now()}`;
      datasets[datasetId] = {
        name: name.trim(),
        records: Number(records).toLocaleString(),
        format: format.trim(),
        status: "Pending",
        note: "This collection has not been checked yet. Select Check files to review its structure.",
        purpose: "A new collection of examples added for review.",
        contents: `The dataset contains ${Number(records).toLocaleString()} examples in ${format.trim()} format.`,
        progress: 0
      };
      const item = document.createElement("button");
      item.type = "button";
      item.className = "dataset-item";
      item.dataset.dataset = datasetId;
      item.innerHTML = '<span class="dataset-symbol">▤</span><span><strong></strong><small></small></span><span class="pill pill-warn">Needs validation</span>';
      item.querySelector("strong").textContent = name.trim();
      item.querySelector("small").textContent = `${Number(records).toLocaleString()} records · Added just now`;
      item.classList.add("dataset-item-entering");
      item.addEventListener("animationend", () => item.classList.remove("dataset-item-entering"), { once: true });
      item.addEventListener("click", () => selectDataset(item));
      document.querySelector(".dataset-list").append(item);
      selectDataset(item);
      notify("Dataset added to this demo list.");
      return;
    }
    if (action === "manage-dataset") {
      const selectedDataset = document.querySelector(".dataset-item.is-selected");
      const dataset = selectedDataset && datasets[selectedDataset.dataset.dataset];
      document.querySelector("#dialog-title").textContent = "How dataset management works";
      document.querySelector("#dialog-copy").textContent = dataset
        ? `${dataset.name} contains ${dataset.records} examples in ${dataset.format} format. ${dataset.purpose} Select Check files to confirm that the collection has the expected information. In this demo, validation only updates the status shown here; it does not edit files or train the AI.`
        : "Select a dataset to learn how it is used and checked.";
      dialog.showModal();
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
  const initialView = location.hash.slice(1);
  if (initialView && document.querySelector(`#view-${initialView}`)) openView(initialView);
  else animateCounters(document.querySelector(".view.is-active"));
})();
