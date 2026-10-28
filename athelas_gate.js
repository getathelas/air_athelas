/*
 * docs.athelas.com consent gate.
 *
 * Mintlify injects every .js file in this repo on every page, so this runs site-wide.
 * Visitors must agree to the Athelas Documentation Access Terms and confirm their email
 * (a link sent to their inbox) before the page content is shown.
 *
 * Every event (agreement, confirmation, pages viewed) is submitted to a Google Form.
 * The Apps Script in scripts/consent_gate/Code.gs sends the confirmation email,
 * checks confirmations, and keeps the Consents and Visits tabs of the Sheet that
 * Legal reads. The browser cannot read Form responses back, so a confirmation link
 * is trusted as soon as it is opened; the Sheet only marks a consent "verified" when
 * the link's signature checks out.
 *
 * This is a consent and tracking layer, not access control: it runs in the browser,
 * so llms-full.txt, the .md page variants, crawlers, and DevTools still reach the
 * content. Real login is the Mintlify Enterprise + User Manager project.
 *
 * Mintlify preview deployments (*.mintlify.site) are not gated, so PR reviewers can
 * read them. Code.gs never emails confirmation links to those origins.
 *
 * Kill switch: set GATE_ENABLED to false. The git history of that line is the record
 * of when the gate was in effect.
 */
