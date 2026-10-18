// Progressive enhancement only: the site is complete and navigable without JS.
// 1. mobile nav toggle  2. toc scroll-spy  3. client-side search over search.json

const root = document.body;

// The sticky sidebar is offset below the topbar by --topbar. The bar's height comes from
// its own content and font metrics, so a value hard-coded in the stylesheet would be
// wrong at some viewport or zoom level and clip the first sidebar row; measuring it once
// keeps the two in step. Nothing re-measures on resize because nothing in the bar wraps
// at widths where the sidebar is visible (it is hidden below 56rem anyway) -- if a
// narrower breakpoint ever lets the bar wrap, re-run this on resize.
const topbar = root.querySelector(".topbar");
if (topbar) root.style.setProperty("--topbar", `${topbar.offsetHeight}px`);

// Without JS there is no toggle, so the nav must stay visible: hide the button
// only once a click handler is actually attached. The sidebar is documentation-only,
// so on every other page there is nothing to open and no button to advertise.
const toggle = root.querySelector(".page .menu");
if (toggle && root.classList.contains("has-sidebar")) {
  root.classList.add("has-menu");
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => {
    const open = root.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
}

// Copy buttons: only wired up once a handler can actually be attached, so with
// JS off the command is still visible and selectable and the button stays hidden
// (see body.has-copy) — the button is never the only way to get the text.
const copyButtons = [...root.querySelectorAll("[data-copy]")];
if (copyButtons.length) root.classList.add("has-copy");
for (const btn of copyButtons) {
  const target = document.querySelector(btn.dataset.copy);
  if (!target) {
    btn.remove();
    continue;
  }
  btn.addEventListener("click", async () => {
    const text = target.textContent.trim();
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context; fall back to a throwaway selection
      // so the copy still works over http:// on a preview server.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      root.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    }
    btn.dataset.done = ok ? "1" : "0";
    btn.textContent = ok ? "Copied" : "Press ⌘C";
    setTimeout(() => {
      delete btn.dataset.done;
      btn.textContent = "Copy";
    }, 1600);
  });
}

const tocLinks = [...root.querySelectorAll(".toc a")];
if (tocLinks.length && "IntersectionObserver" in window) {
  const targets = tocLinks
    .map((a) => document.getElementById(a.hash.slice(1)))
    .filter(Boolean);
  const setActive = (id) =>
    tocLinks.forEach((a) => a.classList.toggle("current", a.hash === `#${id}`));
  const visible = new Set();
  const spy = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        e.isIntersecting
          ? visible.add(e.target.id)
          : visible.delete(e.target.id);
      const first = targets.find((t) => visible.has(t.id));
      if (first) setActive(first.id);
    },
    { rootMargin: "0px 0px -70% 0px" },
  );
  targets.forEach((t) => spy.observe(t));
}

