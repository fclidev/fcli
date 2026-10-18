/* -- hero session streams ----------------------------------------------------
 * Reveal a session line by line, scroll the pane so the newest line stays in view,
 * and run the counter alongside.
 *
 * Nothing here computes a number. Every target is a data-count-to the build wrote
 * from a measured payload; the animation paces those numbers, it does not produce
 * them. If this script never runs, every line is visible (opacity is gated on
 * .streams-live in style.css) and the counters are stamped with their final values
 * at build time -- so the widget degrades to a static comparison, never a blank box.
 *
 * SCROLL OWNERSHIP
 *
 * The pane follows the newest line until the reader takes over. Any upward wheel,
 * a touch drag, a keyboard scroll key, or the pane's scrollbar releases it permanently
 * for that pane: nothing yanks the reader back down while they are reading. Clicking
 * inside the pane does NOT claim it, because text selection inside 700 lines of log is
 * the single most likely thing a reader does and stealing follow on that would be a
 * trap; the "follow" button re-arms it.
 *
 * The claim is deliberately one-way and never re-armed by scrolling back to the
 * bottom by hand. Silently resuming the follow would mean a reader loses control of
 * the pane they are holding, and the button's label makes the state explicit instead.
 *
 * TIMING
 *
 * The budget is per session, not per line: a pane with 200 lines and one with 2,000
 * both finish in about the same time, and the second one would otherwise crawl or the
 * first race. Lines are revealed in chunks so the count stays honest on long logs --
 * one timer tick per line on a 2,000-line pane would take hours.
 *
 * Reduced motion skips all of it and shows the final state. The information is never
 * animation-dependent.
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

  function showAll(stream, key) {
    [].slice.call(stream.querySelectorAll(".ln")).forEach(function (l) {
      l.classList.add("on");
    });
    settle(key);
    var btn = stream.parentElement && stream.parentElement.querySelector(".follow");
    if (btn) btn.hidden = true;
  }

  /* Lines are the unit of reveal; turns stay grouped so the labels remain readable. */
  function linesOf(stream) {
    return [].slice.call(stream.querySelectorAll(".ln"));
  }

  function follow(stream, key) {
    var col = stream.closest(".compare-col");
    var btn = col && col.querySelector(".follow");

    // Auto-scroll only while nobody has claimed the pane: reading position always wins
    // over animation.
    //
    // Detection is by bookkeeping, not by event type. A wheel listener alone misses the
    // native scrollbar thumb, a scrollbar-key press and a programmatic assignment, and a
    // scroll listener alone cannot tell "the reader moved" from "we moved it" because our
    // own write fires the same event. So: record the position after every write we make,
    // and any scroll that lands anywhere else was caused by the reader.
    var ours = -1;
    function stick() {
      stream.scrollTop = stream.scrollHeight;
      ours = stream.scrollTop;
    }
    function release() {
      if (!btn || !btn.hidden) return;
      btn.hidden = false;
    }
    stream.addEventListener("scroll", function () {
      if (stream.dataset.running !== "1") return;
      if (stream.scrollTop !== ours) release();
    });
    ["ArrowUp", "PageUp", "Home"].forEach(function (k) {
      stream.addEventListener("keydown", function (e) {
        if (e.key === k) release();
      });
    });

    // The button's `hidden` attribute is the follow flag: hidden == following, visible
    // == the reader holds the pane and can hand it back. It starts hidden because we
    // start following. A first version started it visible on the theory that a reader
    // landing mid-page has already taken over; that inverted the flag and disabled
    // following outright -- 300 animation frames ran, every one of them declining to
    // scroll, with the pane sitting at the top of 28,000px while 41 lines typed in.
    if (btn) {
      btn.hidden = true;
      btn.addEventListener("click", function () {
        btn.hidden = true;
        stick();
      });
    }

    var lines = linesOf(stream);
    var counter = counters[key];
    // Fixed tick; the chunk absorbs the pane's length. Two-sided bounds so neither
    // extreme is wrong: at least ~30 ticks for anything to look like a stream, and no
    // more than 40ms per line so a 2,000-line pane is not a slideshow. Long panes
    // therefore run longer than short ones -- 12s for 100 lines, ~80s for 2,000 --
    // which is honest: the big response IS long, and pacing it uniformly would either
    // crawl on the small pane or erase the reading experience on the big one.
    var STEP = 220;
    var minTicks = 20;
    var ticks = Math.max(minTicks, Math.ceil((lines.length * STEP) / STEP));
    var chunk = Math.max(1, Math.ceil(lines.length / ticks));
    var dur = ticks * STEP;
    var i = 0;

    if (counter) counter.done = false;
    var t0 = null;

    function frame(now) {
      if (window.__streamDebug) window.__streamDebug.push("frame i=" + i + " btn=" + (btn ? (btn.hidden ? "hidden" : "shown") : "none"));
      if (t0 === null) t0 = now;
      // Reveal in lockstep with the clock, so the counter and the text agree even if a
      // tab was backgrounded and frames were dropped.
      var k = Math.min(1, (now - t0) / dur);
      var target = Math.min(lines.length, Math.floor(k * lines.length));
      while (i < target && i < lines.length) {
        lines[i].classList.add("on");
        i++;
      }
      // Follow the newest line, but only while the reader has not claimed the pane.
      // The i > 0 guard is load-bearing: without it lines[i - 1] is undefined on the
      // first frame, the throw kills this rAF callback, and the stream never advances.
      if (btn && btn.hidden && i > 0) {
        var last = lines[i - 1];
        var r = last.getBoundingClientRect();
        var pr = stream.getBoundingClientRect();
        if (r.bottom > pr.bottom || r.top < pr.top) stick();
      }
      if (counter) {
        counter.out.textContent = Math.round(counter.to * k).toLocaleString();
      }
      if (k < 1) requestAnimationFrame(frame);
      else {
        lines.forEach(function (l) {
          l.classList.add("on");
        });
        stream.dataset.running = "0";
        settle(key);
      }
    }

    stream.dataset.running = "1";
    requestAnimationFrame(frame);
  }

  if (reduce || !("IntersectionObserver" in window)) {
    panes.forEach(function (p) {
      showAll(p, p.getAttribute("data-stream"));
    });
    return;
  }

  var seen = new WeakSet();
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (seen.has(e.target)) return;
        seen.add(e.target);
        follow(e.target, e.target.getAttribute("data-stream"));
        io.unobserve(e.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px" },
  );
  panes.forEach(function (p) {
    io.observe(p);
  });
})();
