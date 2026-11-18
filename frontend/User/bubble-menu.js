/* React Bits "Bubble Menu" (reactbits.dev) ported as a tiny React island so the
   vanilla dashboard gets the component without becoming a React app.
   React + ReactDOM + htm come from esm.sh; animation uses the page's GSAP. */
import React, { useState, useRef, useEffect } from "https://cdn.jsdelivr.net/npm/react@18.3.1/+esm";
import { createRoot } from "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/client/+esm";
import htm from "https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.module.js";

const html = htm.bind(React.createElement);
const gsap = window.gsap;

function BubbleMenu({
  logo,
  logoHref = "#",
  onMenuClick,
  menuAriaLabel = "Toggle menu",
  menuBg = "#fff",
  menuContentColor = "#111",
  items,
  activeView = "",
  animationEase = "back.out(1.5)",
  animationDuration = 0.5,
  staggerDelay = 0.12,
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);

  const overlayRef = useRef(null);
  const backdropRef = useRef(null);
  const bubblesRef = useRef([]);
  const labelRefs = useRef([]);

  const handleToggle = () => {
    const nextState = !isMenuOpen;
    if (nextState) setShowOverlay(true);
    setIsMenuOpen(nextState);
    if (onMenuClick) onMenuClick(nextState);
  };

  const handleSelect = (item) => {
    if (item.onSelect) item.onSelect(item);
    setIsMenuOpen(false);
  };

  useEffect(() => {
    const overlay = overlayRef.current;
    const backdrop = backdropRef.current;
    const bubbles = bubblesRef.current.filter(Boolean);
    const labels = labelRefs.current.filter(Boolean);

    if (!overlay || !bubbles.length) return;

    if (isMenuOpen) {
      gsap.killTweensOf([...bubbles, ...labels]);
      if (backdrop) gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.32, ease: "power2.out" });

      bubbles.forEach((bubble, i) => {
        const item = items[i] || {};
        const restY = item.offsetY ?? 0;
        const delay = i * staggerDelay + gsap.utils.random(-0.04, 0.04);
        const tl = gsap.timeline({ delay });
        // rise up from below the dock into its uneven floating slot
        tl.fromTo(
          bubble,
          { y: restY + 130, scale: 0.5, autoAlpha: 0, transformOrigin: "50% 100%" },
          {
            y: restY, scale: 1, autoAlpha: 1,
            duration: animationDuration, ease: animationEase,
            // hand the transform back to CSS so hover lift + responsive tilt work
            onComplete: () => gsap.set(bubble, { clearProps: "transform" }),
          }
        );
        if (labels[i]) {
          tl.fromTo(labels[i], { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: animationDuration * 0.8, ease: "power3.out" }, `-=${animationDuration * 0.75}`);
        }
      });
    } else if (showOverlay) {
      gsap.killTweensOf([...bubbles, ...labels]);
      if (backdrop) gsap.to(backdrop, { opacity: 0, duration: 0.24, ease: "power2.in" });
      gsap.to(labels, { y: 16, autoAlpha: 0, duration: 0.18, ease: "power3.in" });
      gsap.to(bubbles, {
        y: "+=110", scale: 0.55, autoAlpha: 0, transformOrigin: "50% 100%",
        duration: 0.26, ease: "power3.in", stagger: 0.03,
        onComplete: () => setShowOverlay(false),
      });
    }
  }, [isMenuOpen, showOverlay, items, animationEase, animationDuration, staggerDelay]);

  return html`
    <${React.Fragment}>
      <nav className="bubble-menu fixed" aria-label="Main navigation">
        <a className="bubble logo-bubble" href=${logoHref} aria-label="Skinwise home">
          <span className="logo-content">
            <img src=${logo} alt="Skinwise" className="bubble-logo" />
          </span>
        </a>
        <button
          type="button"
          className=${`bubble toggle-bubble menu-btn ${isMenuOpen ? "open" : ""}`}
          onClick=${handleToggle}
          aria-label=${menuAriaLabel}
          aria-pressed=${isMenuOpen}
          style=${{ background: menuBg }}
        >
          <span className="menu-line" style=${{ background: menuContentColor }}></span>
          <span className="menu-line" style=${{ background: menuContentColor }}></span>
        </button>
      </nav>
      ${showOverlay && html`
        <div ref=${overlayRef} className="bubble-menu-items" aria-hidden=${!isMenuOpen}>
          <div className="bubble-backdrop" ref=${backdropRef} onClick=${handleToggle} aria-hidden="true"></div>
          <ul className="pill-list" role="menu" aria-label="Menu links">
            ${items.map((item, idx) => {
              const active = item.view && item.view === activeView;
              return html`
                <li key=${idx} role="none" className="pill-col">
                  <a
                    role="menuitem"
                    href=${item.href}
                    aria-label=${item.ariaLabel || item.label}
                    aria-current=${active ? "page" : undefined}
                    className=${`pill-link ${active ? "is-active" : ""}`}
                    style=${{
                      "--item-rot": `${item.rotation ?? 0}deg`,
                      "--item-y": `${item.offsetY ?? 0}px`,
                      "--pill-bg": active ? "#243932" : menuBg,
                      "--pill-color": active ? "#f4f1e8" : menuContentColor,
                      "--hover-bg": (item.hoverStyles && item.hoverStyles.bgColor) || "#f3f4f6",
                      "--hover-color": (item.hoverStyles && item.hoverStyles.textColor) || menuContentColor,
                    }}
                    onClick=${(e) => { e.preventDefault(); handleSelect(item); }}
                    ref=${(el) => { if (el) bubblesRef.current[idx] = el; }}
                  >
                    <span className="pill-label" ref=${(el) => { if (el) labelRefs.current[idx] = el; }}>${item.label}</span>
                  </a>
                </li>`;
            })}
          </ul>
        </div>`}
    </${React.Fragment}>
  `;
}