// Search: one fetch of search.json, then a naive scored match per keystroke.
const searchBox = document.querySelector("article > h1");
if (searchBox) {
  const index = { pages: null };

  async function loadIndex() {
    if (index.pages) return index.pages;
    try {
      const res = await fetch(`${relativeBase()}search.json`);
      index.pages = (await res.json()).map((p) => ({
        ...p,
        hay: `${p.title} ${p.summary} ${p.body}`.toLowerCase(),
      }));
    } catch {
      index.pages = [];
    }
    return index.pages;
  }

  function relativeBase() {
    // search.json is emitted at the site root (see src/integrations/site-index.ts), so
    // the answer is a root-absolute path. Deriving it from the first sidebar link used to
    // work because every link in there is root-absolute, but the sidebar no longer exists
    // on the homepage, the ucks listing or the error page — so that lookup silently
    // reached the fallback on exactly the pages where navigation is thinnest.
    return "/";
  }

  function score(page, terms) {
    let s = 0;
    for (const term of terms) {
      if (!page.hay.includes(term)) return 0;
      if (page.title.toLowerCase().includes(term)) s += 8;
      if (page.summary.toLowerCase().includes(term)) s += 4;
      s += 1;
    }
    return s;
  }

  const mount = document.createElement("div");
  mount.className = "search";
  mount.innerHTML = `<input type="search" placeholder="Search the docs…" aria-label="Search the docs">
<div id="search-results" aria-live="polite"></div>`;
  // A page with a hero has its title up there, so its first <h1> is a section
  // heading and search belongs above everything. Otherwise the h1 is the page
  // title and search goes straight under it. Keyed on the hero rather than on
  // .home so any page can grow one. Inserted after the menu button to keep the
  // toggle the first tab stop.
  if (root.classList.contains("has-hero")) {
    const main = document.getElementById("main");
    const menu = main.querySelector(".menu");
    if (menu) menu.after(mount);
    else main.prepend(mount);
  } else {
    searchBox.parentNode.insertBefore(mount, searchBox);
  }

  const input = mount.querySelector("input");
  const results = mount.querySelector("#search-results");

  input.addEventListener("input", async () => {
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length < 2) {
      results.innerHTML = "";
      return;
    }
    const pages = await loadIndex();
    const hits = pages
      .map((p) => ({ page: p, s: score(p, terms) }))
      .filter((h) => h.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8);
    results.innerHTML = hits.length
      ? `<ul>${hits
          .map((h) => {
            const snip = snippet(h.page.body, terms[terms.length - 1]);
            return `<li><a href="${h.page.url}"><span class="hit-title">${escapeHtml(
              h.page.title,
            )}</span><span class="hit-url">${escapeHtml(h.page.url)}</span>${
              snip ? `<span class="hit-snip">${escapeHtml(snip)}…</span>` : ""
            }</a></li>`;
          })
          .join("")}</ul>`
      : `<p class="empty">No matches for “${escapeHtml(input.value)}”.</p>`;
  });
}

function snippet(body, term) {
  const at = body.toLowerCase().indexOf(term);
  if (at < 0) return body.slice(0, 110);
  const start = Math.max(0, at - 55);
  return `${start > 0 ? "…" : ""}${body.slice(start, at + 90)}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


/* -- hero session streams ----------------------------------------------------
 * Reveal each turn in sequence and run the counter to its measured cumulative
 * figure. Nothing here computes a number: every target is a data-count-to the build
 * wrote from measured payloads. The animation paces them, it does not produce them.
 *
 * Reveals on scroll-into-view rather than on load, because the hero is above the
 * fold and a visitor who never scrolls to the comparison should not have watched it
 * finish. Runs once. Reduced motion skips animation entirely and shows the final
 * state, so the information is never animation-dependent.
 */
(function () {
  const panes = [...document.querySelectorAll(".stream")];
  if (!panes.length) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Keyed by data-count-for, which the component sets to the same token as the
  // stream's data-stream. An earlier version tried to infer the pairing by walking
  // the DOM looking for a class, which cannot distinguish two sibling panes.
  const counters = new Map();
  for (const el of document.querySelectorAll(".compare-count")) {
    counters.set(el.getAttribute("data-count-for"), {
      out: el.querySelector("b"),
      to: Number(el.getAttribute("data-count-to")) || 0,
      done: false,
    });
  }

  if (reduce) {
    panes.forEach((p) => [...p.querySelectorAll(".turn")].forEach((t) => t.classList.add("on")));
    for (const c of counters.values()) c.out.textContent = c.to.toLocaleString();
    return;
  }

  const run = (stream) => {
    const turns = [...stream.querySelectorAll(".turn")];
    const counter = counters.get(stream.getAttribute("data-stream"));
    turns.forEach((t, i) => setTimeout(() => t.classList.add("on"), 340 * (i + 1)));
    const last = turns.length ? 340 * turns.length : 0;
    // Count over roughly the same window as the reveal, so the two read as one event.
    if (counter && !counter.done) {
      counter.done = true;
      const dur = Math.max(600, last);
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        counter.out.textContent = Math.round(counter.to * k).toLocaleString();
        if (k < 1) requestAnimationFrame(step);
      };
      setTimeout(() => requestAnimationFrame(step), 120);
    }
  };

  const seen = new WeakSet();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !seen.has(e.target)) {
          seen.add(e.target);
          run(e.target);
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.25 },
  );
  panes.forEach((p) => io.observe(p));
})();
