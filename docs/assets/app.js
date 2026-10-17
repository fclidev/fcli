// Progressive enhancement only: the site is complete and navigable without JS.
// 1. mobile nav toggle  2. toc scroll-spy  3. client-side search over search.json

const root = document.body;

// Without JS there is no toggle, so the nav must stay visible: hide the button
// only once a click handler is actually attached.
const toggle = root.querySelector(".menu");
if (toggle) {
  root.classList.add("has-menu");
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => {
    const open = root.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
}

const tocLinks = [...root.querySelectorAll(".toc a")];
if (tocLinks.length && "IntersectionObserver" in window) {
  const targets = tocLinks.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
  const setActive = (id) =>
    tocLinks.forEach((a) => a.classList.toggle("current", a.hash === `#${id}`));
  const visible = new Set();
  const spy = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id);
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
    const el = document.querySelector(".sidebar a[href]");
    const href = el ? new URL(el.getAttribute("href"), document.baseURI).pathname : "/";
    return href.replace(/[^/]*$/, "");
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
  searchBox.parentNode.insertBefore(mount, searchBox);

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
