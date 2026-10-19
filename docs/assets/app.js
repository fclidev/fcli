/* -- hero session streams ----------------------------------------------------
 * Type a session in character by character, terminal-style, and run the counter
 * alongside. The pane is frozen while the stream runs; lines that have not
 * started typing are collapsed to zero height so the pane is only as tall as
 * the text that has actually appeared. When the stream finishes every line is
 * restored to full height, the pane is at the bottom, and it is unlocked.
 *
 * Nothing here computes a number. Every target is a data-count-to the build wrote
 * from a measured payload; the animation paces those numbers, it does not produce
 * them. If this script never runs, every line is visible (opacity is gated on
 * .streams-live in style.css) and the counters are stamped with their final values
 * at build time -- so the widget degrades to a static comparison, never a blank box.
 *
 * WHY THE PANE IS FROZEN AND THE LINES ARE COLLAPSED
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
 * The lines are collapsed to zero height until they start typing, so the pane
 * is only as tall as the text that has actually appeared. The pane is pinned to
 * its bottom every frame, which means the reader sees the latest output at the
 * bottom of the window and the blank space above it is zero. When the stream
 * finishes every line is restored to full height, the pane is at the bottom
 * (the full session), and the reader can scroll it in any direction they like.
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
    // Restore every line's full text and full height, scroll to the bottom,
    // unlock the pane.
    [].slice.call(stream.querySelectorAll(".ln")).forEach(function (l) {
      if (l.dataset.text !== undefined) l.textContent = l.dataset.text;
      l.classList.add("on");
      l.style.display = "";
    });
    stream.scrollTop = stream.scrollHeight;
    stream.style.overflow = "";
    settle(key);
  }

  function run(stream, key) {
    var lines = [].slice.call(stream.querySelectorAll(".ln"));
    var fullTexts = lines.map(function (l) {
      var t = l.textContent;
      l.dataset.text = t;
      return t;
    });
    var totalChars = fullTexts.reduce(function (s, t) { return s + t.length; }, 0);

    // Freeze the pane and collapse every line. The pane is only as tall as the
    // text that has actually appeared, so pinning it to the bottom shows the
    // latest output with no blank space above it.
    stream.scrollTop = 0;
    stream.style.overflow = "hidden";
    lines.forEach(function (l) {
      l.textContent = "";
      l.style.display = "none";
    });

    var dur = 12000;
    var t0 = null;
    var startedLine = -1; // the line currently being typed, or -1 if none

    function frame(now) {
      if (t0 === null) t0 = now;
      var k = Math.min(1, (now - t0) / dur);
      var target = Math.min(totalChars, Math.floor(k * totalChars));

      // Append characters to the lines in order. A line is expanded (display
      // restored) the first time a character is written to it; lines that have
      // not started stay collapsed.
      var charIdx = 0;
      for (var li = 0; li < lines.length && charIdx < target; li++) {
        var full = fullTexts[li];
        var upTo = Math.min(full.length, target - charIdx);
        if (upTo > 0) {
          if (lines[li].style.display === "none") {
            lines[li].style.display = "";
            startedLine = li;
          }
          lines[li].textContent = full.slice(0, upTo);
          lines[li].classList.add("on");
        }
        charIdx += upTo;
      }

      // Pin the pane to its bottom. The pane is frozen (overflow:hidden) so this
      // cannot fight the reader, and the collapsed lines mean the bottom is the
      // latest output, not 26,000px of blank space.
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
