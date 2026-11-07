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
 * Type a session in character by character, terminal-style, and run the counter
 * alongside. The pane is frozen while the stream runs; lines and turn labels
 * that have not started are collapsed so the pane is only as tall as the text
 * that has actually appeared. When the stream finishes everything is restored,
 * the pane is at the bottom, and it is unlocked.
 *
 * Nothing here computes a number. Every target is a data-count-to the build wrote
 * from a measured payload; the animation paces those numbers, it does not produce
 * them. If this script never runs, every line is visible (opacity is gated on
 * .streams-live in style.css) and the counters are stamped with their final values
 * at build time -- so the widget degrades to a static comparison, never a blank box.
 *
 * WHY THE PANE IS FROZEN AND THE CONTENT IS COLLAPSED
 *
 * The previous versions tried to follow the newest line and let the reader take
 * over at any moment. That required detecting "the reader moved the pane" versus
 * "we moved it", which is a bookkeeping problem that is hard to get right: a
 * mouse over the pane, a wheel tick, a scrollbar nudge, all of it had to be
 * disambiguated from the animation's own scroll writes, and the disambiguation
 * kept misfiring.
 *
 * The honest version is simpler: the stream is a fixed 12-second animation.
 * While it runs the pane is not interactive -- no scroll, no wheel, no keys.
 * Lines and turn labels are collapsed until they start, so the pane is only as
 * tall as the text that has actually appeared. The pane is pinned to its bottom
 * every frame, which means the reader sees the latest output at the bottom of
 * the window and the blank space above it is zero. When the stream finishes
 * everything is restored, the pane is at the bottom (the full session), and the
 * reader can scroll it in any direction they like.
 *
 * TIMING
 *
 * 12 seconds per pane, regardless of content length. The number of characters
 * appended per frame absorbs the pane's length.
 *
 * Reduced motion skips all of it and shows the final state.
 */
(function () {
  var panes = [].slice.call(document.querySelectorAll(".stream"));
  if (!panes.length) return;
  document.documentElement.classList.add("streams-live");

  var counters = {};
  [].slice
    .call(document.querySelectorAll(".compare-count"))
    .forEach(function (el) {
      counters[el.getAttribute("data-count-for")] = {
        out: el.querySelector("b"),
        to: Number(el.getAttribute("data-count-to")) || 0,
      };
    });

  var reduce =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function settle(key) {
    var c = counters[key];
    if (c) c.out.textContent = c.to.toLocaleString();
  }

  function finish(stream, key) {
    // Restore every line's full text, every turn label, scroll to the bottom,
    // unlock the pane.
    [].slice.call(stream.querySelectorAll(".ln")).forEach(function (l) {
      if (l.dataset.text !== undefined) l.textContent = l.dataset.text;
      l.classList.add("on");
      l.style.display = "";
    });
    [].slice.call(stream.querySelectorAll(".turn-h")).forEach(function (h) {
      h.style.display = "";
    });
    stream.scrollTop = stream.scrollHeight;
    stream.style.overflow = "";
    // Make tool calls and results collapsible now that the stream is done.
    enableCollapse(stream);
    settle(key);
  }

  /* Collapsible tool calls and results. Clicking a .ln.call or .ln.result
     collapses it to a one-line summary (max-height: 1.4em, overflow hidden)
     and shows a "▸" indicator; clicking again expands it. The full text is
     preserved in the DOM (just clipped), so copying still works. */
  function enableCollapse(stream) {
    [].slice.call(stream.querySelectorAll(".ln.call, .ln.result")).forEach(function (el) {
      el.classList.add("collapsible");
      el.addEventListener("click", function () {
        el.classList.toggle("collapsed");
      });
    });
  }

  function run(stream, key) {
    var lines = [].slice.call(stream.querySelectorAll(".ln"));
    // Map each line to its turn header, so the header can be revealed together
    // with the first line of its turn.
    var lineHeader = lines.map(function (l) {
      var turn = l.closest(".turn");
      return turn ? turn.querySelector(".turn-h") : null;
    });
    var fullTexts = lines.map(function (l) {
      var t = l.textContent;
      l.dataset.text = t;
      return t;
    });
    var totalChars = fullTexts.reduce(function (s, t) { return s + t.length; }, 0);

    // Freeze the pane and collapse every line and turn header. The pane is only
    // as tall as the text that has actually appeared, so pinning it to the
    // bottom shows the latest output with no blank space above it.
    stream.scrollTop = 0;
    stream.style.overflow = "hidden";
    lines.forEach(function (l) {
      l.textContent = "";
      l.style.display = "none";
    });
    [].slice.call(stream.querySelectorAll(".turn-h")).forEach(function (h) {
      h.style.display = "none";
    });

    // Same rate for both panes: characters per second is fixed, so the MCP
    // side (27k chars) runs longer than the f side (5k chars) but they type at
    // the same speed. A fixed 12s duration would make the longer side race and
    // the shorter side crawl.
    var CPS = 1200; // characters per second
    var dur = Math.max(2000, Math.ceil(totalChars / CPS) * 1000);
    var t0 = null;

    function frame(now) {
      if (t0 === null) t0 = now;
      var k = Math.min(1, (now - t0) / dur);
      var target = Math.min(totalChars, Math.floor(k * totalChars));

      // Append characters to the lines in order. A line is expanded the first
      // time a character is written to it; its turn header is expanded at the
      // same moment so the label streams in with its turn. Lines and headers
      // that have not started stay collapsed.
      var charIdx = 0;
      for (var li = 0; li < lines.length && charIdx < target; li++) {
        var full = fullTexts[li];
        var upTo = Math.min(full.length, target - charIdx);
        if (upTo > 0) {
          if (lines[li].style.display === "none") {
            var h = lineHeader[li];
            if (h && h.style.display === "none") h.style.display = "";
            lines[li].style.display = "";
          }
          lines[li].textContent = full.slice(0, upTo);
          lines[li].classList.add("on");
        }
        charIdx += upTo;
      }

      // Pin the pane to its bottom. The pane is frozen (overflow:hidden) so this
      // cannot fight the reader, and the collapsed content means the bottom is
      // the latest output, not 26,000px of blank space.
      stream.scrollTop = stream.scrollHeight;

      var c = counters[key];
      if (c) c.out.textContent = Math.round(c.to * k).toLocaleString();

      if (k < 1) {
        requestAnimationFrame(frame);
      } else {
        finish(stream, key);
      }
    }

    requestAnimationFrame(frame);
  }

  if (reduce || !("IntersectionObserver" in window)) {
    panes.forEach(function (p) {
      finish(p, p.getAttribute("data-stream"));
    });
    return;
  }

  var seen = new WeakSet();
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (seen.has(e.target)) return;
        seen.add(e.target);
        run(e.target, e.target.getAttribute("data-stream"));
        io.unobserve(e.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px" },
  );
  panes.forEach(function (p) {
    io.observe(p);
  });
})();
