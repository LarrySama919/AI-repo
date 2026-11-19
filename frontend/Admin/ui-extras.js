/* Skinwise shared dashboard layer (admin + moderator).
   Adds: confirm dialogs with undo, account menu, notifications (admin),
   product detail panel, logout step, empty states and status animations.
   Loads after admin.js / moderator.js and builds on their markup. */
(() => {
  // Where "Switch to user account" goes. Change to your real user dashboard path.
  const USER_DASHBOARD_URL = "../User/dashboard.html";

  const $ = (selector, root = document) => root.querySelector(selector);
  const app = $("#app");
  if (!app) return;
  const role = app.dataset.profileRole === "moderator" ? "moderator" : "admin";
  const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const icon = (name, extra = "") => `<svg class="ico ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function notify(message) {
    const toast = $("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  /* ---------- Mount shared markup ---------- */
  document.body.insertAdjacentHTML("beforeend", `
    <dialog class="detail-dialog confirm-dialog" id="sw-confirm" aria-labelledby="sw-confirm-title">
      <span class="confirm-mark" id="sw-confirm-mark"></span>
      <h2 id="sw-confirm-title"></h2>
      <p class="muted" id="sw-confirm-copy"></p>
      <div class="action-row"><button class="btn-primary" type="button" id="sw-confirm-ok"></button><button class="btn-ghost" type="button" id="sw-confirm-cancel">Cancel</button></div>
    </dialog>
    <div class="undo-toast" id="sw-undo" role="status" aria-live="polite"><span></span><button type="button">Undo</button></div>
    <div class="scrim" id="sw-scrim"></div>
    <aside class="drawer" id="sw-drawer" aria-label="Product details" aria-hidden="true">
      <header class="drawer-head">
        <div><img class="drawer-img" id="sw-drawer-img" alt="" hidden /><span class="eyebrow"><span class="eyebrow-dot"></span> Selected product</span><h2 id="sw-drawer-name"></h2><p class="muted" id="sw-drawer-sub"></p></div>
        <button class="drawer-close" type="button" data-drawer-close aria-label="Close panel">${icon("close")}</button>
      </header>
      <dl class="drawer-facts" id="sw-drawer-facts"></dl>
      <div class="drawer-actions">
        <button class="drawer-action" type="button" data-drawer="edit">${icon("pencil")}<span><strong>Edit product</strong><small>Change name, price, or description</small></span></button>
        <button class="drawer-action" type="button" data-drawer="reviews">${icon("star")}<span><strong>View product reviews</strong><small>See what customers said</small></span></button>
        <button class="drawer-action is-danger" type="button" data-drawer="delete">${icon("trash")}<span><strong>Archive product</strong><small>Removes it from active listings</small></span></button>
      </div>
    </aside>
    <div class="signed-out" id="sw-signout" role="alertdialog" aria-labelledby="sw-signout-title" aria-hidden="true">
      <div class="signed-out-card">
        <span class="confirm-mark is-good">${icon("check")}</span>
        <h2 id="sw-signout-title">You're logged out</h2>
        <p class="muted">Your ${role} session has ended. Thanks for keeping Skinwise safe.</p>
        <button class="btn-primary" type="button" id="sw-signin">Sign in again</button>
      </div>
    </div>`);

  /* ---------- Dialog helpers ---------- */
  async function closeDialog(dialog) {
    if (!dialog.open) return;
    if (reduce()) { dialog.close(); return; }
    dialog.classList.add("is-closing");
    await sleep(190);
    dialog.classList.remove("is-closing");
    dialog.close();
  }

  const confirmDialog = $("#sw-confirm");
  function ask({ title, copy, ok = "Confirm", danger = false, mark = "alert", reasonChoices }) {
    return new Promise((resolve) => {
      $("#sw-confirm-title").textContent = title;
      $("#sw-confirm-copy").textContent = copy;
      $("#sw-confirm-mark").innerHTML = icon(mark);
      $("#sw-confirm-mark").className = `confirm-mark${danger ? "" : " is-good"}`;
      let reasonField = $(".confirm-reason", confirmDialog);
      if (reasonChoices) {
        if (!reasonField) {
          reasonField = document.createElement("label");
          reasonField.className = "form-field confirm-reason";
          reasonField.innerHTML = "<span></span><select required></select>";
          $("#sw-confirm-copy").after(reasonField);
        }
        reasonField.querySelector("span").textContent = reasonChoices.label;
        const select = reasonField.querySelector("select");
        select.replaceChildren(new Option("Choose a reason", ""));
        reasonChoices.options.forEach((reason) => select.add(new Option(reason, reason)));
        reasonField.hidden = false;
      } else if (reasonField) {
        reasonField.hidden = true;
      }
      const okButton = $("#sw-confirm-ok");
      okButton.textContent = ok;
      okButton.classList.toggle("is-danger", danger);
      const reasonSelect = reasonChoices ? reasonField.querySelector("select") : null;
      okButton.disabled = Boolean(reasonSelect);
      const finish = (value) => {
        closeDialog(confirmDialog);
        resolve(value && reasonSelect ? { reason: reasonSelect.value } : value);
      };
      if (reasonSelect) reasonSelect.addEventListener("change", () => { okButton.disabled = !reasonSelect.value; });
      okButton.onclick = () => finish(!reasonSelect || Boolean(reasonSelect.value));
      $("#sw-confirm-cancel").onclick = () => finish(false);
      confirmDialog.oncancel = (event) => { event.preventDefault(); finish(false); };
      confirmDialog.showModal();
      if (reasonSelect) reasonSelect.focus();
      else okButton.focus();
    });
  }

  function undoToast(message, onUndo) {
    const toast = $("#sw-undo");
    toast.querySelector("span").textContent = message;
    toast.classList.add("show");
    clearTimeout(undoToast.timer);
    toast.querySelector("button").onclick = () => { onUndo(); toast.classList.remove("show"); };
    undoToast.timer = setTimeout(() => toast.classList.remove("show"), 6500);
  }

  /* ---------- Confirm before risky actions (with undo) ---------- */
  const COPY = {
    ban: (name) => ({ title: `Suspend ${name}?`, copy: "They will not be able to sign in until you reactivate the account.", ok: "Suspend user" }),
    demote: (name) => ({ title: `Remove moderator role from ${name}?`, copy: "They become a regular user and lose moderation tools.", ok: "Remove role" }),
    delete: (name) => ({ title: `Archive ${name}?`, copy: "The product will be removed from active listings but kept in the database. You can restore it from the Archived filter.", ok: "Archive product" }),
    "delete-sample-product": (name) => ({ title: `Remove ${name}?`, copy: "This removes the item from the current product view only. It will not change product records stored in the database.", ok: "Remove product" }),
    "remove-review": (name) => ({ title: `Remove ${name}?`, copy: "Remove a review only for a clear platform rule violation. Choose the rule that applies.", ok: "Remove review" }),
    hide: () => ({ title: "Hide this review?", copy: "Only hide a review when it breaks a rule. A low rating or honest criticism is not a reason to hide it. The review will leave the product guide, and you can undo this action.", ok: "Hide review" })
  };

  // admin.js / moderator.js call window.confirm(); we ask first, then let them proceed.
  window.confirm = () => window.__swOk === true;

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || window.__swOk) return;
    const action = button.dataset.action;

    if (action === "logout") {
      event.stopImmediatePropagation();
      closeMenus();
      logout();
      return;
    }
    if (!COPY[action]) return;

    event.stopImmediatePropagation();
    const row = button.closest("tr, .review-entry");
    const name = button.dataset.user || row?.querySelector("td strong, .review-head strong")?.textContent || "this record";
    const confirmation = await ask({
      ...COPY[action](name),
      ok: COPY[action](name).ok,
      danger: true,
      reasonChoices: action === "hide" || action === "remove-review" ? {
        label: "Which rule does this review break?",
        options: ["Spam or advertising", "Abusive or discriminatory language", "Private information", "Unrelated to the product or scan", "Other clear rule violation"]
      } : undefined
    });
    if (!confirmation) return;

    closeDrawer();
    const parent = row?.parentNode;
    const next = row?.nextSibling;
    if (action === "hide" || action === "remove-review") button.dataset.moderationReason = confirmation.reason;
    const leaves = role !== "admin" && row && (action === "delete" || action === "hide" || action === "remove-review" || (action === "demote" && $(".view.is-active")?.id === "view-moderators"));
    if (leaves && !reduce()) { row.classList.add("row-leaving"); await sleep(230); }

    window.__swOk = true;
    button.click();
    window.__swOk = false;

    if (!leaves) return;
    if (row.isConnected) { row.classList.remove("row-leaving"); return; }
    if (action === "demote") return;
    undoToast(action === "delete" ? `${name} deleted.` : action === "remove-review" ? `${name} removed.` : `Review hidden: ${confirmation.reason}.`, () => {
      row.classList.remove("row-leaving");
      delete row.dataset.moderationReason;
      parent.insertBefore(row, next && next.parentNode === parent ? next : null);
      row.classList.add("row-in");
      setTimeout(() => row.classList.remove("row-in"), 700);
    });
  }, true);

  /* ---------- Logout and switch account (flowchart: Logout > End) ---------- */
  async function logout() {
    if (!(await ask({ title: "Log out of Skinwise?", copy: "You'll need to sign in again to continue.", ok: "Log out", mark: "logout", danger: true }))) return;
    for (const storage of [sessionStorage, localStorage]) {
      storage.removeItem("skinwise.access_token");
      storage.removeItem("skinwise.user");
    }
    const screen = $("#sw-signout");
    screen.classList.add("show");
    screen.setAttribute("aria-hidden", "false");
    $("#sw-signin").focus();
  }
  $("#sw-signin").addEventListener("click", () => {
    window.location.assign("../login/login.html");
  });

  async function switchAccount() {
    const label = role === "admin" ? "admin" : "moderator";
    if (!(await ask({ title: "Switch to your user account?", copy: `You'll leave the ${label} workspace and open the regular Skinwise dashboard.`, ok: "Switch account", mark: "switch" }))) return;
    window.location.href = USER_DASHBOARD_URL;
  }

  /* ---------- Account menu (Account Setting: Edit profile / Switch / Logout) ---------- */
  const avatarButton = $(".avatar-btn");
  const menus = [];
  function closeMenus(except) {
    menus.forEach(({ wrap, trigger }) => {
      if (wrap === except) return;
      wrap.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    });
  }
  function registerMenu(wrap, trigger, onOpen) {
    menus.push({ wrap, trigger });
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = !wrap.classList.contains("open");
      closeMenus(wrap);
      wrap.classList.toggle("open", opening);
      trigger.setAttribute("aria-expanded", String(opening));
      if (opening && onOpen) onOpen();
    });
  }

  if (avatarButton) {
    avatarButton.removeAttribute("data-go");
    avatarButton.setAttribute("aria-label", "Open account menu");
    const wrap = document.createElement("div");
    wrap.className = "account";
    avatarButton.before(wrap);
    wrap.append(avatarButton);
    wrap.insertAdjacentHTML("beforeend", `
      <div class="menu account-menu" role="menu">
        <div class="menu-head"><strong id="sw-menu-name"></strong><small id="sw-menu-email"></small></div>
        <button type="button" role="menuitem" data-go="settings">${icon("user-edit")}<span>Edit profile</span></button>
        <button type="button" role="menuitem" data-switch>${icon("switch")}<span>Switch to user account</span></button>
        <hr />
        <button type="button" role="menuitem" class="is-danger" data-action="logout">${icon("logout")}<span>Log out</span></button>
      </div>`);
    registerMenu(wrap, avatarButton, () => {
      $("#sw-menu-name").textContent = $("[data-profile-name]")?.textContent || "";
      $("#sw-menu-email").textContent = $("#profile-form")?.elements.namedItem("email")?.value || "";
    });
    wrap.querySelector("[data-switch]").addEventListener("click", () => { closeMenus(); switchAccount(); });
    wrap.querySelectorAll("[data-go]").forEach((item) => item.addEventListener("click", () => closeMenus()));
  }

  /* ---------- Notifications (admin flowchart: Admin Dashboard > View Notifications) ---------- */
  if (role === "admin") {
    let notices = [];
    const preferenceStorageKey = "skinwise-admin-notification-preferences";
    const defaultPreferences = { reviewReports: true, supportReports: true, issues: true };
    let notificationPreferences = { ...defaultPreferences };
    try {
      const savedPreferences = window.localStorage.getItem(preferenceStorageKey);
      if (savedPreferences) {
        const parsedPreferences = JSON.parse(savedPreferences);
        if (parsedPreferences && typeof parsedPreferences === "object" && !Array.isArray(parsedPreferences)) {
          Object.keys(defaultPreferences).forEach((key) => {
            if (typeof parsedPreferences[key] === "boolean") {
              notificationPreferences[key] = parsedPreferences[key];
            }
          });
        }
      }
    } catch {
      notify("Notification preferences could not be loaded; defaults are being used.");
    }
    const actions = $(".topbar-actions");
    actions.insertAdjacentHTML("afterbegin", `
      <div class="account notif">
        <button class="icon-btn" type="button" id="sw-bell" aria-label="Notifications">${icon("bell")}<b class="badge" id="sw-badge"></b></button>
        <div class="menu notif-menu" role="dialog" aria-label="Notifications">
          <div class="menu-head menu-head-row"><strong>Notifications</strong><button type="button" class="link-btn" id="sw-read-all">Mark all read</button></div>
          <div id="sw-notices"></div>
        </div>
      </div>`);
    const renderNotices = () => {
      const visibleNotices = notices.filter((notice) => notificationPreferences[notice.preference]);
      $("#sw-notices").innerHTML = visibleNotices.length ? visibleNotices.map((n) => `
        <button type="button" class="notice${n.unread ? " is-unread" : ""}" data-go="${n.go}" data-notice="${n.id}">
          <span class="notice-icon">${icon(n.icon)}</span><span><strong>${esc(n.title)}</strong><small>${esc(n.meta)}</small></span>
        </button>`).join("") : `<div class="notification-empty"><strong>No notifications to show</strong><small>There is nothing needing your attention right now.</small></div>`;
      const unread = visibleNotices.filter((n) => n.unread).length;
      const badge = $("#sw-badge");
      badge.textContent = unread ? String(unread) : "";
      badge.hidden = !unread;
      $("#sw-read-all").disabled = !unread;
    };
    document.querySelectorAll("[data-admin-notification]").forEach((input) => {
      const preference = input.dataset.adminNotification;
      if (!(preference in defaultPreferences)) return;
      input.checked = notificationPreferences[preference];
      input.addEventListener("change", () => {
        const previous = notificationPreferences[preference];
        notificationPreferences[preference] = input.checked;
        try {
          window.localStorage.setItem(preferenceStorageKey, JSON.stringify(notificationPreferences));
        } catch {
          notificationPreferences[preference] = previous;
          input.checked = previous;
          notify("Notification preferences could not be saved in this browser.");
          return;
        }
        renderNotices();
        notify(input.checked ? "Notification type enabled." : "Notification type muted.");
      });
    });
    const setNotices = (counts) => {
      notices = [];
      if (counts.reviewReports) notices.push({
        id: "review-reports", preference: "reviewReports", icon: "star",
        title: `${counts.reviewReports} product review reports pending`,
        meta: "Product reviews · from database", go: "reviews", unread: true
      });
      if (counts.issues) notices.push({
        id: "analysis-issues", preference: "issues", icon: "alert",
        title: `${counts.issues} analysis issues need review`,
        meta: "AI analysis · from database", go: "detection-errors", unread: true
      });
      if (counts.supportReports) notices.push({
        id: "support-reports", preference: "supportReports", icon: "flag",
        title: `${counts.supportReports} support reports need attention`,
        meta: "User reports · from database", go: "user-reports", unread: true
      });
      renderNotices();
    };
    window.addEventListener("skinwise-admin-notifications", (event) => setNotices(event.detail || {}));
    setNotices(window.skinwiseAdminNotificationCounts || {});
    const bellWrap = $(".notif");
    registerMenu(bellWrap, $("#sw-bell"));
    $("#sw-notices").addEventListener("click", (event) => {
      const item = event.target.closest("[data-notice]");
      if (!item) return;
      notices.find((n) => n.id === item.dataset.notice).unread = false;
      renderNotices();
      closeMenus();
    });
    $("#sw-read-all").addEventListener("click", () => { notices.forEach((n) => { n.unread = false; }); renderNotices(); });
  }

  document.addEventListener("click", (event) => { if (!event.target.closest(".account")) closeMenus(); });

  /* ---------- Product detail panel (flowchart: Select Product > Edit / Reviews / Delete) ---------- */
  const drawer = $("#sw-drawer");
  const scrim = $("#sw-scrim");
  let drawerRow = null;
  let drawerOpener = null;

  function openDrawer(row, opener) {
    drawerRow = row;
    drawerOpener = opener || null;
    const cells = row.children;
    const name = row.querySelector("td strong")?.textContent || "Product";
    const img = row.querySelector(".product-img");
    $("#sw-drawer-img").hidden = !img;
    if (img) $("#sw-drawer-img").src = img.src;
    $("#sw-drawer-name").textContent = name;
    $("#sw-drawer-sub").textContent = cells[1]?.querySelector("small")?.textContent || "";
    const status = cells[6]?.querySelector(".pill");
    $("#sw-drawer-facts").innerHTML = `
      <div><dt>Description</dt><dd>${esc(cells[2]?.textContent || "—")}</dd></div>
      <div><dt>Category</dt><dd>${esc(cells[3]?.textContent || "—")}</dd></div>
      <div><dt>Price</dt><dd>${esc(cells[4]?.textContent || "—")}</dd></div>
      <div><dt>Reviews</dt><dd>${esc(cells[5]?.textContent || "—")}</dd></div>
      <div><dt>Status</dt><dd><span class="${esc(status?.className || "pill")}">${esc(status?.textContent || "—")}</span></dd></div>`;
    drawer.classList.add("open");
    scrim.classList.add("show");
    drawer.setAttribute("aria-hidden", "false");
    drawer.querySelector("[data-drawer-close]").focus();
  }
  function closeDrawer() {
    if (!drawer.classList.contains("open")) return;
    drawer.classList.remove("open");
    scrim.classList.remove("show");
    drawer.setAttribute("aria-hidden", "true");
    drawerOpener?.focus?.();
  }

  document.addEventListener("click", (event) => {
    const select = event.target.closest('[data-action="select-product"]');
    if (select) { const row = select.closest("tr"); if (row) openDrawer(row, select); return; }
    const row = event.target.closest("#view-products tbody tr");
    if (row && !event.target.closest("button, a, input, select")) row.querySelector('[data-action="select-product"]')?.click();
    if (event.target.closest("[data-drawer-close]") || event.target === scrim) closeDrawer();

    const choice = event.target.closest("[data-drawer]");
    if (!choice || !drawerRow) return;
    const target = drawerRow;
    const name = target.querySelector("td strong")?.textContent || "this product";
    if (choice.dataset.drawer === "edit") { closeDrawer(); target.querySelector('[data-action="edit"]')?.click(); }
    if (choice.dataset.drawer === "delete") target.querySelector('[data-action="delete"]')?.click();
    if (choice.dataset.drawer === "reviews") {
      closeDrawer();
      $('.side-item[data-view="reviews"]')?.click();
      const search = $("#global-search");
      search.value = name;
      search.dispatchEvent(new Event("input", { bubbles: true }));
      notify(`Showing reviews for ${name}.`);
    }
  });

  /* ---------- Search also filters review cards (admin) ---------- */
  $("#global-search")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    $(".view.is-active")?.querySelectorAll(".review-entry").forEach((card) => { card.hidden = !!query && !card.textContent.toLowerCase().includes(query); });
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-view], [data-go]")) return;
    setTimeout(() => { if (!$("#global-search")?.value) document.querySelectorAll(".review-entry[hidden]").forEach((card) => { card.hidden = false; }); });
  });

  /* ---------- Empty states + status-change animation ---------- */
  function syncEmpty() {
    document.querySelectorAll(".table-card, .review-grid").forEach((card) => {
      const items = [...card.querySelectorAll(card.classList.contains("review-grid") ? ".review-entry" : "tbody tr")];
      const none = !items.some((item) => !item.hidden);
      let empty = card.querySelector(":scope > .table-empty");
      if (none && !empty) {
        card.insertAdjacentHTML("beforeend", `<div class="table-empty">${icon("search")}<strong></strong><span></span></div>`);
        empty = card.querySelector(":scope > .table-empty");
      }
      if (!empty) return;
      empty.hidden = !none;
      if (empty.dataset.preserveCopy === "true") return;
      empty.querySelector("strong").textContent = items.length ? "Nothing matches" : "Nothing here yet";
      empty.querySelector("span").textContent = items.length ? "Clear the search or change the filter to see more." : "New items will show up here.";
    });
  }
  function flash(pill) {
    if (reduce()) return;
    pill.classList.remove("pill-flash");
    void pill.offsetWidth;
    pill.classList.add("pill-flash");
  }
  let syncFrame;
  const views = $(".views");
  if (views) {
    new MutationObserver((mutations) => {
      const counting = (node) => (node.nodeType === 1 ? node : node.parentElement)?.closest(".stat-num");
      if (mutations.every((m) => counting(m.target))) return;
      cancelAnimationFrame(syncFrame);
      syncFrame = requestAnimationFrame(syncEmpty);
      mutations.forEach((m) => {
        if (m.type !== "childList") return;
        const pill = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest(".pill");
        if (pill) flash(pill);
      });
    }).observe(views, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
  }
  syncEmpty();

  window.Skinwise = { ask, notify, closeDialog, icon };

  /* ---------- Keyboard ---------- */
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeMenus();
    if (!$("dialog[open]")) closeDrawer();
  });
})();