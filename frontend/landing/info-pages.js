const contactForm = document.querySelector("#contact-form");

contactForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const status = document.querySelector("#contact-status");
  if (!status) return;

  status.hidden = false;
  status.textContent = "Message delivery is not connected yet, so your note was not sent or saved.";
});
