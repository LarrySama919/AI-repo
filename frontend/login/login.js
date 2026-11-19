const authForm = document.querySelector("#auth-form");

if (authForm) {
  const params = new URLSearchParams(window.location.search);
  const isSignUp = params.get("mode") === "signup";
  const title = document.querySelector("#auth-title");
  const intro = document.querySelector("#auth-intro");
  const submitLabel = document.querySelector("#submit-label");
  const switchText = document.querySelector("#auth-switch");
  const nameGroup = document.querySelector("#name-group");
  const confirmGroup = document.querySelector("#confirm-group");
  const confirmPassword = document.querySelector("#confirm-password");
  const rememberRow = document.querySelector("#remember-row");
  const forgotPassword = document.querySelector("#forgot-password");
  const forgotTab = document.querySelector("#forgot-tab");
  const password = document.querySelector("#password");
  const message = document.querySelector("#form-message");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  window.clearTimeout(window.authMotionFallback);
  document.documentElement.classList.remove("auth-motion-pending");

  function animateOnce(element, frames, options) {
    if (prefersReducedMotion || !element || typeof element.animate !== "function") return;
    const animation = element.animate(frames, { fill: "both", ...options });
    animation.addEventListener("finish", () => animation.cancel(), { once: true });
  }

  function showMessage(text, type = "") {
    message.className = type ? `form-message is-${type}` : "form-message";
    message.textContent = text;
    animateOnce(
      message,
      [
        { opacity: 0, transform: "translateY(-5px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 230, easing: "ease-out" },
    );
  }

  if (isSignUp) {
    document.title = "Create an account — Skinwise";
    title.textContent = "Create your account";
    intro.textContent = "Save your check-ins and revisit them whenever you need.";
    submitLabel.textContent = "Create account";
    nameGroup.hidden = false;
    document.querySelector("#full-name").required = true;
    confirmGroup.hidden = false;
    confirmPassword.required = true;
    confirmPassword.minLength = 12;
    confirmPassword.maxLength = 128;
    password.autocomplete = "new-password";
    password.placeholder = "Create a password";
    password.minLength = 12;
    password.maxLength = 128;
    rememberRow.hidden = true;
    forgotTab.hidden = true;
    switchText.innerHTML = 'Already have an account? <a href="login.html">Sign in</a>';
  }

  const panel = document.querySelector(".auth-panel");
  const footer = document.querySelector(".auth-footer");

  animateOnce(
    document.querySelector(".auth-wave--top"),
    [
      { opacity: 0, transform: "translate(-50%, -105%)" },
      { opacity: 1, transform: "translate(-50%, 0)" },
    ],
    { duration: 1250, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
  animateOnce(
    document.querySelector(".auth-wave--bottom"),
    [
      { opacity: 0, transform: "translate(-50%, 105%)" },
      { opacity: 1, transform: "translate(-50%, 0)" },
    ],
    { duration: 1370, delay: 120, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
  animateOnce(
    document.querySelector(".auth-brand"),
    [
      { opacity: 0, transform: "translateY(-8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 670, delay: 690, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
  animateOnce(
    document.querySelector(".back-link"),
    [
      { opacity: 0, transform: "translateY(-7px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 430, delay: 510, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
  animateOnce(
    panel,
    [
      { opacity: 0, transform: "translateY(20px) scale(.985)" },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ],
    { duration: 650, delay: 150, easing: "cubic-bezier(.2,.8,.2,1)" },
  );

  const visibleFields = [...authForm.querySelectorAll(".field-group:not([hidden])")];
  visibleFields.forEach((field, index) => {
    animateOnce(
      field,
      [
        { opacity: 0, transform: "translateY(10px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 360, delay: 170 + index * 65, easing: "ease-out" },
    );
  });

  const finishingElements = [
    rememberRow,
    document.querySelector(".submit-button"),
    document.querySelector(".auth-switch"),
    document.querySelector(".auth-footnote"),
    isSignUp ? null : forgotPassword,
  ].filter((element) => element && !element.hidden && !element.closest("[hidden]"));

  finishingElements.forEach((element, index) => {
    animateOnce(
      element,
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 340, delay: 360 + index * 55, easing: "ease-out" },
    );
  });

  animateOnce(
    footer,
    [
      { opacity: 0, transform: "translateY(5px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 420, delay: 250, easing: "ease-out" },
  );

  document.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const target = toggle.closest(".password-wrap").querySelector("input");
      const shouldShow = target.type === "password";
      target.type = shouldShow ? "text" : "password";
      toggle.textContent = shouldShow ? "Hide" : "Show";
      toggle.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
      toggle.setAttribute("aria-pressed", String(shouldShow));
      animateOnce(
        toggle,
        [
          { opacity: 0.45, transform: "translateY(-50%) scale(.94)" },
          { opacity: 1, transform: "translateY(-50%) scale(1)" },
        ],
        { duration: 180, easing: "ease-out" },
      );
    });
  });

  forgotPassword.addEventListener("click", () => {
    showMessage("Password reset is not connected yet. Your email has not been sent.");
  });

  function dashboardForRole(role) {
    if (role === "admin") return "../Admin/dashboard.html";
    if (role === "moderator") return "../Moderator/dashboard.html";
    return "../User/dashboard.html";
  }

  function apiErrorMessage(payload, status) {
    if (typeof payload?.detail === "string") return payload.detail;
    if (Array.isArray(payload?.detail)) {
      return payload.detail.map((item) => item.msg).filter(Boolean).join(" ");
    }
    if (status === 409) return "An account with this email already exists.";
    if (status === 401) return "Invalid email or password.";
    return "The request could not be completed. Please try again.";
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isSignUp && password.value !== confirmPassword.value) {
      showMessage("Those passwords do not match. Please check and try again.", "error");
      confirmPassword.focus();
      return;
    }

    const submitButton = authForm.querySelector(".submit-button");
    const submitLabel = document.querySelector("#submit-label");
    const originalLabel = submitLabel.textContent;
    submitButton.disabled = true;
    submitLabel.textContent = isSignUp ? "Creating account…" : "Signing in…";
    showMessage("");

    const formData = new FormData(authForm);
    const endpoint = isSignUp ? "/api/auth/register" : "/api/auth/login";
    const body = isSignUp
      ? {
          full_name: String(formData.get("name") || "").trim(),
          email: String(formData.get("email") || "").trim(),
          password: String(formData.get("password") || ""),
        }
      : {
          email: String(formData.get("email") || "").trim(),
          password: String(formData.get("password") || ""),
        };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showMessage(apiErrorMessage(payload, response.status), "error");
        return;
      }
      if (!payload.access_token || !payload.user) {
        showMessage("The server returned an incomplete sign-in response. Please try again.", "error");
        return;
      }

      const storage = !isSignUp && formData.get("remember") ? localStorage : sessionStorage;
      const otherStorage = storage === localStorage ? sessionStorage : localStorage;
      otherStorage.removeItem("skinwise.access_token");
      otherStorage.removeItem("skinwise.user");
      storage.setItem("skinwise.access_token", payload.access_token);
      storage.setItem("skinwise.user", JSON.stringify(payload.user));
      window.location.assign(dashboardForRole(payload.user.role));
    } catch {
      showMessage(
        "Could not reach Skinwise. Start the FastAPI server and open this page through http://127.0.0.1:8000/frontend/.",
        "error",
      );
    } finally {
      submitButton.disabled = false;
      submitLabel.textContent = originalLabel;
    }
  });
}