const NAV_ITEMS = [
  { label: "Overview", view: "overview", rotation: -6, offsetY: -14, hoverStyles: { bgColor: "#324f43", textColor: "#f4f1e8" } },
  { label: "AI Analysis", view: "scan", rotation: 4, offsetY: 10, hoverStyles: { bgColor: "#324f43", textColor: "#f4f1e8" } },
  { label: "History", view: "history", rotation: -3, offsetY: -6, hoverStyles: { bgColor: "#324f43", textColor: "#f4f1e8" } },
  { label: "Progress", view: "progress", rotation: 5, offsetY: 14, hoverStyles: { bgColor: "#cc795f", textColor: "#ffffff" } },
  { label: "Products", view: "products", rotation: -5, offsetY: -11, hoverStyles: { bgColor: "#cc795f", textColor: "#ffffff" } },
  { label: "Settings", view: "settings", rotation: 3, offsetY: 8, hoverStyles: { bgColor: "#324f43", textColor: "#f4f1e8" } },
  {
    label: "Logout",
    href: "#logout",
    rotation: -4,
    offsetY: -16,
    hoverStyles: { bgColor: "#b65f4a", textColor: "#ffffff" },
    onSelect: () => window.skinwiseNav.toast("Logout is not connected yet (frontend demo)."),
  },
];
NAV_ITEMS.forEach((item) => {
  if (!item.view) return;
  item.href = "#" + item.view;
  item.onSelect = () => window.skinwiseNav.switchView(item.view);
});

function BubbleNav() {
  const [active, setActive] = useState(() => (window.skinwiseNav ? window.skinwiseNav.currentView() : "overview"));
  useEffect(() => {
    const onView = (e) => setActive(e.detail);
    document.addEventListener("skinwise:view", onView);
    return () => document.removeEventListener("skinwise:view", onView);
  }, []);

  return html`<${BubbleMenu}
    logo="assets/skinwise-scan-logo.png"
    logoHref="../landing/landing_page.html"
    menuBg="rgba(255,255,255,0.92)"
    menuContentColor="#243932"
    items=${NAV_ITEMS}
    activeView=${active}
  />`;
}

// user.js (classic defer) publishes window.skinwiseNav; module scripts can run
// before it, so wait for the bridge instead of assuming script order.
const root = createRoot(document.getElementById("bubble-root"));
function mount() {
  if (window.skinwiseNav) root.render(html`<${BubbleNav} />`);
  else setTimeout(mount, 60);
}
mount();
