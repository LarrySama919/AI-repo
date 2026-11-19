(() => {
  const authStorage = sessionStorage.getItem("skinwise.access_token") ? sessionStorage : localStorage;
  const accessToken = authStorage.getItem("skinwise.access_token");
  const adminApiBase = (window.SKINWISE_ADMIN_API_BASE
    || `${window.location.protocol}//${window.location.hostname}:8001`).replace(/\/+$/, "");
  let signedInUser = null;
  try {
    signedInUser = JSON.parse(authStorage.getItem("skinwise.user") || "null");
  } catch {
    signedInUser = null;
  }
  if (!accessToken || signedInUser?.role !== "admin") {
    authStorage.removeItem("skinwise.access_token");
    authStorage.removeItem("skinwise.user");
    window.location.replace("../login/login.html");
    return;
  }

  const app = document.querySelector("#app");
  const sidebar = document.querySelector("#sidebar");
  const toastEl = document.querySelector("#toast");
  const dialog = document.querySelector("#detail-dialog");
  const productDialog = document.querySelector("#product-dialog");
  const productForm = document.querySelector("#product-form");
  const productFormError = document.querySelector("#product-form-error");
  let editingProductRow = null;
  let toastTimer;
  let reviewPage = 1;
  let reviewTotalPages = 1;
  let reviewPageSize = 10;

  async function adminApi(path, options = {}) {
    const response = await fetch(`${adminApiBase}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (response.status === 401 || response.status === 403) {
      authStorage.removeItem("skinwise.access_token");
      authStorage.removeItem("skinwise.user");
      window.location.replace("../login/login.html");
      throw new Error("Your admin session has ended. Please sign in again.");
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || "The admin request could not be completed.");
    }
    return response;
  }

  async function adminJson(path, method, data) {
    const response = await adminApi(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return response.status === 204 ? null : response.json();
  }

  const numberFormat = new Intl.NumberFormat();
  const demoProducts = [
    {
      product_id: "demo-hydra",
      product_name: "Hydra Barrier Cream",
      description: "Ceramide-rich cream for dry, compromised barriers.",
      category: "Moisturizer",
      price: 24,
      currency: "USD",
      review_count: 1284,
      rating: 4.8,
      demo_emoji: "🧴",
    },
    {
      product_id: "demo-spf",
      product_name: "Mineral SPF 50",
      description: "Lightweight daily sunscreen, no white cast.",
      category: "Sunscreen",
      price: 18.5,
      currency: "USD",
      review_count: 2041,
      rating: 4.9,
      demo_emoji: "☀️",
    },
    {
      product_id: "demo-cleanser",
      product_name: "Gentle Gel Cleanser",
      description: "pH-balanced cleanser for sensitive skin.",
      category: "Cleanser",
      price: 14,
      currency: "USD",
      review_count: 876,
      rating: 4.6,
      demo_emoji: "🫧",
    },
    {
      product_id: "demo-calm",
      product_name: "Calm Soothing Gel",
      description: "Centella gel for irritated or rash-prone areas.",
      category: "Treatment",
      price: 16,
      currency: "USD",
      review_count: 654,
      rating: 4.7,
      demo_emoji: "🌿",
    },
  ].map((product) => ({ ...product, is_demo: true, is_active: true }));
  let currentAdminUserId = Number(signedInUser.user_id || signedInUser.id || 0);

  function formatDate(value, includeTime = false) {
    if (!value) return "—";
    const parsed = new Date(value.endsWith("Z") ? value : `${value}Z`);
    if (Number.isNaN(parsed.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, includeTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" }).format(parsed);
  }

  function setStats(view, values, labels) {
    const cards = document.querySelectorAll(`#view-${view} .stat`);
    cards.forEach((card, index) => {
      const number = card.querySelector(".stat-num");
      const label = card.querySelector("p");
      if (number && values[index] !== undefined) number.textContent = values[index];
      if (label && labels[index]) label.textContent = labels[index];
      const sub = card.querySelector(".stat-sub");
      if (sub) sub.hidden = true;
    });
  }

  function addTextCell(row, value, { strong = false, secondary = "" } = {}) {
    const cell = document.createElement("td");
    const content = strong ? document.createElement("strong") : document.createElement("span");
    content.textContent = value == null || value === "" ? "—" : String(value);
    cell.append(content);
    if (secondary) {
      const small = document.createElement("small");
      small.textContent = secondary;
      cell.append(small);
    }
    row.append(cell);
    return cell;
  }

  function addPill(cell, label, tone = "soft", extraClass = "") {
    const pill = document.createElement("span");
    pill.className = `pill pill-${tone}${extraClass ? ` ${extraClass}` : ""}`;
    pill.textContent = label;
    cell.append(pill);
    return pill;
  }

  function addAction(cell, label, action, values = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "table-action";
    button.dataset.action = action;
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== null) button.dataset[key] = String(value);
    });
    button.textContent = label;
    cell.append(button);
    return button;
  }

  function createEmptyState(title, message, className = "") {
    const empty = document.createElement("div");
    empty.className = `table-empty${className ? ` ${className}` : ""}`;
    if (className.includes("review-empty-state")) empty.dataset.preserveCopy = "true";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.classList.add("ico");
    icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-search");
    icon.append(use);
    const heading = document.createElement("strong");
    heading.textContent = title;
    const detail = document.createElement("span");
    detail.textContent = message;
    empty.append(icon, heading, detail);
    return empty;
  }

  function renderTable(selector, records, makeRow, emptyLabel, error) {
    const body = document.querySelector(selector);
    if (!body) return;
    body.replaceChildren();
    if (error || !records.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = body.closest("table").tHead.rows[0].cells.length;
      cell.className = error ? "table-load-error" : "table-empty-cell";
      if (error) {
        cell.textContent = error;
      } else {
        const title = emptyLabel.replace(/\s+found\.?$/i, " yet");
        const detail = selector === "#review-report-rows"
          ? "There are no customer review reports to review right now."
          : "New records will appear here when they are available.";
        cell.append(createEmptyState(title, detail));
      }
      row.append(cell);
      body.append(row);
      return;
    }
    records.forEach((record) => body.append(makeRow(record)));
    const filter = body.closest(".table-card")?.querySelector(".table-filter");
    if (filter && filter.value !== "all") {
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function statusLabel(status) {
    return ({
      active: "Active",
      suspended: "Suspended",
      pending: "Pending",
      processing: "Processing",
      completed: "Complete",
      failed: "Failed",
      in_progress: "In progress",
      resolved: "Resolved",
      dismissed: "Dismissed",
      open: "Open",
      reviewed: "Reviewed",
    })[status] || status;
  }

  function statusTone(status) {
    if (["active", "completed", "resolved", "reviewed"].includes(status)) return "good";
    if (["suspended", "failed", "pending", "in_progress", "open"].includes(status)) return "warn";
    return "soft";
  }

  function safeImageUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value, window.location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function splitProductDescription(value) {
    const description = String(value || "");
    const match = /(?:^|\n\n)Suitable for skin concerns: ([^\n]*)$/.exec(description);
    if (!match) return { description, skinConditions: "" };
    return {
      description: description.slice(0, match.index).trimEnd(),
      skinConditions: match[1].trim(),
    };
  }

  function combineProductDescription(description, skinConditions) {
    const parts = [description.trim(), skinConditions.trim()
      ? `Suitable for skin concerns: ${skinConditions.trim()}`
      : ""].filter(Boolean);
    return parts.length ? parts.join("\n\n") : null;
  }

  function createUserRow(user) {
    const row = document.createElement("tr");
    row.dataset.userId = user.user_id;
    row.dataset.status = user.account_status;
    row.dataset.role = user.role;
    row.dataset.details = `${user.full_name} · ${user.email} · ${numberFormat.format(user.scan_count)} scans · Joined ${formatDate(user.created_at)}`;
    addTextCell(row, user.full_name, { strong: true, secondary: user.email });
    addTextCell(row, formatDate(user.created_at));
    addTextCell(row, numberFormat.format(user.scan_count));
    addTextCell(row, user.role === "admin" ? "Administrator" : user.role === "moderator" ? "Moderator" : "User");
    const status = document.createElement("td");
    addPill(status, statusLabel(user.account_status), statusTone(user.account_status));
    row.append(status);
    const actions = document.createElement("td");
    addAction(actions, "Details", "details", { user: user.full_name });
    if (user.role !== "admin" && user.user_id !== currentAdminUserId) {
      addAction(actions, user.account_status === "suspended" ? "Reactivate" : "Suspend",
        user.account_status === "suspended" ? "unban" : "ban");
      addAction(actions, user.role === "moderator" ? "Remove moderator" : "Promote",
        user.role === "moderator" ? "demote" : "promote");
    }
    row.append(actions);
    return row;
  }

  function createModeratorRow(moderator) {
    const row = document.createElement("tr");
    row.dataset.userId = moderator.user_id;
    row.dataset.role = "moderator";
    row.dataset.details = `${moderator.full_name} · ${moderator.email} · ${numberFormat.format(moderator.reviews_handled)} moderation actions`;
    addTextCell(row, moderator.full_name, { strong: true, secondary: moderator.email });
    addTextCell(row, formatDate(moderator.created_at));
    addTextCell(row, numberFormat.format(moderator.reviews_handled));
    const status = document.createElement("td");
    addPill(status, statusLabel(moderator.account_status), statusTone(moderator.account_status));
    row.append(status);
    const actions = document.createElement("td");
    addAction(actions, "Details", "details", { user: moderator.full_name });
    if (moderator.user_id !== currentAdminUserId) {
      addAction(actions, "Remove moderator", "demote");
    }
    row.append(actions);
    return row;
  }

  function createProductRow(product) {
    const parsedDescription = splitProductDescription(product.description || "");
    const row = document.createElement("tr");
    row.dataset.productId = product.product_id;
    row.dataset.isDemo = String(Boolean(product.is_demo));
    row.dataset.description = parsedDescription.description;
    row.dataset.skinConditions = parsedDescription.skinConditions;
    row.dataset.imagePath = product.image_path || "";
    row.dataset.brand = product.brand || "";
    row.dataset.currency = product.currency || "USD";
    row.dataset.price = product.price == null ? "" : String(product.price);
    row.dataset.isActive = String(Boolean(product.is_active));
    row.dataset.status = product.is_active ? "active" : "archived";
    const imageCell = document.createElement("td");
    imageCell.className = "product-img-cell";
    const inlineDemoImage = product.is_demo
      && typeof product.demo_image_data === "string"
      && /^data:image\/(?:png|jpeg|webp);base64,/i.test(product.demo_image_data)
      ? product.demo_image_data
      : "";
    const imageUrl = inlineDemoImage || safeImageUrl(product.image_path);
    if (imageUrl) {
      const image = document.createElement("img");
      image.className = "product-img";
      image.src = imageUrl;
      image.alt = product.product_name;
      imageCell.append(image);
    } else if (product.demo_emoji) {
      const emoji = document.createElement("span");
      emoji.className = "product-sample-emoji";
      emoji.setAttribute("aria-hidden", "true");
      emoji.textContent = product.demo_emoji;
      imageCell.append(emoji);
    }
    row.append(imageCell);
    addTextCell(row, product.product_name, {
      strong: true,
      secondary: product.is_demo ? "" : product.brand || `Product #${product.product_id}`,
    });
    const description = document.createElement("td");
    description.className = "product-description-cell";
    description.textContent = parsedDescription.description || "No description provided.";
    if (parsedDescription.skinConditions) {
      const suitability = document.createElement("small");
      suitability.className = "product-skin-label";
      suitability.textContent = `Suitable for: ${parsedDescription.skinConditions}`;
      description.append(suitability);
    }
    row.append(description);
    addTextCell(row, product.category);
    addTextCell(row, product.price == null
      ? "—"
      : new Intl.NumberFormat(undefined, { style: "currency", currency: product.currency || "USD" })
        .format(Number(product.price)));
    addTextCell(row, product.is_demo
      ? `${Number(product.rating).toFixed(1)} ★ · ${numberFormat.format(product.review_count)}`
      : numberFormat.format(product.review_count));
    const status = document.createElement("td");
    addPill(
      status,
      product.is_active ? "Active" : "Archived",
      product.is_active ? "good" : "soft",
    );
    row.append(status);
    const actions = document.createElement("td");
    if (product.is_demo) {
      addAction(actions, "Edit", "edit");
      const remove = addAction(actions, "Delete", "delete-sample-product");
      remove.classList.add("danger-text");
    } else {
      addAction(actions, "Select", "select-product");
      addAction(actions, "Edit", "edit");
      addAction(actions, product.is_active ? "Archive" : "Restore",
        product.is_active ? "delete" : "restore-product", { productId: product.product_id });
    }
    row.append(actions);
    return row;
  }

  function createScanRow(scan) {
    const row = document.createElement("tr");
    row.dataset.status = scan.status;
    const scanName = `SC-${scan.analysis_id}`;
    addTextCell(row, scanName, { strong: true });
    addTextCell(row, scan.user_name);
    addTextCell(row, scan.analysis_type === "lesion" ? "Lesion" : "Facial");
    addTextCell(row, formatDate(scan.created_at, true));
    const status = document.createElement("td");
    addPill(status, statusLabel(scan.status), statusTone(scan.status));
    row.append(status);
    const actions = document.createElement("td");
    const description = [
      `Scan ${scanName}`,
      `User: ${scan.user_name}`,
      `Type: ${scan.analysis_type}`,
      `Status: ${scan.status}`,
      scan.model_version ? `Model: ${scan.model_version}` : "",
      scan.error_code ? `Error code: ${scan.error_code}` : "",
      scan.error_message || "",
      scan.guidance_text || "",
    ].filter(Boolean).join(" · ");
    addAction(actions, "View record", "details", { user: scanName, details: description });
    row.append(actions);
    return row;
  }

  function createIssueRow(issue) {
    const row = document.createElement("tr");
    row.dataset.issueType = issue.issue_type;
    row.dataset.targetId = issue.target_id;
    row.dataset.status = issue.review_status;
    addTextCell(row, `ISS-${issue.issue_type === "analysis" ? "A" : "I"}-${issue.target_id}`, { strong: true });
    addTextCell(row, `SC-${issue.analysis_id}`);
    addTextCell(row, issue.issue, { secondary: issue.details || "" });
    addTextCell(row, formatDate(issue.detected_at, true));
    const severity = document.createElement("td");
    addPill(severity, issue.severity, issue.severity === "High" ? "warn" : "soft");
    row.append(severity);
    const status = document.createElement("td");
    addPill(status, statusLabel(issue.review_status), statusTone(issue.review_status), "issue-status");
    row.append(status);
    const actions = document.createElement("td");
    addAction(actions, issue.review_status === "reviewed" ? "Reopen" : "Mark reviewed", "resolve", {
      issueType: issue.issue_type,
      targetId: issue.target_id,
    });
    row.append(actions);
    return row;
  }

  function createReportRow(report) {
    const row = document.createElement("tr");
    row.dataset.reportId = report.report_id;
    row.dataset.reportStatus = report.status;
    row.dataset.status = report.status;
    const publicId = `UR-${report.report_id}`;
    addTextCell(row, publicId, { strong: true, secondary: report.subject });
    addTextCell(row, report.reporter_name);
    addTextCell(row, report.category);
    addTextCell(row, formatDate(report.created_at, true));
    const status = document.createElement("td");
    addPill(status, statusLabel(report.status), statusTone(report.status));
    row.append(status);
    const actions = document.createElement("td");
    const isOpen = ["pending", "in_progress"].includes(report.status);
    addAction(actions, isOpen ? "Mark resolved" : "Reopen", "resolve");
    addAction(actions, "Details", "details", { user: publicId });
    row.append(actions);
    row.dataset.details = report.description;
    return row;
  }

  function createLogRow(log) {
    const row = document.createElement("tr");
    addTextCell(row, formatDate(log.created_at, true));
    addTextCell(row, log.actor_name);
    const action = String(log.action || "").replaceAll("_", " ");
    addTextCell(row, action, {
      secondary: log.details ? JSON.stringify(log.details) : "",
    });
    addTextCell(row, log.target_type
      ? `${log.target_type}${log.target_id ? ` #${log.target_id}` : ""}`
      : "Platform");
    const result = document.createElement("td");
    addPill(result, "Recorded", "good");
    row.append(result);
    return row;
  }

  function renderActivity(logs) {
    const list = document.querySelector("#view-overview .activity-list");
    list.replaceChildren();
    if (!logs.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No administrative activity has been recorded yet.";
      list.append(empty);
      return;
    }
    logs.forEach((log) => {
      const item = document.createElement("div");
      const text = document.createElement("span");
      text.innerHTML = '<strong></strong><small></small>';
      text.querySelector("strong").textContent = String(log.action).replaceAll("_", " ");
      text.querySelector("small").textContent = `${log.actor_name} · ${formatDate(log.created_at, true)}`;
      const badge = document.createElement("span");
      badge.className = "pill pill-good";
      badge.textContent = "Recorded";
      item.append(text, badge);
      list.append(item);
    });
  }

  function renderBarChart(selector, activity, unit = " scans") {
    const chart = document.querySelector(selector);
    if (!chart) return;
    const totals = new Map(activity.map((item) => [
      String(item.activity_date).slice(0, 10),
      Number(item.total ?? item.average_seconds),
    ]));
    const points = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = new Date();
      day.setUTCHours(12, 0, 0, 0);
      day.setUTCDate(day.getUTCDate() - offset);
      const iso = day.toISOString().slice(0, 10);
      points.push({ date: iso, total: totals.get(iso) || 0 });
    }
    const max = Math.max(1, ...points.map((point) => point.total));
    chart.replaceChildren();
    points.forEach((point) => {
      const bar = document.createElement("div");
      const stem = document.createElement("i");
      const height = point.total ? Math.max(4, point.total / max * 100) : 0;
      stem.style.setProperty("--height", `${height}%`);
      stem.title = `${point.total}${unit}`;
      const label = document.createElement("small");
      label.textContent = new Intl.DateTimeFormat(undefined, { weekday: "short" })
        .format(new Date(`${point.date}T12:00:00Z`));
      bar.append(stem, label);
      chart.append(bar);
    });
  }

  function renderOverview(data) {
    const users = data.users;
    const products = data.products;
    const scans = data.scans;
    const attempted = Number(scans.completed_scans) + Number(scans.failed_scans);
    const completion = attempted ? `${(Number(scans.completed_scans) / attempted * 100).toFixed(1)}%` : "—";
    setStats("overview", [
      numberFormat.format(users.total_users),
      numberFormat.format(products.active_products),
      numberFormat.format(scans.scans_this_month),
      completion,
    ], ["Registered users", "Active products", "Scans this month", "Analysis completion"]);
    setStats("users", [
      numberFormat.format(users.total_users),
      numberFormat.format(users.active_users),
      numberFormat.format(users.moderators),
      numberFormat.format(users.suspended_users),
    ], ["Total users", "Active", "Moderators", "Suspended"]);
    setStats("ai-overview", [
      numberFormat.format(scans.scans_this_month),
      numberFormat.format(data.open_issues),
      scans.average_processing_seconds == null ? "—" : `${Number(scans.average_processing_seconds).toFixed(1)}s`,
      completion,
    ], ["Scans this month", "Need review", "Avg. processing", "Completion rate"]);
    setStats("usage-reports", [
      numberFormat.format(scans.scans_this_month),
      numberFormat.format(data.monthly_active_users),
      Number(scans.scans_last_month) > 0
        ? `${((Number(scans.scans_this_month) - Number(scans.scans_last_month)) / Number(scans.scans_last_month) * 100).toFixed(1)}%`
        : "—",
      scans.average_processing_seconds == null ? "—" : `${Number(scans.average_processing_seconds).toFixed(1)}s`,
    ], ["Scans this month", "Active users · 30 days", "Change vs. last month", "Avg. analysis time"]);
    renderBarChart("#view-overview .chart-bars", data.weekly_scans);
    renderBarChart("#view-usage-reports .chart-bars", data.weekly_scans);
    renderActivity(data.recent_activity);
    const attentionItems = document.querySelectorAll("#view-overview .attention-list li");
    const attention = [
      [`${data.pending_review_reports} review reports`, "User-submitted reports awaiting review"],
      [`${data.open_issues} analysis issues`, "Failed scans or image-quality checks not yet reviewed"],
      [`${data.pending_reports} support reports`, "Pending or in-progress support cases"],
    ];
    attentionItems.forEach((item, index) => {
      item.querySelector("strong").textContent = attention[index][0];
      item.querySelector("small").textContent = attention[index][1];
    });
    document.querySelector("#view-overview .date-stamp b").textContent = "Live database data";
    document.querySelector("#view-ai-overview .date-stamp").firstChild.textContent = "AI ANALYSIS DATA ";
    document.querySelector("#view-ai-overview .date-stamp b").textContent = "Connected";
    document.querySelector("#ai-review-count").textContent = String(data.open_issues);
    document.querySelector("#ai-review-shortcut-count").textContent = data.open_issues
      ? `${data.open_issues} ${data.open_issues === 1 ? "item needs" : "items need"} attention`
      : "No open items";
    document.querySelector("#ai-review-summary").textContent = data.open_issues
      ? `${data.open_issues} ${data.open_issues === 1 ? "issue needs" : "issues need"} a closer look`
      : "Everything is up to date";
    document.querySelector("#ai-review-summary-copy").textContent =
      "Open the review queue to check failed analyses or image-quality checks. AI results are informational, not a medical diagnosis.";
    window.skinwiseAdminNotificationCounts = {
      reviewReports: Number(data.pending_review_reports),
      issues: Number(data.open_issues),
      supportReports: Number(data.pending_reports),
    };
    window.dispatchEvent(new CustomEvent("skinwise-admin-notifications", {
      detail: window.skinwiseAdminNotificationCounts,
    }));
  }

  function renderAnalysisSummary(data) {
    const summary = data.summary;
    const total = Number(summary.total);
    const completed = Number(summary.completed);
    const failed = Number(summary.failed);
    const inProgress = Number(summary.in_progress);
    const completionRate = total ? completed / total * 100 : 0;
    const failureRate = total ? failed / total * 100 : 0;
    const progressRate = total ? inProgress / total * 100 : 0;
    const attempted = completed + failed;
    const successRate = attempted ? completed / attempted * 100 : 0;
    const average = summary.average_seconds == null ? "—" : `${Number(summary.average_seconds).toFixed(1)}s`;

    setStats("analysis-results", [
      numberFormat.format(total),
      total ? `${completionRate.toFixed(1)}%` : "—",
      average,
      numberFormat.format(failed),
    ], ["Scans", "Completion rate", "Avg. processing", "Failed"]);
    setStats("ai-performance", [
      total ? `${completionRate.toFixed(1)}%` : "—",
      average,
      total ? `${successRate.toFixed(1)}%` : "—",
      total ? `${failureRate.toFixed(1)}%` : "—",
    ], ["Completion rate", "Avg. processing", "Success rate", "Failure rate"]);

    const outcomeRows = document.querySelectorAll("#view-analysis-results .outcome-list > div");
    const outcomes = [
      ["Completed analyses", completionRate],
      ["Failed analyses", failureRate],
      ["Pending or processing", progressRate],
    ];
    outcomeRows.forEach((row, index) => {
      row.querySelector("span").textContent = outcomes[index][0];
      row.querySelector("b").textContent = total ? `${outcomes[index][1].toFixed(1)}%` : "—";
      row.querySelector("em").style.width = `${Math.min(100, outcomes[index][1])}%`;
    });

    const latestCard = document.querySelector("#view-analysis-results .admin-grid .card:nth-child(2)");
    const latestTitle = latestCard.querySelector(".card-head p");
    const latestStatus = latestCard.querySelector(".card-head .pill");
    const latestPreview = latestCard.querySelector(".result-preview");
    if (data.latest) {
      latestTitle.textContent = `SC-${data.latest.analysis_id} · ${data.latest.analysis_type}`;
      latestStatus.textContent = "Complete";
      latestStatus.className = "pill pill-good";
      latestPreview.textContent = data.latest.guidance_text || "Completed analysis";
    } else {
      latestTitle.textContent = "No completed analysis is available.";
      latestStatus.textContent = "No data";
      latestStatus.className = "pill pill-soft";
      latestPreview.textContent = "No analysis results yet.";
    }

    const imageHealth = data.images.total
      ? `${numberFormat.format(data.images.passed)} passed · ${numberFormat.format(data.images.failed)} failed`
      : "No image checks recorded";
    const healthRows = document.querySelectorAll("#view-ai-performance .health-list > div");
    if (healthRows[0]) {
      healthRows[0].querySelector("span").lastChild.textContent = " Saved analysis records";
      healthRows[0].querySelector("strong").textContent = numberFormat.format(total);
    }
    if (healthRows[1]) healthRows[1].querySelector("strong").textContent = imageHealth;
    if (healthRows[2]) healthRows[2].querySelector("strong").textContent = "Connected";
    if (healthRows[3]) healthRows[3].remove();
    document.querySelector("#view-ai-performance .card-head h3").textContent = "Database-backed data";
    document.querySelector("#view-ai-performance .card-head p").textContent =
      "Records available from the configured database";
    document.querySelector("#view-ai-performance .date-stamp").lastElementChild.innerHTML =
      '<i class="status-dot"></i> Based on saved analyses';
    const trendHeading = document.querySelector("#view-ai-performance .chart-bars")
      .closest(".card").querySelector("h3");
    trendHeading.textContent = "Average processing time";
    renderBarChart("#view-ai-performance .chart-bars", data.processing_trend, "s");
  }

  async function loadOverview() {
    try {
      const response = await adminApi("/api/admin/overview");
      renderOverview(await response.json());
    } catch (error) {
      const state = document.querySelector("#view-overview .date-stamp b");
      state.textContent = error.message || "Database data unavailable";
    }
  }

  async function loadProducts() {
    try {
      const response = await adminApi("/api/admin/products");
      const data = await response.json();
      renderTable("#view-products tbody", [...data.products, ...demoProducts], createProductRow, "No products found.");
    } catch (error) {
      renderTable("#view-products tbody", [], createProductRow, "", error.message || "Products could not be loaded.");
    }
  }

  async function loadUsers() {
    return loadAdminView("/api/admin/users", (data) => renderTable(
      "#view-users tbody", data.users, createUserRow, "No user accounts found."
    ), "#view-users tbody");
  }

  async function loadModerators() {
    return loadAdminView("/api/admin/moderators", (data) => renderTable(
      "#view-moderators tbody", data.moderators, createModeratorRow, "No moderators found."
    ), "#view-moderators tbody");
  }

  async function loadIssues() {
    return loadAdminView("/api/admin/issues", (data) => {
      renderTable("#view-detection-errors tbody", data.issues, createIssueRow, "No analysis issues found.");
      updateAIReviewCount(data.issues);
    }, "#view-detection-errors tbody");
  }

  async function loadReports() {
    return loadAdminView("/api/admin/support-reports", (data) => renderTable(
      "#view-user-reports tbody", data.reports, createReportRow, "No support reports found."
    ), "#view-user-reports tbody");
  }

  async function loadReviewReports() {
    return loadAdminView("/api/admin/review-reports", (data) => {
      renderTable("#review-report-rows", data.reports, createReviewReportRow, "No reported reviews found.");
      const pending = data.reports.filter((report) => report.status === "pending").length;
      document.querySelector("#review-report-total").textContent =
        `${pending} pending · ${data.reports.length} total`;
      document.querySelector("#review-report-tab-count").textContent = String(data.reports.length);
    }, "#review-report-rows");
  }

  async function loadLogs() {
    return loadAdminView("/api/admin/logs", (data) => renderTable(
      "#view-logs tbody", data.logs, createLogRow, "No administrative audit events found."
    ), "#view-logs tbody");
  }

  async function loadAdminView(path, render, errorSelector) {
    try {
      const response = await adminApi(path);
      render(await response.json());
    } catch (error) {
      const target = document.querySelector(errorSelector);
      if (target?.tagName === "TBODY") {
        renderTable(errorSelector, [], () => null, "", error.message || "Data could not be loaded.");
        if (errorSelector === "#review-report-rows") {
          document.querySelector("#review-report-total").textContent = "Unavailable";
          document.querySelector("#review-report-tab-count").textContent = "—";
        }
      } else if (target) {
        target.textContent = error.message || "Data could not be loaded.";
      }
    }
  }

  async function loadAdminData() {
    document.querySelectorAll(".view tbody").forEach((body) => body.replaceChildren());
    document.querySelectorAll(".stat-num").forEach((number) => { number.textContent = "—"; });
    document.querySelectorAll(".chart-bars").forEach((chart) => chart.replaceChildren());
    document.querySelectorAll("#view-analysis-results .outcome-list b").forEach((value) => { value.textContent = "—"; });
    document.querySelectorAll("#view-analysis-results .outcome-list em").forEach((bar) => { bar.style.width = "0%"; });
    document.querySelector("#view-overview .date-stamp b").textContent = "Loading database data";
    document.querySelector("#view-ai-overview .date-stamp").firstChild.textContent = "AI ANALYSIS DATA ";
    document.querySelector("#view-ai-overview .date-stamp b").textContent = "Loading";
    document.querySelector("#view-ai-performance .date-stamp b").textContent = "Loading analysis data";
    document.querySelector("#view-analysis-results .result-preview").textContent = "Loading saved results…";
    document.querySelectorAll("#view-ai-performance .health-list strong").forEach((item) => { item.textContent = "Loading"; });
    document.querySelector("#view-products .lede").textContent =
      "Manage product records stored in the database. Archiving keeps historical reviews intact.";
    document.querySelector("#view-moderators .table-card .muted").textContent =
      "Role changes are saved in the database and recorded in the system log.";
    document.querySelector("#view-moderators th:nth-child(2)").textContent = "Joined";
    document.querySelector("#view-ai-overview .lede").textContent =
      "Review scan activity, analysis outcomes, and issues recorded in the database.";
    document.querySelector("#view-ai-performance .lede").textContent =
      "Review saved analysis completion rates, processing times, and image-quality checks.";
    document.querySelector("#view-user-reports .lede").textContent =
      "Review account, privacy, product, or other support reports submitted by users.";
    document.querySelector("#view-usage-reports .card .muted").textContent =
      "Scan submissions from the database · last 7 days.";
    await Promise.all([
      loadOverview(),
      loadUsers(),
      loadModerators(),
      loadProducts(),
      loadAdminView("/api/admin/scan-records", (data) => renderTable(
        "#view-scan-records tbody", data.scans, createScanRow, "No scan records found."
      ), "#view-scan-records tbody"),
      loadIssues(),
      loadReports(),
      loadReviewReports(),
      loadLogs(),
      loadAdminView("/api/admin/analysis-summary", renderAnalysisSummary, "#view-analysis-results .result-preview"),
      loadProfile(),
    ]);
  }

  function notify(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
  }

  function renderProductReviews(reviews) {
    const list = document.querySelector("#product-review-list");
    list.replaceChildren();
    if (!reviews.length) {
      const hasReviewFilters = document.querySelector("#review-date-from").value
        || document.querySelector("#review-date-to").value
        || document.querySelector("#review-visibility").value !== "public";
      const emptyMessage = hasReviewFilters
        ? "Try clearing or widening your filters to see more reviews."
        : "Customer reviews will appear here after they are submitted.";
      const empty = createEmptyState("No matching product reviews", emptyMessage, "review-empty-state");
      list.append(empty);
      return;
    }

    reviews.forEach((review) => {
      const entry = document.createElement("article");
      entry.className = "review-entry";
      entry.dataset.reviewId = String(review.review_id);

      const head = document.createElement("div");
      head.className = "review-head";
      const avatar = document.createElement("span");
      avatar.className = "avatar avatar-sm";
      avatar.textContent = review.reviewer_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
      const identity = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = review.reviewer_name;
      const timestamp = new Date(review.created_at.endsWith("Z") ? review.created_at : `${review.created_at}Z`);
      const dateText = Number.isNaN(timestamp.getTime())
        ? review.created_at
        : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
      const product = document.createElement("small");
      product.textContent = `${review.product_name} · ${dateText}`;
      identity.append(name, product);
      const stars = document.createElement("span");
      stars.className = "review-stars";
      stars.setAttribute("aria-label", `${review.rating} out of 5 stars`);
      stars.textContent = `${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}`;
      head.append(avatar, identity, stars);
      if (review.status === "hidden") {
        const hidden = document.createElement("span");
        hidden.className = "pill pill-soft";
        hidden.textContent = "Hidden";
        head.append(hidden);
      }

      const copy = document.createElement("p");
      copy.textContent = review.review_text || "No written comment.";
      const actions = document.createElement("div");
      actions.className = "action-row";
      const details = document.createElement("button");
      details.type = "button";
      details.className = "table-action";
      details.dataset.action = "details";
      details.dataset.user = `Review by ${review.reviewer_name}`;
      details.textContent = "View details";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "table-action danger-text";
      remove.dataset.action = review.status === "hidden" ? "restore-review" : "remove-review";
      remove.dataset.reviewId = String(review.review_id);
      remove.textContent = review.status === "hidden" ? "Restore" : "Remove";
      if (review.status !== "hidden") remove.classList.add("danger-text");
      actions.append(details, remove);
      entry.append(head, copy, actions);
      list.append(entry);
    });
  }

  function setupReviewReportQueue() {
    const reportPanel = document.querySelector("#reported-reviews-panel");
    const card = document.createElement("section");
    card.className = "review-report-queue";
    card.id = "review-report-queue";
    const toolbar = document.createElement("div");
    toolbar.className = "table-toolbar";
    const heading = document.createElement("div");
    heading.innerHTML = "<h3>Reported reviews</h3><p class=\"muted\">Resolve valid reports or dismiss reports that do not identify a rule violation.</p>";
    const total = document.createElement("span");
    total.id = "review-report-total";
    total.className = "pill pill-soft";
    total.textContent = "Loading reports…";
    toolbar.append(heading, total);
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const table = document.createElement("table");
    table.className = "data-table";
    table.innerHTML = "<thead><tr><th>Report</th><th>Review</th><th>Reporter</th><th>Reason</th><th>Received</th><th>Status</th><th>Action</th></tr></thead><tbody id=\"review-report-rows\"></tbody>";
    wrap.append(table);
    card.append(toolbar, wrap);
    reportPanel.append(card);
  }

  function setReviewMode(mode) {
    const showReports = mode === "reports";
    document.querySelector("#reported-reviews-panel").hidden = !showReports;
    document.querySelector("#product-reviews-panel").hidden = showReports;
    document.querySelectorAll("[data-review-mode]").forEach((button) => {
      const active = button.dataset.reviewMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  document.querySelectorAll("[data-review-mode]").forEach((button) => {
    button.addEventListener("click", () => setReviewMode(button.dataset.reviewMode));
  });

  function createReviewReportRow(report) {
    const row = document.createElement("tr");
    row.dataset.reviewReportId = report.report_id;
    row.dataset.status = report.status;
    addTextCell(row, `RR-${report.report_id}`, { strong: true, secondary: report.product_name });
    addTextCell(row, report.review_text || "No written comment.", {
      strong: false,
      secondary: `${report.reviewer_name} · ${report.rating}/5`,
    });
    addTextCell(row, report.reporter_name);
    addTextCell(row, report.reason, { secondary: report.details || "" });
    addTextCell(row, formatDate(report.created_at, true));
    const status = document.createElement("td");
    addPill(status, statusLabel(report.status), statusTone(report.status));
    row.append(status);
    const actions = document.createElement("td");
    if (report.status === "pending") {
      addAction(actions, "Resolve", "review-report-resolve", { reviewReportId: report.report_id });
      addAction(actions, "Dismiss", "review-report-dismiss", { reviewReportId: report.report_id });
    } else {
      addAction(actions, "Reopen", "review-report-reopen", { reviewReportId: report.report_id });
    }
    row.append(actions);
    return row;
  }

  async function loadProductReviews() {
    const message = document.querySelector("#review-report-message");
    const params = new URLSearchParams({
      page: String(reviewPage),
      page_size: String(reviewPageSize),
    });
    const dateFrom = document.querySelector("#review-date-from").value;
    const dateTo = document.querySelector("#review-date-to").value;
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    params.set("status", document.querySelector("#review-visibility").value);
    message.textContent = "Loading reviews…";
    message.classList.remove("is-error");

    try {
      const response = await adminApi(`/api/admin/product-reviews?${params}`);
      const result = await response.json();
      if (reviewPage > result.total_pages) {
        reviewPage = result.total_pages;
        return loadProductReviews();
      }
      reviewTotalPages = result.total_pages;
      renderProductReviews(result.reviews);
      document.querySelector("#review-total").textContent = `${result.total} ${result.total === 1 ? "review" : "reviews"}`;
      document.querySelector("#review-page-summary").textContent =
        `Page ${result.page} of ${result.total_pages} · ${result.total} total`;
      document.querySelector("#review-prev-page").disabled = result.page <= 1;
      document.querySelector("#review-next-page").disabled = result.page >= result.total_pages;
      message.textContent = "";
    } catch (error) {
      message.textContent = error.message || "Product reviews could not be loaded.";
      message.classList.add("is-error");
    }
  }

  document.querySelector("#review-apply-filters").addEventListener("click", () => {
    const dateFrom = document.querySelector("#review-date-from").value;
    const dateTo = document.querySelector("#review-date-to").value;
    if (dateFrom && dateTo && dateFrom > dateTo) {
      const message = document.querySelector("#review-report-message");
      message.textContent = "From date must be on or before the to date.";
      message.classList.add("is-error");
      return;
    }
    reviewPage = 1;
    reviewPageSize = Number(document.querySelector("#review-page-size").value);
    loadProductReviews();
  });
  document.querySelector("#review-clear-filters").addEventListener("click", () => {
    document.querySelector("#review-date-from").value = "";
    document.querySelector("#review-date-to").value = "";
    document.querySelector("#review-page-size").value = "10";
    document.querySelector("#review-visibility").value = "public";
    reviewPage = 1;
    reviewPageSize = 10;
    loadProductReviews();
  });
  document.querySelector("#review-prev-page").addEventListener("click", () => {
    if (reviewPage > 1) {
      reviewPage -= 1;
      loadProductReviews();
    }
  });
  document.querySelector("#review-next-page").addEventListener("click", () => {
    if (reviewPage < reviewTotalPages) {
      reviewPage += 1;
      loadProductReviews();
    }
  });

  function updateAIReviewCount() {
    const openIssues = [...document.querySelectorAll("#view-detection-errors .issue-status")]
      .filter((status) => status.textContent !== "Reviewed").length;
    const openBadge = document.querySelector("#detection-open-count");
    if (openBadge) openBadge.textContent = `${openIssues} open`;
    document.querySelector("#ai-review-count").textContent = String(openIssues);
    document.querySelector("#ai-review-shortcut-count").textContent = openIssues
      ? `${openIssues} ${openIssues === 1 ? "item needs" : "items need"} attention`
      : "No open items";
    document.querySelector("#ai-review-summary").textContent = openIssues
      ? `${openIssues} ${openIssues === 1 ? "issue needs" : "issues need"} a closer look`
      : "Everything is up to date";
    document.querySelector("#ai-review-summary-copy").textContent = openIssues
      ? "Open the review queue to check image quality or processing issues. AI results are informational, not a medical diagnosis."
      : "There are no open issues. AI results are informational, not a medical diagnosis.";
    const openCount = document.querySelector("#detection-open-count");
    openCount.textContent = `${openIssues} open`;
    openCount.className = `pill ${openIssues ? "pill-warn" : "pill-good"}`;
  }

  const profileForm = document.querySelector("#profile-form");
  const defaultProfile = {
    name: signedInUser.full_name || "Skinwise Admin",
    email: signedInUser.email || "admin@skinwise.example",
    photo: ""
  };
  const profileStorageKey = "skinwise-admin-profile";
  const profilePhotoPreferenceKey = "skinwise-admin-save-profile-photo";
  let currentProfile = { ...defaultProfile };
  let profilePhotoData = "";
  let profilePhotoReader = null;
  const profilePhotoInput = profileForm.elements.namedItem("photo");
  const removeProfilePhotoButton = document.querySelector("[data-profile-remove-photo]");
  const profilePhotoStorageInput = document.querySelector("#profile-photo-storage");
  let storeProfilePhotoOnDevice = true;

  function normalizeProfile(savedProfile) {
    if (!savedProfile || typeof savedProfile !== "object" || Array.isArray(savedProfile)) return { ...defaultProfile };
    const photo = typeof savedProfile.photo === "string"
      && savedProfile.photo.length <= 1400000
      && /^data:image\/(?:png|jpeg|webp);base64,/i.test(savedProfile.photo)
      ? savedProfile.photo
      : "";
    return {
      name: defaultProfile.name,
      email: defaultProfile.email,
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

  async function loadProfile() {
    try {
      const response = await adminApi("/api/admin/me");
      const profile = await response.json();
      currentAdminUserId = Number(profile.user_id);
      signedInUser = { ...signedInUser, ...profile };
      authStorage.setItem("skinwise.user", JSON.stringify(signedInUser));
      currentProfile = {
        ...currentProfile,
        name: profile.full_name,
        email: profile.email,
      };
      renderProfile(currentProfile);
    } catch (error) {
      notify(error.message || "Your admin profile could not be loaded.");
    }
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
    profilePhotoStorageInput.checked = storeProfilePhotoOnDevice;
    renderProfilePhoto(profilePhotoData);
  }

  try {
    storeProfilePhotoOnDevice = window.localStorage.getItem(profilePhotoPreferenceKey) !== "false";
    const savedProfile = window.localStorage.getItem(profileStorageKey);
    if (savedProfile && storeProfilePhotoOnDevice) currentProfile = normalizeProfile(JSON.parse(savedProfile));
  } catch {
    notify("Saved profile could not be loaded. The default profile is shown.");
  }
  renderProfile(currentProfile);

  profilePhotoStorageInput.addEventListener("change", () => {
    const previous = storeProfilePhotoOnDevice;
    storeProfilePhotoOnDevice = profilePhotoStorageInput.checked;
    try {
      window.localStorage.setItem(profilePhotoPreferenceKey, String(storeProfilePhotoOnDevice));
      if (!storeProfilePhotoOnDevice) {
        window.localStorage.removeItem(profileStorageKey);
      }
    } catch {
      storeProfilePhotoOnDevice = previous;
      profilePhotoStorageInput.checked = previous;
      notify("The profile photo privacy preference could not be saved in this browser.");
      return;
    }
    notify(storeProfilePhotoOnDevice
      ? "The profile photo will be remembered here when you save your profile."
      : "The saved profile photo was removed from this browser.");
  });

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

  profileForm.addEventListener("submit", async (event) => {
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

    try {
      const profile = await adminJson("/api/admin/me", "PATCH", {
        full_name: updatedProfile.name,
        email: updatedProfile.email,
      });
      currentProfile = { ...updatedProfile, name: profile.full_name, email: profile.email };
      signedInUser = { ...signedInUser, ...profile };
      authStorage.setItem("skinwise.user", JSON.stringify(signedInUser));
      try {
        if (storeProfilePhotoOnDevice) {
          window.localStorage.setItem(profileStorageKey, JSON.stringify({ photo: currentProfile.photo }));
        } else {
          window.localStorage.removeItem(profileStorageKey);
        }
      } catch {
        notify("Profile saved to the database, but the photo preference could not be applied.");
        renderProfile(currentProfile);
        return;
      }
      renderProfile(currentProfile);
      notify(storeProfilePhotoOnDevice
        ? "Name and email saved to your account. The profile photo is stored in this browser."
        : "Name and email saved to your account. The profile photo is not stored in this browser.");
    } catch (error) {
      notify(error.message || "The admin profile could not be saved.");
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

  function addProductDescriptionColumn() {
    const table = document.querySelector("#view-products .data-table");
    const header = [...table.tHead.rows[0].cells].find((cell) => cell.textContent.trim() === "Product");
    const descriptionHeader = document.createElement("th");
    descriptionHeader.scope = "col";
    descriptionHeader.textContent = "Description";
    header.after(descriptionHeader);
    Array.from(table.tBodies[0].rows).forEach((row) => {
      const descriptionCell = row.insertCell(2);
      descriptionCell.className = "product-description-cell";
      const parsedDescription = splitProductDescription(row.dataset.description || "");
      row.dataset.description = parsedDescription.description;
      row.dataset.skinConditions = parsedDescription.skinConditions;
      descriptionCell.textContent = parsedDescription.description || "No description provided.";
      if (parsedDescription.skinConditions) {
        const suitability = document.createElement("small");
        suitability.className = "product-skin-label";
        suitability.textContent = `Suitable for: ${parsedDescription.skinConditions}`;
        descriptionCell.append(suitability);
      }
    });
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
        row.hidden = filter !== "all"
          && row.dataset.status !== filter
          && row.dataset.role !== filter
          && !row.textContent.toLowerCase().includes(filter.replaceAll("_", " "));
      });
    }
  });

  /*
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
  */

  const productImageUrl = productForm.querySelector('[name="imageUrl"]');
  const productImageFile = productForm.querySelector('[name="imageFile"]');
  let productImagePreviewObjectUrl = "";

  function releaseProductImagePreview() {
    if (!productImagePreviewObjectUrl) return;
    URL.revokeObjectURL(productImagePreviewObjectUrl);
    productImagePreviewObjectUrl = "";
  }

  function showProductImage(source) {
    const preview = document.querySelector("#product-image-preview");
    const inlineImage = /^data:image\/(?:jpeg|png|webp);base64,/i.test(source) ? source : "";
    const safeSource = source.startsWith("blob:") ? source : inlineImage || safeImageUrl(source);
    preview.hidden = !safeSource;
    if (safeSource) preview.querySelector("img").src = safeSource;
    else preview.querySelector("img").removeAttribute("src");
  }

  function readProductImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("The selected photo could not be read."));
      }, { once: true });
      reader.addEventListener("error", () => reject(new Error("The selected photo could not be read.")), { once: true });
      reader.readAsDataURL(file);
    });
  }

  function openProductForm(row) {
    editingProductRow = row;
    productForm.reset();
    showProductFormError("");
    document.querySelector("#product-dialog-title").textContent = row ? "Edit product" : "Add a product";
    productForm.querySelector('[name="name"]').value = row?.children[1].querySelector("strong")?.textContent || "";
    productForm.querySelector('[name="description"]').value = row?.dataset.description || "";
    productForm.querySelector('[name="category"]').value = row?.children[3].textContent || "";
    productForm.querySelector('[name="price"]').value = row?.dataset.price || "";
    productForm.querySelector('[name="skinConditions"]').value = row?.dataset.skinConditions || "";
    productImageUrl.value = row?.dataset.imagePath || "";
    const demoProduct = row?.dataset.isDemo === "true"
      ? demoProducts.find((product) => String(product.product_id) === row.dataset.productId)
      : null;
    releaseProductImagePreview();
    showProductImage(demoProduct?.demo_image_data || productImageUrl.value);
    productDialog.showModal();
  }

  addProductDescriptionColumn();

  document.querySelector("#view-products .table-toolbar p.muted").textContent =
    "Products available in the catalog.";
  document.querySelector("#view-scan-records .table-toolbar p.muted").textContent =
    "Latest scan records saved in the database.";
  document.querySelector("#view-detection-errors .table-toolbar p.muted").textContent =
    "Failed analyses and rejected image-quality checks from the database.";
  document.querySelector("#view-logs .table-toolbar p.muted").textContent =
    "Administrative actions recorded in the database.";
  document.querySelector("#view-usage-reports .card .muted").textContent =
    "Scan submissions from the database · last 7 days.";
  document.querySelector("#view-ai-overview .date-stamp").firstChild.textContent = "AI ANALYSIS DATA ";
  const userSuspendedOption = document.querySelector('#view-users .table-filter option[value="banned"]');
  if (userSuspendedOption) {
    userSuspendedOption.value = "suspended";
    userSuspendedOption.textContent = "Suspended";
  }
  const productFilter = document.querySelector("#view-products .table-filter");
  productFilter.replaceChildren();
  [["all", "All products"], ["active", "Active"], ["archived", "Archived"]].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    productFilter.append(option);
  });
  const scanFilter = document.querySelector("#view-scan-records .table-filter");
  scanFilter.replaceChildren();
  [["all", "All scans"], ["completed", "Completed"], ["processing", "Processing"], ["pending", "Pending"], ["failed", "Failed"]]
    .forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      scanFilter.append(option);
    });
  const reportFilter = document.querySelector("#view-user-reports .table-filter");
  reportFilter.replaceChildren();
  [["all", "All reports"], ["pending", "Pending"], ["in_progress", "In progress"], ["resolved", "Resolved"], ["dismissed", "Dismissed"]]
    .forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      reportFilter.append(option);
    });
  productImageUrl.addEventListener("input", () => {
    productImageFile.value = "";
    releaseProductImagePreview();
    showProductImage(productImageUrl.value);
  });
  productImageFile.addEventListener("change", () => {
    releaseProductImagePreview();
    const file = productImageFile.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      productImageFile.value = "";
      notify("Choose a JPG, PNG, or WebP product photo.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      productImageFile.value = "";
      notify("Choose a product photo that is 5 MB or smaller.");
      return;
    }
    productImageUrl.value = "";
    productImagePreviewObjectUrl = URL.createObjectURL(file);
    showProductImage(productImagePreviewObjectUrl);
  });
  productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showProductFormError("");
    if (!productForm.checkValidity()) {
      const invalidField = productForm.querySelector(":invalid");
      const label = invalidField?.closest(".form-field")?.childNodes[0]?.textContent.trim() || "required field";
      showProductFormError(`Please check the ${label.toLowerCase()} field.`);
      productForm.reportValidity();
      return;
    }
    if (!productImageFile.files[0] && productImageUrl.value) {
      try {
        const imageUrl = new URL(productImageUrl.value, window.location.origin);
        const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(productImageUrl.value);
        const isHttpUrl = /^https?:\/\//i.test(productImageUrl.value)
          && (imageUrl.protocol === "http:" || imageUrl.protocol === "https:");
        const isRelativePath = !hasScheme && !productImageUrl.value.startsWith("//");
        if (!isHttpUrl && !isRelativePath) throw new Error("Unsupported image link");
      } catch {
        showProductFormError("Choose a photo or enter an http or https image link.");
        return;
      }
    }

    const values = Object.fromEntries(new FormData(productForm).entries());
    const wasNewProduct = !editingProductRow;
    const productId = editingProductRow?.dataset.productId;
    const payload = {
      product_name: String(values.name).trim(),
      description: combineProductDescription(String(values.description), String(values.skinConditions)),
      category: String(values.category).trim() || null,
      price: values.price === "" ? null : Number(values.price),
      image_path: productImageUrl.value.trim() || null,
    };
    if (editingProductRow) {
      payload.currency = editingProductRow.dataset.currency || "USD";
    }
    const submitButton = productForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      if (editingProductRow?.dataset.isDemo === "true") {
        const demoProduct = demoProducts.find((product) => String(product.product_id) === productId);
        if (!demoProduct) throw new Error("This product is no longer available.");
        if (productImageFile.files[0]) {
          payload.demo_image_data = await readProductImage(productImageFile.files[0]);
          payload.image_path = null;
        } else if (productImageUrl.value.trim()) {
          payload.demo_image_data = "";
        } else {
          payload.demo_image_data = demoProduct.demo_image_data || "";
        }
        Object.assign(demoProduct, payload);
        closeAnimatedDialog(productDialog);
        await loadProducts();
        notify("Product updated for this dashboard session.");
        return;
      }
      if (productImageFile.files[0]) {
        const imageForm = new FormData();
        imageForm.append("file", productImageFile.files[0]);
        const uploaded = await adminApi("/api/admin/product-images", {
          method: "POST",
          body: imageForm,
        });
        payload.image_path = (await uploaded.json()).image_path;
      }
      await adminJson(
        wasNewProduct ? "/api/admin/products" : `/api/admin/products/${encodeURIComponent(productId)}`,
        wasNewProduct ? "POST" : "PATCH",
        payload,
      );
      closeAnimatedDialog(productDialog);
      await loadProducts();
      await loadOverview();
      notify(wasNewProduct ? "Product saved to the database." : "Product updated in the database.");
    } catch (error) {
      showProductFormError(error.message || "The product could not be saved.");
    } finally {
      submitButton.disabled = false;
    }
  });
  document.querySelectorAll("[data-close-product]").forEach((button) => button.addEventListener("click", () => closeAnimatedDialog(productDialog)));
  [dialog, productDialog].forEach((target) => target.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAnimatedDialog(target);
  }));
  productDialog.addEventListener("close", () => {
    productForm.reset();
    releaseProductImagePreview();
    showProductImage("");
    editingProductRow = null;
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const row = button.closest("tr, .review-entry");
    const name = button.dataset.user || row?.querySelector("td strong, .review-head strong")?.textContent || "this record";

    if (action === "details") {
      document.querySelector("#dialog-title").textContent = name;
      document.querySelector("#dialog-copy").textContent = row?.closest("#view-reviews")
        ? "This is a user-submitted product review. Users can publish reviews directly; administrators only inspect and remove content that violates platform rules."
        : button.dataset.details || row?.dataset.details || "No additional details are available for this record.";
      dialog.showModal();
      return;
    }
    if (action === "ban" || action === "demote" || action === "delete" || action === "hide" || action === "remove-review") {
      const prompt = action === "ban" ? "Suspend this user?" : action === "demote" ? "Remove this moderator role?" : action === "delete" ? "Archive this product? It will remain in the database." : action === "remove-review" ? "Remove this review from public listings?" : "Hide this review?";
      if (!window.confirm(prompt)) return;
    }
    if (action === "ban" || action === "unban") {
      try {
        await adminJson(`/api/admin/users/${encodeURIComponent(row.dataset.userId)}`, "PATCH", {
          account_status: action === "ban" ? "suspended" : "active",
        });
        await Promise.all([loadUsers(), loadModerators(), loadOverview()]);
        notify(`${name} ${action === "ban" ? "suspended" : "reactivated"} in the database.`);
      } catch (error) {
        notify(error.message || "The account status could not be changed.");
      }
      return;
    }
    if (action === "promote" || action === "demote") {
      try {
        await adminJson(`/api/admin/users/${encodeURIComponent(row.dataset.userId)}`, "PATCH", {
          role: action === "promote" ? "moderator" : "user",
        });
        await Promise.all([loadUsers(), loadModerators(), loadOverview()]);
        notify(`${name} ${action === "promote" ? "promoted to moderator" : "demoted to user"} in the database.`);
      } catch (error) {
        notify(error.message || "The user role could not be changed.");
      }
      return;
    }
    if (action.startsWith("review-report-")) {
      const status = action === "review-report-resolve" ? "resolved"
        : action === "review-report-dismiss" ? "dismissed" : "pending";
      try {
        await adminJson(
          `/api/admin/review-reports/${encodeURIComponent(button.dataset.reviewReportId)}`,
          "PATCH",
          { status },
        );
        await Promise.all([loadReviewReports(), loadOverview()]);
        notify(status === "pending"
          ? "Product review report reopened."
          : `Product review report ${status}.`);
      } catch (error) {
        notify(error.message || "The product review report could not be updated.");
      }
      return;
    }
    if (action === "select-product") {
      document.querySelectorAll("#view-products tbody tr").forEach((entry) => entry.classList.toggle("selected-row", entry === row));
      notify(`${name} selected.`);
      return;
    }
    if (action === "delete-sample-product") {
      const demoIndex = demoProducts.findIndex((product) => String(product.product_id) === row?.dataset.productId);
      if (demoIndex === -1) {
        notify("This product is no longer available.");
        return;
      }
      demoProducts.splice(demoIndex, 1);
      await loadProducts();
      notify(`${name} removed from this dashboard session.`);
      return;
    }
    if (action === "remove-review") {
      try {
        await adminJson(`/api/admin/product-reviews/${encodeURIComponent(button.dataset.reviewId)}/hide`, "POST", {
          reason: button.dataset.moderationReason,
        });
        reviewPageSize = Number(document.querySelector("#review-page-size").value);
        notify("Review removed from public listings.");
        await loadProductReviews();
        await loadOverview();
      } catch (error) {
        notify(error.message || "The review could not be removed.");
      }
      return;
    }
    if (action === "restore-review") {
      try {
        await adminApi(`/api/admin/product-reviews/${encodeURIComponent(button.dataset.reviewId)}/restore`, {
          method: "POST",
        });
        notify("Review restored to its previous status.");
        await loadProductReviews();
        await loadOverview();
      } catch (error) {
        notify(error.message || "The review could not be restored.");
      }
      return;
    }
    if (action === "delete" || action === "restore-product") {
      try {
        await adminJson(`/api/admin/products/${encodeURIComponent(row.dataset.productId)}`, "PATCH", {
          is_active: action === "restore-product",
        });
        await Promise.all([loadProducts(), loadOverview()]);
        notify(action === "delete" ? "Product archived in the database." : "Product restored in the database.");
      } catch (error) {
        notify(error.message || "The product status could not be changed.");
      }
      return;
    }
    if (action === "resolve" && row?.closest("#view-detection-errors")) {
      const reviewed = row.dataset.status === "reviewed";
      try {
        await adminJson(
          `/api/admin/issues/${encodeURIComponent(row.dataset.issueType)}/${encodeURIComponent(row.dataset.targetId)}`,
          "PATCH",
          { status: reviewed ? "open" : "reviewed" },
        );
        await Promise.all([loadIssues(), loadOverview()]);
        notify(reviewed ? "Issue reopened." : "Issue marked reviewed.");
      } catch (error) {
        notify(error.message || "The issue status could not be changed.");
      }
      return;
    }
    if (action === "resolve" && row?.closest("#view-user-reports")) {
      const isOpen = ["pending", "in_progress"].includes(row.dataset.reportStatus);
      const status = isOpen ? "resolved" : "pending";
      try {
        await adminJson(`/api/admin/support-reports/${encodeURIComponent(row.dataset.reportId)}`, "PATCH", { status });
        await Promise.all([loadReports(), loadOverview()]);
        notify(status === "resolved" ? "Report marked resolved." : "Report reopened.");
      } catch (error) {
        notify(error.message || "The report status could not be changed.");
      }
      return;
    }
    /*
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
    */
    if (action === "edit") {
      if (row) openProductForm(row);
      return;
    }
    if (action === "add-product") {
      openProductForm(null);
      return;
    }
    /*
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
      item.innerHTML = '<span class="dataset-symbol"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v6h6" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></span><span><strong></strong><small></small></span><span class="pill pill-warn">Needs validation</span>';
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
    */
    /*
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
    */
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
    if (action === "logout") {
      authStorage.removeItem("skinwise.access_token");
      authStorage.removeItem("skinwise.user");
      window.location.replace("../login/login.html");
    }
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => closeAnimatedDialog(dialog)));
  const initialView = location.hash.slice(1);
  if (initialView && document.querySelector(`#view-${initialView}`)) openView(initialView);
  else animateCounters(document.querySelector(".view.is-active"));
  setupReviewReportQueue();
  loadAdminData();
  loadProductReviews();
})();