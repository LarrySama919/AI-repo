const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector(".main-nav");
const sampleToast = document.querySelector("#sample-toast");
let toastTimer;

function showToast(message) {
  if (!sampleToast) return;
  const originalMessage = sampleToast.dataset.defaultMessage ?? sampleToast.textContent ?? "";
  sampleToast.dataset.defaultMessage = originalMessage;
  sampleToast.textContent = message;
  sampleToast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    sampleToast.classList.remove("is-visible");
    sampleToast.textContent = originalMessage;
  }, 3200);
}

menuToggle?.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Open menu" : "Close menu");
  mainNav?.classList.toggle("is-open", !isOpen);
});

mainNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuToggle?.setAttribute("aria-expanded", "false");
    menuToggle?.setAttribute("aria-label", "Open menu");
    mainNav.classList.remove("is-open");
  });
});

document.querySelectorAll("[data-notice]").forEach((button) => {
  button.addEventListener("click", () => {
    showToast(button.dataset.notice ?? "");
    menuToggle?.setAttribute("aria-expanded", "false");
    menuToggle?.setAttribute("aria-label", "Open menu");
    mainNav?.classList.remove("is-open");
  });
});

const modeCaption = document.querySelector("#mode-caption");
const heroArt = document.querySelector(".hero-art");
document.querySelectorAll(".scan-choice").forEach((choice) => {
  choice.addEventListener("click", () => {
    document.querySelectorAll(".scan-choice").forEach((button) => {
      const selected = button === choice;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (modeCaption) {
      modeCaption.textContent = choice.dataset.mode === "body" ? "Body check-in" : "Facial check-in";
    }
    heroArt?.setAttribute("data-mode", choice.dataset.mode ?? "face");
  });
});

const sampleButton = document.querySelector("#sample-button");
const sampleResult = document.querySelector("#sample-result");

sampleButton?.addEventListener("click", () => {
  sampleResult?.scrollIntoView({ behavior: "smooth", block: "center" });
  showToast("This is an illustrative sample screen, not a live skin analysis.");
});
