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
    password.autocomplete = "new-password";
    password.placeholder = "Create a password";
    rememberRow.hidden = true;
    forgotTab.hidden = true;
    switchText.innerHTML = 'Already have an account? <a href="login.html">Sign in</a>';
  }

  const panel = document.querySelector(".auth-panel");
  const cap = document.querySelector(".auth-card-cap");
  const header = document.querySelector(".auth-header");
  const footer = document.querySelector(".auth-footer");

  animateOnce(
    header,
    [
      { opacity: 0, transform: "translateY(-8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 480, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
  animateOnce(
    panel,
    [
      { opacity: 0, transform: "translateY(20px) scale(.985)" },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ],
    { duration: 620, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
  animateOnce(
    cap,
    [
      { opacity: 0, transform: "translate(-50%, -12px)" },
      { opacity: 1, transform: "translate(-50%, 0)" },
    ],
    { duration: 430, delay: 130, easing: "cubic-bezier(.2,.8,.2,1)" },
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
    forgotTab,
  ].filter((element) => element && !element.hidden);

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

  authForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (isSignUp && password.value !== confirmPassword.value) {
      showMessage("Those passwords do not match. Please check and try again.", "error");
      confirmPassword.focus();
      return;
    }

    showMessage(
      isSignUp
        ? "Account creation is not connected yet. Your details were not sent."
        : "Sign-in is not connected yet. Your details were not sent.",
    );
  });
}