(function () {
  "use strict";

  // ---- Config ------------------------------------------------------------------
  var GATE_ENABLED = true;
  // From the Config tab of the "docs.athelas.com consent log" Sheet (written by
  // setup() in Code.gs). An empty FORM_URL keeps the gate off in production;
  // localhost can still exercise it with ?athelas_gate_mock=1.
  var FORM_URL =
    "https://docs.google.com/forms/d/e/1FAIpQLSe8dKIXbawlKbWiEsLd17q3aaGQTeYQwLFgTT5jMe-4Xg7ktg/formResponse";
  // Only these fields are ever sent. The Form also has page, referrer, and user_agent
  // questions from the first version; Legal's notice doesn't list them, so the widget
  // no longer fills them in.
  var FIELDS = {
    event: "entry.19320997",
    consent_id: "entry.60276758",
    token: "entry.1078189791",
    name: "entry.1696448782",
    email: "entry.1440043602",
    company: "entry.509444957",
    terms_version: "entry.841562366",
    paths: "entry.169391222",
    return_url: "entry.472492843",
    device_id: "entry.1437740226",
  };
  // Bump when the Terms change: everyone re-agrees. Keep it in step with the
  // "Last updated" date on the Terms page.
  // Not a date alone: the Terms were revised twice on 2026-10-21.
  var TERMS_VERSION = "2026-10-21.2";
  var CONSENT_TTL_DAYS = 90;
  var LINK_TTL_MS = 24 * 60 * 60 * 1000;
  var TERMS_PATH = "/legal/athelas_documentation_access_terms";
  // Every confirmation link points here, so the link (which the Form stores) never
  // reveals the page someone was on. That page is kept only in their own browser,
  // and they are sent back to it after confirming.
  var LANDING_PATH = "/air_onboard/getting_started_with_air/index";
  // Pages anyone must reach with no gate in the way. ONC requires these to be at a
  // "publicly accessible hyperlink" without preconditions, so don't gate them. Our
  // ONC consultant confirmed this is the complete list and that the ONC feature
  // guides can stay behind the gate.
  var ONC_PUBLIC = [
    // §170.523(k)(1) transparency disclosures
    { path: "/air_developer/onc_certification/mandatory_disclosure", label: "Mandatory Disclosure" },
    // §170.315(b)(10) EHI export format documentation
    { path: "/air_developer/patient_information_export/patient_information_export", label: "EHI Export Format" },
    // §170.315(g)(10) API documentation, §170.404(a)(2)
    { path: "/air_developer/fhir_api/commure_ehr_fhir_api", label: "FHIR API" },
  ];
  var EXEMPT_PATHS = [TERMS_PATH].concat(ONC_PUBLIC.map(function (p) { return p.path; }));
  // Whole sections left public by choice: the What's New tab (and the blog posts it
  // links to) and the Changelog tab.
  var EXEMPT_PREFIXES = ["/master_blogs/", "/master_changelogs/"];
  // Privacy policy linked from the popup. Legal requires the link to land on the
  // policy's "Gated Content Privacy Notice" section. That heading has no HTML id yet,
  // so this uses a text-fragment link (#:~:text=), which current Chrome, Edge,
  // Safari, and Firefox scroll to; older browsers open the top of the policy. If the
  // section gets an id, switch to "#<that id>".
  var PRIVACY_URL = "https://www.athelas.com/legal/privacy-policy#:~:text=Gated%20Content%20Privacy%20Notice";
  var RESEND_COOLDOWN_MS = 60 * 1000;
  var REQUEST_TIMEOUT_MS = 15000;

  var KEY_CONSENT = "athelas_gate_consent";
  var KEY_PENDING = "athelas_gate_pending";
  var KEY_DEVICE = "athelas_gate_device";
  var KEY_MOCK = "athelas_gate_mock";
  var VERIFY_PARAM = "athelas_verify";

  if (window.__athelasGate) return;
  window.__athelasGate = true;

  var root = document.documentElement;
  var isLocalhost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  // Mock mode sticks to this browser (so a confirmation link opened in another tab
  // still uses it) until ?athelas_gate_mock=0.
  var mockParam = /[?&]athelas_gate_mock=([01])\b/.exec(location.search);
  if (isLocalhost && mockParam) localStorage.setItem(KEY_MOCK, mockParam[1]);
  var mock = isLocalhost && localStorage.getItem(KEY_MOCK) === "1";
  // Mintlify preview deployments (<project>-<branch>.mintlify.site). Only Mintlify's
  // own hosts match, never docs.athelas.com or trainings.air.athelas.com.
  var isPreview = /\.mintlify\.(site|app)$/.test(location.hostname);

  if (!GATE_ENABLED || isPreview || (!FORM_URL && !mock)) {
    root.classList.add("athelas-gate-ok");
    return;
  }

  // ---- Storage -------------------------------------------------------------------
  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (e) {
      return null;
    }
  }
  function write(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }
  function randomId() {
    var a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return a[0].toString(36) + a[1].toString(36);
  }
  // The Sheet's key for one agreement. The leading timestamp lets this page tell
  // that a confirmation link has expired without asking the server.
  function newConsentId() {
    return Date.now().toString(36) + "-" + randomId();
  }
  function consentIdAge(id) {
    var t = parseInt(String(id).split("-")[0], 36);
    return isNaN(t) ? Infinity : Date.now() - t;
  }
  var deviceId = localStorage.getItem(KEY_DEVICE);
  if (!deviceId) {
    deviceId = randomId() + randomId();
    localStorage.setItem(KEY_DEVICE, deviceId);
  }

  function validConsent() {
    var c = read(KEY_CONSENT);
    if (!c || c.termsVersion !== TERMS_VERSION || !c.verifiedAt) return null;
    if (Date.now() - c.verifiedAt > CONSENT_TTL_DAYS * 86400000) return null;
    return c;
  }
  function saveConsent(id, who) {
    write(KEY_CONSENT, {
      id: id,
      name: who.name || "",
      email: who.email || "",
      company: who.company || "",
      termsVersion: TERMS_VERSION,
      verifiedAt: Date.now(),
    });
    write(KEY_PENDING, null);
  }
  // Prefill from whatever we last knew about this browser, even an expired consent.
  function lastKnown() {
    return read(KEY_PENDING) || read(KEY_CONSENT) || {};
  }

  // ---- Form submissions ------------------------------------------------------------
  function formBody(data) {
    data.device_id = deviceId;
    data.terms_version = TERMS_VERSION;
    var body = new URLSearchParams();
    Object.keys(data).forEach(function (k) {
      if (FIELDS[k]) body.append(FIELDS[k], data[k] == null ? "" : String(data[k]));
    });
    return body;
  }
  // The Form answers cross-origin posts with an opaque response, so success means
  // "the request reached Google". Network failures and timeouts still reject.
  function submitEvent(data) {
    if (mock) return mockSubmit(data);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    return fetch(FORM_URL, {
      method: "POST",
      mode: "no-cors",
      body: formBody(data),
      signal: ctrl ? ctrl.signal : undefined,
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }
  function beacon(data) {
    if (mock) {
      console.info("[athelas-gate mock] beacon", data);
      return;
    }
    var body = formBody(data);
    if (!(navigator.sendBeacon && navigator.sendBeacon(FORM_URL, body))) {
      fetch(FORM_URL, { method: "POST", mode: "no-cors", body: body, keepalive: true }).catch(function () {});
    }
  }

  // Local stand-in for the Form + Apps Script, so every state can be clicked through
  // on `mint dev`. Only reachable on localhost.
  //   email containing "fail"  -> network error (fail-closed path)
  function mockSubmit(data) {
    console.info("[athelas-gate mock] submit", data);
    if (data.event === "request") {
      if (/fail/.test(data.email)) return Promise.reject(new Error("mock network error"));
      var link = data.return_url + (data.return_url.indexOf("?") < 0 ? "?" : "&") +
        VERIFY_PARAM + "=" + data.consent_id + ".mocktoken";
      console.info("[athelas-gate mock] confirmation link:", link);
      window.__athelasGateMockLink = link;
    }
    return new Promise(function (resolve) {
      setTimeout(resolve, 400);
    });
  }

  // ---- Visit tracking ------------------------------------------------------------
  // Every page view is sent the moment it happens, repeats included: one row per view
  // in the Visits tab. Only verified visitors are logged, so anonymous readers of the
  // public ONC pages leave no trace.
  var lastLoggedPath = null;
  function trackPath() {
    var c = validConsent();
    if (!c) return;
    var path = location.pathname;
    // Route hooks fire on replaceState and hash changes too; one view per path change.
    if (path === lastLoggedPath) return;
    lastLoggedPath = path;
    beacon({ event: "visit", consent_id: c.id, paths: path });
  }

  // ---- Modal ---------------------------------------------------------------------
  var gate = null;
  var state = "form"; // form | sending | sent | expired
  var cooldownTimer = null;

  var TEMPLATE =
    '<div class="athelas-gate__card" role="dialog" aria-modal="true" aria-labelledby="athelas-gate-title">' +
    '<h2 id="athelas-gate-title" class="athelas-gate__title">Before you continue</h2>' +
    '<div data-view="form">' +
    '<p class="athelas-gate__lede">This webpage contains confidential and proprietary information about one or more Athelas products. ' +
    "By clicking “I agree,” you accept the " +
    '<a href="' + TERMS_PATH + '" target="_blank" rel="noopener">Athelas Documentation Access Terms</a> and agree that you will:</p>' +
    '<ul class="athelas-gate__terms">' +
    "<li>keep the materials on Athelas’s product webpages confidential and use them only to evaluate or use Athelas products;</li>" +
    "<li>not copy, share, reverse engineer, or use them to build or improve any competing product; and</li>" +
    "<li>waive and release any claim that Athelas misappropriated, copied, or derived its products from yours.</li>" +
    "</ul>" +
    '<form class="athelas-gate__form" novalidate>' +
    '<label>Full name<input name="name" autocomplete="name" maxlength="120" required></label>' +
    '<label>Work email<input name="email" type="email" autocomplete="email" maxlength="200" required></label>' +
    '<label>Company or practice<input name="company" autocomplete="organization" maxlength="160" required></label>' +
    '<label class="athelas-gate__hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>' +
    '<p class="athelas-gate__privacy">We collect your name, work email, company or practice, and the pages you view to give you access and keep a record of your acceptance. ' +
    "We’ll email you a link to confirm your email address. " +
    'See our <a href="' + PRIVACY_URL + '" target="_blank" rel="noopener">Privacy Policy</a> for what we collect, how we use it, and your opt-out choices.</p>' +
    '<p class="athelas-gate__error" role="alert" hidden></p>' +
    '<button type="submit" class="athelas-gate__primary" disabled>I agree</button>' +
    "</form>" +
    '<p class="athelas-gate__public">Looking for our ONC certification disclosures? These pages are public: ' +
    ONC_PUBLIC.map(function (p) { return '<a href="' + p.path + '">' + p.label + "</a>"; }).join(" · ") +
    "</p>" +
    "</div>" +
    '<div data-view="sent" hidden>' +
    '<p class="athelas-gate__lede">We sent a confirmation link to <strong data-slot="email"></strong>. ' +
    "Open it in this browser to continue. It can take a minute to arrive.</p>" +
    '<p class="athelas-gate__error" role="alert" hidden></p>' +
    '<div class="athelas-gate__row">' +
    '<button type="button" class="athelas-gate__secondary" data-act="resend">Resend link</button>' +
    '<button type="button" class="athelas-gate__link" data-act="change">Use a different email</button>' +
    "</div>" +
    "</div>" +
    "</div>";

  function el(sel) {
    return gate && gate.querySelector(sel);
  }
  function mount() {
    if (gate && document.body.contains(gate)) return;
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "athelas-gate";
      gate.innerHTML = TEMPLATE;
      if (mock) {
        // Say so loudly: in mock mode nothing reaches the Form and no email is sent.
        var badge = document.createElement("p");
        badge.className = "athelas-gate__mock";
        badge.innerHTML =
          "Test mode: no email is sent and nothing is recorded. The confirmation link is in the console. " +
          '<a href="?athelas_gate_mock=0">Turn off test mode</a>';
        el(".athelas-gate__card").insertBefore(badge, el(".athelas-gate__title"));
      }
      wire();
    }
    document.body.appendChild(gate);
    render();
    focusFirstEmpty();
  }
  function wire() {
    var form = el("form");
    var prior = lastKnown();
    ["name", "email", "company"].forEach(function (f) {
      if (prior[f]) form.elements[f].value = prior[f];
    });
    form.addEventListener("input", function () {
      el('[data-view="form"] .athelas-gate__primary').disabled = !formValues();
      showError("");
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      submit();
    });
    gate.addEventListener("click", function (e) {
      var act = e.target.getAttribute && e.target.getAttribute("data-act");
      if (act === "resend") submit(true);
      if (act === "change") {
        write(KEY_PENDING, null);
        setState("form");
        form.elements.email.focus();
        form.elements.email.select();
      }
    });
  }
  function formValues() {
    var f = el("form").elements;
    var v = {
      name: f.name.value.trim(),
      email: f.email.value.trim().toLowerCase(),
      company: f.company.value.trim(),
      website: f.website.value,
    };
    var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email);
    return v.name.length >= 2 && emailOk && v.company.length >= 2 ? v : null;
  }
  function setState(s) {
    state = s;
    render();
  }
  function render() {
    if (!gate) return;
    var view = state === "sent" ? "sent" : "form";
    ["form", "sent"].forEach(function (v) {
      el('[data-view="' + v + '"]').hidden = v !== view;
    });
    var btn = el('[data-view="form"] .athelas-gate__primary');
    btn.disabled = state === "sending" || !formValues();
    btn.textContent = state === "sending" ? "Sending…" : "I agree";
    if (state === "expired") showError("That link has expired. Request a new one below.");
    var p = read(KEY_PENDING);
    if (state === "sent" && p) el('[data-slot="email"]').textContent = p.email;
  }
  function focusFirstEmpty() {
    var f = el("form").elements;
    var target = [f.name, f.email, f.company].filter(function (i) { return !i.value; })[0] || f.name;
    if (state === "form") target.focus();
  }
  function showError(msg) {
    if (!gate) return;
    var view = state === "sent" ? "sent" : "form";
    var box = el('[data-view="' + view + '"] .athelas-gate__error');
    box.textContent = msg;
    box.hidden = !msg;
  }

  // Where to send someone after they confirm: the page they were on. Stored only in
  // their browser (KEY_PENDING), never sent.
  function currentPath() {
    var u = new URL(location.href);
    u.searchParams.delete(VERIFY_PARAM);
    u.searchParams.delete("athelas_gate_mock");
    return u.pathname + u.search;
  }
  // Each send, including a resend, is a new agreement row with its own link.
  function submit(isResend) {
    var p = read(KEY_PENDING);
    var v = isResend && p ? p : formValues();
    if (!v) return;
    if (isResend && p && Date.now() - p.sentAt < RESEND_COOLDOWN_MS) return;
    var id = newConsentId();
    var pending = {
      id: id, name: v.name, email: v.email, company: v.company, sentAt: Date.now(),
      returnPath: (isResend && p && p.returnPath) || currentPath(),
    };
    if (!isResend) setState("sending");
    var sent = v.website
      ? Promise.resolve() // honeypot: look normal, record nothing
      : submitEvent({
          event: "request",
          consent_id: id,
          name: v.name,
          email: v.email,
          company: v.company,
          return_url: location.origin + LANDING_PATH,
        });
    sent
      .then(function () {
        write(KEY_PENDING, pending);
        setState("sent");
        startCooldown();
      })
      .catch(function () {
        // Fail closed: no record, no access.
        setState(isResend ? "sent" : "form");
        showError("We couldn't record your agreement. Check your connection and try again.");
      });
  }
  function startCooldown() {
    var btn = el('[data-act="resend"]');
    clearInterval(cooldownTimer);
    function tick() {
      var p = read(KEY_PENDING);
      var left = p ? Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - p.sentAt)) / 1000) : 0;
      btn.disabled = left > 0;
      btn.textContent = left > 0 ? "Resend link (" + left + "s)" : "Resend link";
      if (left <= 0) clearInterval(cooldownTimer);
    }
    tick();
    cooldownTimer = setInterval(tick, 1000);
  }

  function verifyFromUrl(param) {
    var u = new URL(location.href);
    u.searchParams.delete(VERIFY_PARAM);
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    var parts = param.split(".");
    var id = parts[0];
    var token = parts[1] || "";
    if (!id || !token || consentIdAge(id) > LINK_TTL_MS) {
      setState("expired");
      return;
    }
    var p = read(KEY_PENDING);
    var who = p && p.id === id ? p : lastKnown();
    var backTo = p && p.id === id && p.returnPath;
    submitEvent({ event: "verify", consent_id: id, token: token })
      .then(function () {
        saveConsent(id, who);
        if (backTo && backTo !== currentPath()) location.replace(backTo);
        else unlock();
      })
      .catch(function () {
        setState("form");
        showError("We couldn't confirm your email. Check your connection and reload this page.");
      });
  }

  // ---- Lock state ----------------------------------------------------------------
  function isExempt() {
    var path = location.pathname.replace(/\/+$/, "");
    if (EXEMPT_PATHS.indexOf(path) >= 0) return true;
    return EXEMPT_PREFIXES.some(function (prefix) { return path.indexOf(prefix) === 0; });
  }
  function lock() {
    root.classList.remove("athelas-gate-ok");
    root.classList.add("athelas-gate-locked");
    mount();
  }
  function unlock() {
    root.classList.remove("athelas-gate-locked");
    root.classList.add("athelas-gate-ok");
    if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
    trackPath();
  }
  function evaluate() {
    if (validConsent() || isExempt()) {
      unlock();
      return;
    }
    lock();
  }

  // Keep Mintlify's shortcuts (Cmd+K search, the assistant) from opening behind
  // the modal. Typing in the gate's own inputs still works because the default
  // action is only prevented outside the gate.
  addEventListener(
    "keydown",
    function (e) {
      if (!root.classList.contains("athelas-gate-locked")) return;
      e.stopImmediatePropagation();
      if (!gate || !gate.contains(e.target)) e.preventDefault();
    },
    true
  );

  // Mintlify is a client-side app: re-check on every route change.
  ["pushState", "replaceState"].forEach(function (m) {
    var orig = history[m];
    history[m] = function () {
      var r = orig.apply(this, arguments);
      setTimeout(evaluate, 0);
      return r;
    };
  });
  addEventListener("popstate", evaluate);
  // The confirmation link opened in another tab of this browser unlocks this one.
  addEventListener("storage", function (e) {
    if (e.key === KEY_CONSENT && root.classList.contains("athelas-gate-locked") && validConsent()) unlock();
  });

  // Re-attach the modal if a re-render drops it from <body>.
  function watch() {
    new MutationObserver(function () {
      if (root.classList.contains("athelas-gate-locked") && gate && !document.body.contains(gate)) {
        document.body.appendChild(gate);
      }
    }).observe(document.body, { childList: true });
  }

  function start() {
    watch();
    var param = new URLSearchParams(location.search).get(VERIFY_PARAM);
    if (param) {
      lock();
      verifyFromUrl(param);
      return;
    }
    evaluate();
    var p = read(KEY_PENDING);
    if (root.classList.contains("athelas-gate-locked") && p && Date.now() - p.sentAt < LINK_TTL_MS) {
      setState("sent");
      startCooldown();
    }
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
