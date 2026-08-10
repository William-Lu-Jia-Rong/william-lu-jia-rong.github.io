(function () {
  "use strict";

  var root = document.documentElement;
  var body = document.body;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function updatePageChrome() {
    var scrollable = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    var progress = Math.min(1, Math.max(0, window.scrollY / scrollable));
    root.style.setProperty("--scroll-progress", (progress * 100).toFixed(3) + "%");

    var progressBar = document.querySelector("[data-scroll-progress]");
    if (progressBar) {
      progressBar.style.transform = "scaleX(" + progress.toFixed(4) + ")";
    }

    var header = document.querySelector(".site-header");
    if (header) {
      header.classList.toggle("is-scrolled", window.scrollY > 18);
    }
  }

  function setMenuState(isOpen) {
    var toggle = document.querySelector("[data-menu-toggle]");
    var panel = document.querySelector("[data-menu-panel]");
    if (!toggle || !panel) return;

    body.classList.toggle("menu-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.querySelector(".sr-only").textContent = isOpen ? "Close menu" : "Open menu";
    panel.hidden = !isOpen;
  }

  function setupHomepageMenu() {
    var toggle = document.querySelector("[data-menu-toggle]");
    var panel = document.querySelector("[data-menu-panel]");
    if (!toggle || !panel) return;

    toggle.addEventListener("click", function () {
      setMenuState(!body.classList.contains("menu-open"));
    });

    panel.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () { setMenuState(false); });
    });
  }

  function setupInteriorNavigation() {
    var toggle = document.querySelector(".nav-toggle");
    var navigation = document.querySelector(".nav-links");
    if (!toggle || !navigation) return;

    function setOpen(isOpen) {
      body.classList.toggle("nav-open", isOpen);
      toggle.setAttribute("aria-expanded", String(isOpen));
      toggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
    }

    toggle.addEventListener("click", function () {
      setOpen(!body.classList.contains("nav-open"));
    });

    navigation.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () { setOpen(false); });
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 820) setOpen(false);
    });
  }

  function setupReveal() {
    var items = Array.from(document.querySelectorAll("[data-reveal]"));
    if (!items.length) return;

    if (reducedMotion.matches || !("IntersectionObserver" in window)) {
      items.forEach(function (item) { item.classList.add("revealed"); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("revealed");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.08 });

    items.forEach(function (item) {
      item.classList.add("reveal-ready");
      observer.observe(item);
    });
  }

  function setupTilt() {
    if (reducedMotion.matches || window.matchMedia("(pointer: coarse)").matches) return;

    document.querySelectorAll("[data-tilt]").forEach(function (card) {
      card.addEventListener("pointermove", function (event) {
        var rect = card.getBoundingClientRect();
        var x = (event.clientX - rect.left) / rect.width - 0.5;
        var y = (event.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = "perspective(1000px) rotateX(" + (-y * 5).toFixed(2) + "deg) rotateY(" + (x * 6).toFixed(2) + "deg) translateY(-4px)";
      });
      card.addEventListener("pointerleave", function () { card.style.transform = ""; });
    });
  }

  function setupContactForms() {
    document.querySelectorAll("[data-formspree-form]").forEach(function (form) {
      var submit = form.querySelector('button[type="submit"]');
      var status = form.querySelector("[data-form-status]");
      if (!submit || !status) return;

      var originalLabel = submit.textContent;
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        submit.disabled = true;
        submit.textContent = "Sending…";
        status.hidden = false;
        status.className = "form-status";
        status.textContent = "Sending your message…";

        try {
          var response = await fetch(form.action, {
            method: form.method || "POST",
            body: new FormData(form),
            headers: { Accept: "application/json" }
          });

          if (!response.ok) {
            var message = "The message could not be sent. Please email me directly instead.";
            try {
              var payload = await response.json();
              if (Array.isArray(payload.errors) && payload.errors.length) {
                message = payload.errors.map(function (error) { return error.message; }).join(" ");
              }
            } catch (_) {
              // Formspree sometimes returns an empty error body; the fallback is clearer.
            }
            throw new Error(message);
          }

          form.reset();
          status.className = "form-status is-success";
          status.textContent = "Message sent. Thanks — I’ll get back to you soon.";
        } catch (error) {
          status.className = "form-status is-error";
          status.textContent = error && error.message ? error.message : "Unable to send right now. Please email me directly instead.";
        } finally {
          submit.disabled = false;
          submit.textContent = originalLabel;
        }
      });
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    setMenuState(false);
    body.classList.remove("nav-open");
    var navToggle = document.querySelector(".nav-toggle");
    if (navToggle) navToggle.setAttribute("aria-expanded", "false");
  });

  document.addEventListener("DOMContentLoaded", function () {
    updatePageChrome();
    setupHomepageMenu();
    setupInteriorNavigation();
    setupReveal();
    setupTilt();
    setupContactForms();
  });

  window.addEventListener("scroll", updatePageChrome, { passive: true });
  window.addEventListener("resize", updatePageChrome);
}());
