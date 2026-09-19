/* ============================================================
   APP - navigation router & boot
   ============================================================ */
window.App = (function () {

  var NAV = [
    { id: "dashboard", label: "Dashboard", group: "Overview" },
    { id: "fg", label: "Master F/G", group: "Master Data" },
    { id: "materials", label: "Master Material", group: "Master Data" },
    { id: "customers", label: "Master Customer", group: "Master Data" },
    { id: "formulas", label: "Master Formula", group: "Master Data" },
    { id: "packagings", label: "Master Packaging", group: "Master Data" },
    { id: "so", label: "Sales Order", group: "Sales" },
    { id: "bom", label: "Bill of Material", group: "PPIC" },
    { id: "ppic", label: "PPIC Netting", group: "PPIC" },
    { id: "sim", label: "Order Simulation", group: "PPIC" },
    { id: "requests", label: "MR / PR Documents", group: "PPIC" },
    { id: "purchasing", label: "Purchasing", group: "Supply Chain" },
    { id: "warehouse", label: "Warehouse / Stock", group: "Supply Chain" },
    { id: "production", label: "Production", group: "Production" },
    { id: "qa", label: "QA / QC", group: "Production" },
    { id: "audit", label: "Audit Log", group: "Control" },
    { id: "settings", label: "Settings & Data", group: "Control" }
  ];
  var RENDER = {
    dashboard: function (r) { ViewsMaster.dashboard(r); },
    fg: function (r) { ViewsMaster.fg(r); },
    materials: function (r) { ViewsMaster.materials(r); },
    customers: function (r) { ViewsMaster.customers(r); },
    formulas: function (r) { ViewsMaster.formulas(r); },
    packagings: function (r) { ViewsMaster.packagings(r); },
    so: function (r) { ViewsSO.list(r); },
    bom: function (r) { ViewsBom.list(r); },
    ppic: function (r) { ViewsPpic.netting(r); },
    sim: function (r) { ViewsSim.sim(r); },
    requests: function (r) { ViewsSim.requests(r); },
    purchasing: function (r) { ViewsPurchasing.list(r); },
    warehouse: function (r) { ViewsWarehouse.list(r); },
    production: function (r) { ViewsProduction.list(r); },
    qa: function (r) { ViewsQA.list(r); },
    audit: function (r) { ViewsSim.audit(r); },
    settings: function (r) { ViewsSim.settings(r); }
  };
  var current = "dashboard";

  /* Settings & Data (backup import/export, reset, role management) is an
     Admin-only page. Offline/local mode has no accounts at all - the acting
     user is the machine owner and this page is the only way to change role or
     export a backup, so it stays reachable there. */
  function isAdmin() { return RBAC.isAdmin(); }
  function canOpenSettings() { return isAdmin() || !(window.Sync && Sync.enabled()); }

  function renderNav() {
    var nav = UI.clear(document.getElementById("sidenav"));
    var lastGroup = null;
    NAV.forEach(function (n) {
      if (n.id === "settings" && !canOpenSettings()) return;
      if (n.group !== lastGroup) {
        nav.appendChild(UI.el("div", { class: "nav-group-label", text: n.group }));
        lastGroup = n.group;
      }
      nav.appendChild(UI.el("button", {
        class: "nav-btn" + (current === n.id ? " active" : ""),
        onclick: function () { go(n.id); }
      }, [
        UI.el("span", { text: n.label })
      ]));
    });
  }

  function go(id) {
    if (id === "settings" && !canOpenSettings()) id = "dashboard";
    if (id !== "bom") ViewsBom.resetEditor();
    closeDrawer();
    current = id;
    renderNav();
    RENDER[id](UI.clear(document.getElementById("view")));
    window.scrollTo(0, 0);
  }
  function refresh() { go(current); }

  function closeDrawer() {
    document.getElementById("sidenav").classList.remove("open");
    document.getElementById("nav-backdrop").classList.remove("show");
  }

  function updateUserChip() {
    var u = Store.get().meta.user;
    var chip = document.getElementById("user-chip");
    chip.textContent = u.name + "  ·  " + u.role;
    chip.title = canOpenSettings()
      ? (u.email || "no email") + " - click to open Settings & Data"
      : (u.email || "no email") + " - signed in as " + u.role;
    var lo = document.getElementById("logout-btn");
    if (lo) lo.hidden = !(window.Sync && Sync.enabled() && window.SB && SB.me());
  }

  function boot() {
    Store.load();
    wireChrome();
    document.getElementById("sync-chip").addEventListener("click", function () {
      if (window.Sync && Sync.enabled()) { Sync.flush(); UI.toast("Sync started", "ok"); }
    });
    if (window.Sync && Sync.enabled()) {
      Sync.onChange(updateSyncChip);
      Sync.init(function (mode) {
        if (mode === "login") { renderLogin(); updateSyncChip(); return; }
        finishBoot();
      });
    } else {
      finishBoot();
    }
  }

  function wireChrome() {
    document.getElementById("user-chip").addEventListener("click", function () {
      if (canOpenSettings()) go("settings");
      else UI.toast("Settings & Data is only available to Admin", "err");
    });
    document.getElementById("logout-btn").addEventListener("click", function () {
      UI.confirmDialog("Sign out of the cloud account? Queued local changes stay on this device.", function () {
        Sync.signOut().then(function () { location.reload(); });
      });
    });
    document.getElementById("menu-btn").addEventListener("click", function () {
      var sn = document.getElementById("sidenav");
      var open = !sn.classList.contains("open");
      sn.classList.toggle("open", open);
      document.getElementById("nav-backdrop").classList.toggle("show", open);
    });
    document.getElementById("nav-backdrop").addEventListener("click", closeDrawer);
  }

  function finishBoot() {
    document.body.classList.remove("login-mode");
    /* Regulatory gate: once per day, recompute NA-expiry statuses and log
       every Aktif -> Non Aktif lapse before the dashboard renders so the
       watchlist + activity feed show the flip immediately. */
    Store.runExpiryAudit();
    updateUserChip();
    updateSyncChip();
    renderNav();
    go("dashboard");
  }

  function updateSyncChip() {
    var chip = document.getElementById("sync-chip");
    if (!chip) return;
    if (!window.Sync || !Sync.enabled()) { chip.hidden = true; return; }
    chip.hidden = false;
    var s = Sync.getStatus();
    var n = Sync.pendingCount();
    /* v2 tables absent on the cloud until migration 002 is run: their rows
       stay queued locally, so say so instead of claiming "synced" */
    var miss = (Sync.missingTables && Sync.missingTables()) || [];
    var labels = {
      local: "Local mode",
      login: "Cloud sign-in",
      syncing: "Syncing\u2026",
      cloud: miss.length
        ? "Cloud \u00b7 migration pending"
        : (n ? "Cloud \u00b7 " + n + " pending" : "Cloud \u00b7 synced"),
      offline: "Offline \u00b7 " + n + " queued"
    };
    chip.textContent = labels[s] || "Cloud";
    chip.title = miss.length
      ? "Cloud schema is behind - run the pending files in supabase/migrations (002, 003, 004, 005). Missing: " + miss.join(", ")
      : "";
    chip.dataset.s = s;
  }

  function renderLogin() {
    document.body.classList.add("login-mode");
    var view = UI.clear(document.getElementById("view"));
    var err = UI.el("div", { class: "login-err", text: "" });
    var iEmail = UI.input({ type: "email", placeholder: "name@astoriaprima.co.id" });
    var iPass = UI.input({ type: "password", placeholder: "Your password" });
    var btn = UI.btn("Sign in", function () {
      btn.disabled = true;
      err.textContent = "";
      Sync.login(iEmail.value.trim(), iPass.value, function () {
        finishBoot();
        UI.toast("Signed in to the Astoria cloud", "ok");
      }, function (msg) {
        err.textContent = msg || "Sign-in failed";
        btn.disabled = false;
      });
    }, "btn-primary");
    view.appendChild(UI.el("div", { class: "login-wrap" }, [
      UI.el("div", { class: "login-card" }, [
        UI.el("img", { class: "login-logo", src: "assets/img/logo.png", alt: "PT Astoria Prima" }),
        UI.el("div", { class: "login-title", text: "Staff sign in" }),
        UI.el("div", {
          class: "login-sub",
          text: "Master F/G, BOM and MR/PR data lives in the company Supabase cloud. Sign in with your staff account."
        }),
        UI.field("Email", iEmail),
        UI.field("Password", iPass),
        err,
        btn
      ])
    ]));
    iPass.addEventListener("keydown", function (e) { if (e.key === "Enter") btn.click(); });
  }

  return { go: go, refresh: refresh, boot: boot, updateUserChip: updateUserChip };
})();

document.addEventListener("DOMContentLoaded", App.boot);
