/* Slide deck engine. Plain JS, no library, no network.
 *
 * Markup (built from templates/slides.html):
 *   .deck > .stage > section.slide (each may hold .step elements and one aside.notes)
 *   .deck-progress > span, .deck-counter, .deck-notes, .deck-help, .deck-hint
 *
 * Keys: Right/Down/Space/PageDown/Enter = next, Left/Up/PageUp/Backspace = previous,
 *       Home/End, N notes, P presenter window, F fullscreen, ? keys, Esc closes panels.
 * Presenter window: P opens this page again with ?view=presenter in its own window, showing the
 * current slide, the speaker notes, the next slide's title and a timer. The two windows stay in
 * step through a BroadcastChannel, so advancing in either one moves both.
 * The URL hash is the 1-based slide number (#3) and is honoured on load.
 * On load, #3.2 also opens slide 3 with its first two steps shown (handy for links and checks).
 */
(function () {
  "use strict";

  var W = 1920;
  var H = 1080;

  var deck = document.querySelector(".deck");
  var stage = document.querySelector(".stage");
  if (!deck || !stage) return;

  var slides = Array.prototype.slice.call(stage.querySelectorAll(":scope > section.slide"));
  var total = slides.length;
  if (!total) return;

  var bar = document.querySelector(".deck-progress > span");
  var counter = document.querySelector(".deck-counter");
  var notes = document.querySelector(".deck-notes");
  var notesBody = notes && notes.querySelector(".notes-body");
  var notesTitle = notes && notes.querySelector(".notes-title");
  var help = document.querySelector(".deck-help");
  var hint = document.querySelector(".deck-hint");

  var current = -1;
  var presenter = /(?:^|[?&])view=presenter(?:&|$)/.test(location.search.slice(1));
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- scale the 1920x1080 stage to fit, letterboxed ---------- */
  function fit() {
    var box = presenter ? deck.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
    var scale = Math.min(box.width / W, box.height / H);
    stage.style.setProperty("--scale", String(scale));
  }
  window.addEventListener("resize", fit);
  fit();

  /* ---------- steps ---------- */
  function stepsOf(i) {
    return Array.prototype.slice.call(slides[i].querySelectorAll(".step"));
  }
  function setSteps(i, shownCount) {
    stepsOf(i).forEach(function (el, k) {
      el.classList.toggle("is-shown", k < shownCount);
      el.classList.toggle("is-current", k === shownCount - 1);
    });
  }
  function shownCount(i) {
    return slides[i].querySelectorAll(".step.is-shown").length;
  }

  /* ---------- navigation ---------- */
  function hashIndex() {
    var n = parseInt(String(location.hash).replace(/^#/, ""), 10);
    if (isNaN(n)) {
      // Also accept a slide id, e.g. #slide-title.
      var id = decodeURIComponent(String(location.hash).replace(/^#/, ""));
      for (var k = 0; k < total; k++) if (id && slides[k].id === id) return k;
      return 0;
    }
    return Math.max(0, Math.min(total - 1, n - 1));
  }

  function go(i, opts) {
    opts = opts || {};
    i = Math.max(0, Math.min(total - 1, i));
    var dir = opts.dir || (i >= current ? "next" : "prev");
    deck.setAttribute("data-dir", dir);
    if (opts.instant) deck.classList.add("no-anim");

    // Steps: arriving forwards shows none; arriving backwards shows all.
    if (i !== current) setSteps(i, opts.allSteps ? stepsOf(i).length : 0);

    slides.forEach(function (s, k) {
      s.classList.toggle("is-active", k === i);
      s.classList.toggle("is-before", k < i);
      s.classList.toggle("is-after", k > i);
      s.setAttribute("aria-hidden", k === i ? "false" : "true");
      if (k === i) s.removeAttribute("inert");
      else s.setAttribute("inert", "");
    });

    current = i;
    if (bar) bar.style.width = (total > 1 ? (i / (total - 1)) * 100 : 100) + "%";
    if (counter) counter.textContent = i + 1 + " / " + total;
    var label = slides[i].getAttribute("data-title");
    if (!presenter) document.title = (label ? label + " · " : "") + (deck.getAttribute("data-deck-title") || document.title);
    var want = "#" + (i + 1);
    if (location.hash !== want) {
      history.replaceState(null, "", want);
    }
    renderNotes();
    share();

    if (opts.instant) {
      // Force a reflow so the next change animates again.
      void stage.offsetWidth;
      deck.classList.remove("no-anim");
    }
  }

  function next() {
    var steps = stepsOf(current);
    var shown = shownCount(current);
    if (shown < steps.length) {
      setSteps(current, shown + 1);
      renderNotes();
      share();
      return;
    }
    if (current < total - 1) go(current + 1, { dir: "next" });
  }

  function prev() {
    var shown = shownCount(current);
    if (shown > 0) {
      setSteps(current, shown - 1);
      renderNotes();
      share();
      return;
    }
    if (current > 0) go(current - 1, { dir: "prev", allSteps: true });
  }

  /* ---------- notes drawer ---------- */
  function renderNotes() {
    if (!notesBody) return;
    var aside = slides[current].querySelector("aside.notes");
    if (aside && aside.innerHTML.trim()) {
      notesBody.innerHTML = aside.innerHTML;
    } else {
      notesBody.innerHTML = '<p class="notes-empty">No notes for this slide.</p>';
    }
    if (notesTitle) notesTitle.textContent = "Speaker notes · " + (current + 1) + " / " + total;
    if (presenter) renderPresenter();
  }
  function toggleNotes(force) {
    if (!notes) return;
    var open = typeof force === "boolean" ? force : !notes.classList.contains("is-open");
    notes.classList.toggle("is-open", open);
    notes.setAttribute("aria-hidden", open ? "false" : "true");
  }


  /* ---------- presenter window, kept in step with the slides ---------- */
  var channel = null;
  var applying = false;
  try {
    channel = new BroadcastChannel("deck:" + location.pathname);
  } catch (err) {
    channel = null;
  }
  function share() {
    if (!channel || applying || current < 0) return;
    channel.postMessage({ type: "state", i: current, shown: shownCount(current) });
  }
  if (channel) {
    channel.onmessage = function (e) {
      var m = e.data || {};
      if (m.type === "hello") {
        if (!presenter) share();
        return;
      }
      if (m.type !== "state" || typeof m.i !== "number") return;
      if (m.i === current && m.shown === shownCount(current)) return;
      applying = true;
      try {
        if (m.i !== current) go(m.i, { dir: m.i > current ? "next" : "prev" });
        setSteps(current, Math.max(0, Math.min(stepsOf(current).length, m.shown | 0)));
        renderNotes();
      } finally {
        applying = false;
      }
    };
  }

  function openPresenter() {
    var url = location.pathname + "?view=presenter" + location.hash;
    var w = window.open(url, "deck-presenter", "popup,width=1280,height=800");
    if (!w) location.assign(url); // pop-ups blocked: open it here instead
  }

  var pv = null; // presenter view parts
  function buildPresenter() {
    document.body.classList.add("deck-presenter");
    var css = document.createElement("style");
    css.textContent = [
      ".deck-presenter{background:#0b1418;color:#f6f3ec;font-family:var(--font-sans)}",
      ".deck-presenter .deck{inset:64px auto auto 24px;width:calc(45vw - 36px);aspect-ratio:16/9;height:auto;border-radius:6px}",
      ".deck-presenter .deck-progress,.deck-presenter .deck-counter,.deck-presenter .deck-hint,.deck-presenter .deck-notes{display:none!important}",
      ".pv-top{position:fixed;top:0;left:0;right:0;height:52px;display:flex;align-items:center;gap:28px;padding:0 24px;border-bottom:1px solid #ffffff1f;font:600 16px/1 var(--font-sans);letter-spacing:.02em}",
      ".pv-top .pv-label{color:#ffffff8c;font-weight:500;margin-right:6px}",
      ".pv-top .pv-timer{margin-left:auto;font-variant-numeric:tabular-nums;font-size:22px;background:none;border:1px solid #ffffff33;color:inherit;border-radius:8px;padding:6px 12px;cursor:pointer}",
      ".pv-side{position:fixed;top:64px;left:calc(45vw);right:24px;bottom:24px;display:flex;flex-direction:column;gap:16px}",
      ".pv-notes{flex:1;overflow-y:auto;background:#f6f3ec;color:var(--color-ink);border-top:4px solid var(--color-brand);border-radius:6px;padding:22px 28px;font:400 clamp(20px,1.9vw,30px)/1.5 var(--font-sans)}",
      ".pv-notes>*+*{margin-top:.7em}.pv-notes em{color:var(--color-signal);font-style:normal;font-weight:600}",
      ".pv-next{font:500 17px/1.3 var(--font-sans);color:#ffffffb3}.pv-next b{color:#fff}",
      ".pv-under{position:fixed;left:24px;width:calc(45vw - 36px);top:calc(64px + (45vw - 36px) * 9 / 16 + 16px);font:400 15px/1.5 var(--font-sans);color:#ffffff8c}",
      ".pv-under kbd{border:1px solid;border-radius:4px;padding:1px 5px;font:600 .92em/1 var(--font-sans)}"
    ].join("\n");
    document.head.appendChild(css);

    var top = document.createElement("div");
    top.className = "pv-top";
    top.innerHTML =
      '<span><span class="pv-label">Slide</span><span class="pv-slide"></span></span>' +
      '<span><span class="pv-label">Click</span><span class="pv-step"></span></span>' +
      '<button type="button" class="pv-timer" title="Click to restart the timer">0:00</button>';
    var side = document.createElement("div");
    side.className = "pv-side";
    side.innerHTML = '<div class="pv-notes" aria-live="polite"></div><div class="pv-next"></div>';
    var under = document.createElement("div");
    under.className = "pv-under";
    under.innerHTML =
      "Speaker view. Show the slides window on the projector; this window follows it. " +
      "Arrow keys, Space or a clicker work in either window. <kbd>F</kbd> full screen.";
    document.body.appendChild(top);
    document.body.appendChild(side);
    document.body.appendChild(under);
    document.title = "Speaker notes · " + (deck.getAttribute("data-deck-title") || "Slides");

    pv = {
      slide: top.querySelector(".pv-slide"),
      step: top.querySelector(".pv-step"),
      timer: top.querySelector(".pv-timer"),
      notes: side.querySelector(".pv-notes"),
      next: side.querySelector(".pv-next")
    };

    var started = Date.now();
    function tick() {
      var s = Math.floor((Date.now() - started) / 1000);
      pv.timer.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }
    pv.timer.addEventListener("click", function () {
      started = Date.now();
      tick();
    });
    setInterval(tick, 1000);
  }
  function renderPresenter() {
    if (!pv || current < 0) return;
    var aside = slides[current].querySelector("aside.notes");
    pv.notes.innerHTML = aside && aside.innerHTML.trim() ? aside.innerHTML : '<p class="notes-empty">No notes for this slide.</p>';
    pv.slide.textContent = current + 1 + " / " + total;
    var steps = stepsOf(current).length;
    pv.step.textContent = steps ? shownCount(current) + " / " + steps : "none";
    var nextTitle = current < total - 1 ? slides[current + 1].getAttribute("data-title") || "Slide " + (current + 2) : null;
    pv.next.innerHTML = nextTitle ? "Next slide: <b></b>" : "<b>Last slide</b>";
    if (nextTitle) pv.next.querySelector("b").textContent = nextTitle;
  }
  if (presenter) {
    buildPresenter();
    fit();
  }

  /* ---------- help ---------- */
  function toggleHelp(force) {
    if (!help) return;
    var open = typeof force === "boolean" ? force : !help.classList.contains("is-open");
    help.classList.toggle("is-open", open);
    help.setAttribute("aria-hidden", open ? "false" : "true");
  }

  /* ---------- fullscreen ---------- */
  function toggleFullscreen() {
    var d = document;
    var el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    } else if (el.requestFullscreen) {
      el.requestFullscreen().catch(function () {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    }
  }

  /* ---------- input ---------- */
  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    wake();

    var k = e.key;
    var handled = true;
    if (help && help.classList.contains("is-open") && k !== "?" && k !== "Escape") {
      toggleHelp(false);
      e.preventDefault();
      return;
    }
    switch (k) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case " ":
      case "Spacebar":
      case "Enter":
        if (e.shiftKey && (k === " " || k === "Spacebar")) prev();
        else next();
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
      case "Backspace":
        prev();
        break;
      case "Home":
        go(0, { dir: "prev" });
        break;
      case "End":
        go(total - 1, { dir: "next", allSteps: true });
        break;
      case "n":
      case "N":
        toggleNotes();
        break;
      case "p":
      case "P":
        if (!presenter) openPresenter();
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      case "?":
      case "/":
        toggleHelp();
        break;
      case "Escape":
        if (help && help.classList.contains("is-open")) toggleHelp(false);
        else if (notes && notes.classList.contains("is-open")) toggleNotes(false);
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  });

  // Click / tap zones: left third goes back, the rest goes forward.
  deck.addEventListener("click", function (e) {
    if (e.target.closest("a, button, input, textarea, select, summary, [data-no-advance]")) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length) return;
    wake();
    if (e.clientX < window.innerWidth / 3) prev();
    else next();
  });

  // Swipe on touch screens.
  var touchX = null;
  var touchY = null;
  deck.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length !== 1) return;
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    },
    { passive: true }
  );
  deck.addEventListener("touchend", function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    touchX = touchY = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      e.preventDefault(); // stop the synthetic click from also advancing
      if (dx < 0) next();
      else prev();
    }
  });

  if (help) {
    help.addEventListener("click", function () {
      toggleHelp(false);
    });
  }

  window.addEventListener("hashchange", function () {
    var i = hashIndex();
    if (i !== current) go(i);
  });

  // Hide the counter and hint when the presenter is idle.
  var idleTimer = null;
  function wake() {
    document.body.classList.remove("deck-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      document.body.classList.add("deck-idle");
    }, 3500);
  }
  document.addEventListener("mousemove", wake, { passive: true });

  // The hint is for the first few seconds only.
  if (hint) {
    setTimeout(function () {
      hint.style.opacity = "0";
    }, 4500);
  }

  // Before printing, show every step so the PDF backup is complete.
  window.addEventListener("beforeprint", function () {
    slides.forEach(function (_, k) {
      setSteps(k, stepsOf(k).length);
    });
  });
  window.addEventListener("afterprint", function () {
    slides.forEach(function (_, k) {
      if (k !== current) setSteps(k, 0);
    });
  });

  if (reduceMotion && reduceMotion.addEventListener) {
    reduceMotion.addEventListener("change", fit);
  }

  var initialHash = String(location.hash);
  go(hashIndex(), { instant: true });
  var stepMatch = /^#\d+\.(\d+)$/.exec(initialHash);
  if (stepMatch) setSteps(current, Math.min(stepsOf(current).length, parseInt(stepMatch[1], 10)));
  renderNotes();
  if (channel && presenter) channel.postMessage({ type: "hello" });
  wake();

  // Small API for debugging and headless checks.
  window.deck = { next: next, prev: prev, go: go, notes: toggleNotes, presenter: openPresenter, help: toggleHelp, get index() { return current; }, total: total };
})();
