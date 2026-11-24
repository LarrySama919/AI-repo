/* React Bits "Bubble Menu" (reactbits.dev) ported as a tiny React island so the
   vanilla dashboard gets the component without becoming a React app.
   React + ReactDOM + htm come from esm.sh; animation uses the page's GSAP. */
import React, { useState, useRef, useEffect } from "https://cdn.jsdelivr.net/npm/react@18.3.1/+esm";
import { createRoot } from "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/client/+esm";
import htm from "https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.module.js";

const html = htm.bind(React.createElement);
const gsap = window.gsap;

function BubbleMenu({
  onMenuClick,
  menuAriaLabel = "Toggle menu",
  menuBg = "#fff",
  menuContentColor = "#111",
  items,
  activeView = "",
  animationEase = "power3.out",
  animationDuration = 0.36,
  staggerDelay = 0.055,
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
        const delay = i * staggerDelay + gsap.utils.random(-0.02, 0.02);
        const tl = gsap.timeline({ delay });
        // rise up from below the dock into its uneven floating slot
        tl.fromTo(
          bubble,
          { y: restY + 90, scale: 0.78, autoAlpha: 0, transformOrigin: "50% 100%" },
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
      if (backdrop) gsap.to(backdrop, { opacity: 0, duration: 0.2, ease: "power2.in" });
      gsap.to(labels, { y: 12, autoAlpha: 0, duration: 0.16, ease: "power2.in" });
      gsap.to(bubbles, {
        y: "+=80", scale: 0.82, autoAlpha: 0, transformOrigin: "50% 100%",
        duration: 0.22, ease: "power2.in", stagger: 0.02,
        onComplete: () => setShowOverlay(false),
      });
    }
  }, [isMenuOpen, showOverlay, items, animationEase, animationDuration, staggerDelay]);

  return html`
    <${React.Fragment}>
      <nav className="bubble-menu fixed" aria-label="Main navigation">
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
                    className=${`pill-link ${active ? "is-active" : ""} ${item.danger ? "is-danger" : ""}`}
                    style=${{
                      "--item-rot": `${item.rotation ?? 0}deg`,
                      "--item-y": `${item.offsetY ?? 0}px`,
                      "--pill-bg": item.danger ? "#c0392b" : (active ? "#243932" : menuBg),
                      "--pill-color": item.danger ? "#ffffff" : (active ? "#f4f1e8" : menuContentColor),
                      "--hover-bg": item.danger ? "#a5322a" : ((item.hoverStyles && item.hoverStyles.bgColor) || "#f3f4f6"),
                      "--hover-color": item.danger ? "#ffffff" : ((item.hoverStyles && item.hoverStyles.textColor) || menuContentColor),
                    }}
                    onClick=${(e) => { e.preventDefault(); handleSelect(item); }}
                    ref=${(el) => { if (el) bubblesRef.current[idx] = el; }}
                  >
                    ${item.icon ? html`<span className="pill-icon" dangerouslySetInnerHTML=${{ __html: item.icon }}></span>` : null}
                    <span className="pill-label" ref=${(el) => { if (el) labelRefs.current[idx] = el; }}>${item.label}</span>
                  </a>
                </li>`;
            })}
          </ul>
        </div>`}
    </${React.Fragment}>
  `;
}

const ICONS = {
  overview: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="3" width="8" height="5" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="10" width="8" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" stroke-width="1.8"/></svg>',
  scan: '<svg viewBox="0 0 24 24" fill="none"><path d="M8 3.5H6.5A3 3 0 0 0 3.5 6.5V8M16 3.5h1.5a3 3 0 0 1 3 3V8M20.5 16v1.5a3 3 0 0 1-3 3H16M8 20.5H6.5a3 3 0 0 1-3-3V16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="2.8" stroke="currentColor" stroke-width="1.8"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 7v5l3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5V9H8" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  progress: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 19V5M4 19h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 15l3.5-4 3 2.5L20 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  products: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14l-1 13H6L5 7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 10V6a3 3 0 0 1 6 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56l-.06-.06a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" stroke="currentColor" stroke-width="1.6"/></svg>',
  dermatologists: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 20c.7-4 3-6 6.5-6s5.8 2 6.5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18 3v4M16 5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4m4 4H3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const NAV_ITEMS = [
  { label: "Overview", view: "overview", rotation: -6, offsetY: -14, icon: ICONS.overview, hoverStyles: { bgColor: "#324f43", textColor: "#f4f1e8" } },
  { label: "AI Analysis", view: "scan", rotation: 4, offsetY: 10, icon: ICONS.scan, hoverStyles: { bgColor: "#324f43", textColor: "#f4f1e8" } },
  { label: "History", view: "history", rotation: -3, offsetY: -6, icon: ICONS.history, hoverStyles: { bgColor: "#324f43", textColor: "#f4f1e8" } },
  { label: "Progress", view: "progress", rotation: 5, offsetY: 14, icon: ICONS.progress, hoverStyles: { bgColor: "#cc795f", textColor: "#ffffff" } },
  { label: "Products", view: "products", rotation: -5, offsetY: -11, icon: ICONS.products, hoverStyles: { bgColor: "#cc795f", textColor: "#ffffff" } },
  { label: "Dermatologists", view: "dermatologists", rotation: 4, offsetY: 10, icon: ICONS.dermatologists, hoverStyles: { bgColor: "#324f43", textColor: "#f4f1e8" } },
  { label: "Settings", view: "settings", rotation: 3, offsetY: 8, icon: ICONS.settings, hoverStyles: { bgColor: "#324f43", textColor: "#f4f1e8" } },
  {
    label: "Logout",
    href: "#logout",
    rotation: -4,
    offsetY: -16,
    icon: ICONS.logout,
    danger: true,
    onSelect: () => window.skinwiseNav.logout(),
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
