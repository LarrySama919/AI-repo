/*
// Admin > Datasets, written for people with no IT background.
// Pick a dataset, run a health check, read a plain-language result.
// Demo data only: nothing is sent to a server.
(() => {
  const root = document.querySelector("#view-datasets");
  const UI = window.Skinwise;
  if (!root || !UI) return;
  const $ = (selector, scope = root) => scope.querySelector(selector);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const STATUS = {
    ready: { label: "Checks passed", tone: "good", icon: "check", text: "No problems were found by these basic checks. The technical team still needs to review whether the data is suitable." },
    unchecked: { label: "Not checked yet", tone: "soft", icon: "info", text: "Run a health check before anyone uses this dataset." },
    attention: { label: "Needs attention", tone: "warn", icon: "alert", text: "A few things need fixing. Let the technical team know." }
  };
  const CHECKS = ["All files can be opened", "Every item has the information it needs", "No duplicate items", "Ratings and labels are filled in"];
  const UNITS = { "Skin photos": "photos", "Product reviews": "reviews", Other: "items" };

  const sets = [
    { id: "ham", name: "HAM10000 skin photos", kind: "Skin photos", count: 10015, purpose: "Skin photos that have been labelled by experts. Used to test how well the skin scan recognises different skin conditions.", contents: "Photos, plus a spreadsheet that says what each photo shows.", checked: "Nov 10, 2026", status: "ready", issues: [] },
    { id: "sephora", name: "Sephora products and reviews", kind: "Product reviews", count: 8642, purpose: "Product details and customer reviews. Helps Skinwise show useful insights on product pages.", contents: "Product names, ratings, and written reviews.", checked: "Nov 8, 2026", status: "ready", issues: [] },
    { id: "amazon", name: "Amazon beauty reviews", kind: "Product reviews", count: 12500, purpose: "More customer reviews about beauty products. Used for review insights.", contents: "One review per row, with a star rating and comment.", checked: "Never", status: "unchecked", issues: [{ index: 3, note: "About 3% of reviews (around 375) have no star rating." }] }
  ];
  sets.forEach((ds) => { if (ds.status === "ready") ds.results = CHECKS.map((label) => ({ label, ok: true })); });
  let selectedId = sets[0].id;
  let runningId = null;
  let formTarget = null;

  const unitText = (ds) => `${ds.count.toLocaleString()} ${UNITS[ds.kind] || "items"}`;
  const current = () => sets.find((ds) => ds.id === selectedId);

  function renderList() {
    $("#ds-list").innerHTML = sets.map((ds) => {
      const st = STATUS[ds.status];
      return `<button type="button" class="ds-item${ds.id === selectedId ? " is-selected" : ""}" data-ds-select="${ds.id}">
        <span class="ds-item-icon">${UI.icon(ds.kind === "Skin photos" ? "scan" : "file")}</span>
        <span><strong>${esc(ds.name)}</strong><small>${esc(unitText(ds))} · Last checked ${esc(ds.checked)}</small></span>
        <span class="pill pill-${st.tone}">${st.label}</span></button>`;
    }).join("");
    $("#ds-empty").hidden = sets.length > 0;
  }

  function checkAreaHTML(ds) {
    if (runningId === ds.id) {
      return `<div class="ds-running" role="status"><strong>Checking… please wait</strong><ol>${CHECKS.map((label, i) => `<li data-step="${i}"><span class="ds-tick"></span>${esc(label)}</li>`).join("")}</ol></div>`;
    }
    const results = ds.results;
    const list = results ? `<ul class="ds-results">${results.map((r) => `<li class="${r.ok ? "is-ok" : "is-bad"}">${UI.icon(r.ok ? "check" : "alert")}<span><strong>${esc(r.label)}</strong>${r.note ? `<small>${esc(r.note)}</small>` : ""}</span></li>`).join("")}</ul>` : "";
    const next = ds.status === "attention"
      ? `<div class="ds-next"><strong>What should I do?</strong><p>Do not edit or remove source files. Share this result with the technical team. They can investigate and tell you when to check again.</p><button class="btn-primary" type="button" data-ds-notify ${ds.notified ? "disabled" : ""}>${ds.notified ? "Marked as shared" : "Mark as shared with the team"}</button></div>` : "";
    return `${list}${next}<div class="action-row"><button class="btn-${results ? "ghost" : "primary"}" type="button" data-ds-check>${UI.icon("pulse")}${results ? "Run the check again" : "Run health check"}</button></div><p class="ds-hint">A health check only looks. It never changes or deletes anything.</p>`;
  }

  function renderDetail(animate) {
    const ds = current();
    const box = $("#ds-detail");
    if (!ds) { box.innerHTML = `<div class="table-empty">${UI.icon("database")}<strong>No datasets yet</strong><span>Add a dataset to get started.</span></div>`; return; }
    const st = STATUS[ds.status];
    box.innerHTML = `
      <span class="eyebrow"><span class="eyebrow-dot"></span> Selected dataset</span>
      <h2>${esc(ds.name)}</h2>
      <div class="ds-banner is-${st.tone}">${UI.icon(st.icon)}<div><strong>${st.label}</strong><span>${st.text}</span></div></div>
      <h4>What is it for?</h4><p class="muted">${esc(ds.purpose)}</p>
      <div class="ds-facts"><div><small>Size</small><strong>${esc(unitText(ds))}</strong></div><div><small>What's inside</small><strong>${esc(ds.contents)}</strong></div><div><small>Last checked</small><strong>${esc(ds.checked)}</strong></div></div>
      <h4>Health check</h4>
      <div class="ds-check">${checkAreaHTML(ds)}</div>
      <div class="ds-manage"><button class="table-action" type="button" data-ds-edit>${UI.icon("pencil")} Edit details</button><button class="table-action danger-text" type="button" data-ds-remove>${UI.icon("trash")} Remove from list</button></div>`;
    if (animate) { box.classList.remove("is-changing"); void box.offsetWidth; box.classList.add("is-changing"); }
  }

  async function runCheck() {
    const ds = current();
    if (!ds || runningId) return;
    runningId = ds.id;
    renderDetail(false);
    const steps = [...root.querySelectorAll(".ds-running li")];
    for (const step of steps) { await sleep(reduce() ? 60 : 650); step.classList.add("done"); }
    await sleep(reduce() ? 60 : 350);
    ds.results = CHECKS.map((label, i) => { const issue = ds.issues.find((x) => x.index === i); return { label, ok: !issue, note: issue?.note }; });
    ds.status = ds.issues.length ? "attention" : "ready";
    ds.checked = "Just now";
    ds.notified = false;
    runningId = null;
    renderList();
    renderDetail(true);
    UI.notify(ds.issues.length ? "Check finished. A few things need attention." : "Check finished. Everything looks fine.");
  }

  // ----- Add / edit form -----
  function ensureForm() {
    let dialog = $("#ds-form-dialog", document);
    if (dialog) return dialog;
    document.body.insertAdjacentHTML("beforeend", `
      <dialog class="detail-dialog" id="ds-form-dialog" aria-labelledby="ds-form-title"><form novalidate>
        <button class="dialog-close" type="button" data-ds-close aria-label="Close">${UI.icon("close")}</button>
        <span class="eyebrow"><span class="eyebrow-dot"></span> Datasets</span>
        <h2 id="ds-form-title"></h2><p class="muted">Use plain words. This is what you and your team will see in the list.</p>
        <p class="ds-form-note">This only creates a listing in the prototype. It does not upload files or connect a real dataset.</p>
        <div class="product-form-grid">
          <label class="form-field form-field-wide">Name<input name="name" type="text" maxlength="80" placeholder="e.g. Customer reviews 2026" required /></label>
          <label class="form-field form-field-wide">What is it for?<textarea name="purpose" rows="3" maxlength="300" placeholder="e.g. Reviews used to show insights on product pages"></textarea></label>
          <label class="form-field" data-new-only>What kind of data is it?<select name="kind"><option>Skin photos</option><option>Product reviews</option><option>Other</option></select></label>
          <label class="form-field" data-new-only>How many items?<input name="count" type="number" min="0" step="1" value="0" required /></label>
        </div>
        <p class="form-error" role="alert"></p>
        <div class="action-row"><button class="btn-primary" type="submit"></button><button class="btn-ghost" type="button" data-ds-close>Cancel</button></div>
      </form></dialog>`);
    dialog = $("#ds-form-dialog", document);
    dialog.querySelectorAll("[data-ds-close]").forEach((b) => b.addEventListener("click", () => UI.closeDialog(dialog)));
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); UI.closeDialog(dialog); });
    dialog.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target, error = form.querySelector(".form-error");
      const name = form.name.value.trim();
      const fail = (m) => { error.textContent = m; error.classList.remove("is-visible"); void error.offsetWidth; error.classList.add("is-visible"); };
      if (!name) return fail("Please give the dataset a name.");
      if (formTarget) {
        formTarget.name = name; formTarget.purpose = form.purpose.value.trim() || formTarget.purpose;
        UI.notify("Details saved.");
      } else {
        if (!/^\d+$/.test(form.count.value.trim())) return fail("Enter how many items it has, as a whole number.");
        const ds = { id: `ds-${Date.now()}`, name, kind: form.kind.value, count: Number(form.count.value), purpose: form.purpose.value.trim() || "A new dataset waiting for its first health check.", contents: "Not described yet.", checked: "Never", status: "unchecked", issues: [] };
        sets.push(ds); selectedId = ds.id;
        UI.notify("Dataset added. Run a health check next.");
      }
      UI.closeDialog(dialog);
      renderList(); renderDetail(true);
    });
    return dialog;
  }
  function openForm(ds) {
    formTarget = ds;
    const dialog = ensureForm(), form = dialog.querySelector("form");
    form.reset();
    form.querySelector(".form-error").textContent = "";
    dialog.querySelector("#ds-form-title").textContent = ds ? "Edit dataset details" : "Add a dataset";
    form.querySelector('[type="submit"]').textContent = ds ? "Save details" : "Add dataset";
    dialog.querySelectorAll("[data-new-only]").forEach((el) => { el.hidden = !!ds; });
    if (ds) { form.name.value = ds.name; form.purpose.value = ds.purpose; }
    dialog.showModal();
    form.name.focus();
  }

  root.addEventListener("click", async (event) => {
    const t = event.target.closest("[data-ds-select],[data-ds-check],[data-ds-add],[data-ds-edit],[data-ds-remove],[data-ds-notify]");
    if (!t) return;
    const ds = current();
    if (t.dataset.dsSelect) { if (runningId) return; selectedId = t.dataset.dsSelect; renderList(); renderDetail(true); }
    else if ("dsCheck" in t.dataset) runCheck();
    else if ("dsAdd" in t.dataset) openForm(null);
    else if ("dsEdit" in t.dataset) openForm(ds);
    else if ("dsNotify" in t.dataset) { ds.notified = true; renderDetail(false); UI.notify("Marked as shared in this demo. No message was sent."); }
    else if ("dsRemove" in t.dataset) {
      if (!(await UI.ask({ title: `Remove ${ds.name}?`, copy: "It will disappear from this list. In this demo no files are deleted.", ok: "Remove dataset", danger: true, mark: "trash" }))) return;
      sets.splice(sets.indexOf(ds), 1);
      selectedId = sets[0]?.id;
      renderList(); renderDetail(true);
      UI.notify("Dataset removed from the list.");
    }
  });

  renderList();
  renderDetail(false);
})();
*/
