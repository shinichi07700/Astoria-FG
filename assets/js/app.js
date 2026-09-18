/* ============================================================
   APP - navigation router & boot
   ============================================================ */
window.App = (function () {

  var NAV = [
    { id: "dashboard", label: "Dashboard", group: "Overview" },
    { id: "fg", label: "Master F/G", group: "Master Data" },
    { id: "materials", label: "Master Material", group: "Master Data" },
    { id: "bom", label: "Bill of Material", group: "PPIC" },
    { id: "sim", label: "Order Simulation", group: "PPIC" },
    { id: "requests", label: "MR / PR Documents", group: "PPIC" },
    { id: "audit", label: "Audit Log", group: "Control" },
    { id: "settings", label: "Settings & Data", group: "Control" }
  ];
  var RENDER = {
    dashboard: function (r) { ViewsMaster.dashboard(r); },
    fg: function (r) { ViewsMaster.fg(r); },
    materials: function (r) { ViewsMaster.materials(r); },
    bom: function (r) { ViewsBom.list(r); },
    sim: function (r) { ViewsSim.sim(r); },
    requests: function (r) { ViewsSim.requests(r); },
    audit: function (r) { ViewsSim.audit(r); },
    settings: function (r) { ViewsSim.settings(r); }
  };
  var current = "dashboard";

  function renderNav() {
    var nav = UI.clear(document.getElementById("sidenav"));
    var lastGroup = null;
    NAV.forEach(function (n) {
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
    chip.title = (u.email || "no email") + " - click to change acting user";
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
    document.getElementById("user-chip").addEventListener("click", function () { go("settings"); });
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
    var labels = {
      local: "Local mode",
      login: "Cloud sign-in",
      syncing: "Syncing\u2026",
      cloud: n ? "Cloud \u00b7 " + n + " pending" : "Cloud \u00b7 synced",
      offline: "Offline \u00b7 " + n + " queued"
    };
    chip.textContent = labels[s] || "Cloud";
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
