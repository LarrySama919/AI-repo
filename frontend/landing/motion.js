(() => {
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (motionQuery.matches) return;

  const root = document.documentElement;
  root.classList.add("motion-ready");

  const splitWords = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim()) textNodes.push(walker.currentNode);
    }
    textNodes.forEach((node) => {
      const fragment = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          fragment.appendChild(document.createTextNode(" "));
          return;
        }
        const word = document.createElement("span");
        word.className = "word";
        const inner = document.createElement("span");
        inner.className = "word-in";
        inner.textContent = part;
        word.appendChild(inner);
        fragment.appendChild(word);
      });
      node.replaceWith(fragment);
    });
  };

  const headings = [
    ...document.querySelectorAll(
      ".hero h1, .section-heading h2, .shop-heading h2, .insights-copy h2, .closing-cta h2"
    )
  ];
  headings.forEach((heading) => {
    splitWords(heading);
    heading.dataset.reveal = "words";
    [...heading.querySelectorAll(".word-in")].forEach((word, index) => {
      word.style.setProperty("--d", `${Math.min(index * 0.045, 0.6)}s`);
    });
  });

  const heroEls = [
    ...document.querySelectorAll(
      ".hero-copy .eyebrow, .hero-copy .hero-lede, .hero-copy .hero-actions, .hero-copy .hero-note"
    )
  ];
  heroEls.forEach((el) => el.setAttribute("data-reveal", ""));

  const revealEls = [
    ...document.querySelectorAll(
      ".proof-item, .scan-choice, .section-heading > *, .steps-grid .step-card, .insights-copy > *, .result-card, .shop-heading > *, .product-row .product-card, .shop-footnote, .closing-cta > *, .site-footer > *"
    )
  ].filter((el) => el.dataset.reveal !== "words");

  revealEls.forEach((el) => {
    el.setAttribute("data-reveal", "");
    const siblings = [...el.parentElement.children].filter((child) => revealEls.includes(child));
    el.style.setProperty("--d", `${Math.min(siblings.indexOf(el) * 0.06, 0.36)}s`);
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
  );
  [...revealEls, ...headings].forEach((el) => observer.observe(el));

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      heroEls.forEach((el, index) => {
        el.style.setProperty("--d", `${0.12 + index * 0.09}s`);
        el.classList.add("is-in");
      });
      const heroHeading = document.querySelector(".hero h1");
      heroHeading?.classList.add("is-in");
    });
  });

  const bars = [...document.querySelectorAll(".result-lines b")];
  if (bars.length) {
    const targets = bars.map((bar) => bar.style.width || "0%");
    bars.forEach((bar) => {
      bar.style.width = "0%";
    });
    const testCard = document.querySelector(".result-card");
    if (testCard) {
      new IntersectionObserver(
        (entries, obs) => {
          if (!entries[0].isIntersecting) return;
          bars.forEach((bar, index) => {
            window.setTimeout(() => {
              bar.style.width = targets[index];
            }, 180 + index * 150);
          });
          obs.disconnect();
        },
        { threshold: 0.35 }
      ).observe(testCard);
    }
  }

  if (window.matchMedia("(pointer: fine)").matches) {
    document.querySelectorAll(".product-visual").forEach((visual) => {
      visual.addEventListener("pointermove", (event) => {
        const rect = visual.getBoundingClientRect();
        const rx = ((event.clientY - rect.top) / rect.height - 0.5) * -7;
        const ry = ((event.clientX - rect.left) / rect.width - 0.5) * 9;
        visual.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) scale(1.02)`;
      });
      visual.addEventListener("pointerleave", () => {
        visual.style.transform = "";
      });
    });
  }

  const header = document.querySelector(".site-header");
  if (header) {
    const onScroll = () => header.classList.toggle("is-stuck", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
})();
