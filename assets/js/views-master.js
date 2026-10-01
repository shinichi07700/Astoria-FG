/* ============================================================
   VIEWS - Dashboard, Master F/G, Master Material
   ============================================================ */
window.ViewsMaster = (function () {

  /* Category vocabulary shared by Master Material and Master Supplier.
     CAT_OPTS is the pickable set; CAT_LABEL also maps the legacy codes
     (RM/PM/AX) so rows saved before this change still render readably. */
  var CAT_OPTS = [
    ["RM-INT", "Raw Material Internal"],
    ["RM-EXT", "Raw Material External"],
    ["PKG-INT", "Packaging Internal"],
    ["PKG-EXT", "Packaging External"],
    ["PREMIX", "Premix"],
    ["AUX-QA", "Auxiliary for QA/QC"]
  ];
  var CAT_LABEL = CAT_OPTS.reduce(function (o, c) { o[c[0]] = c[1]; return o; },
    { RM: "Raw Material (Formula)", PM: "Packaging (Kemas)", AX: "Auxiliary" });
  /* Unit enforced by category (read-only in editor):
     Raw materials and premix weigh in grams; packaging and auxiliary count in pcs. */
  var MAT_CAT_UNIT = {
    "RM-INT": "gr", "RM-EXT": "gr", "PREMIX": "gr",
    "PKG-INT": "pcs", "PKG-EXT": "pcs", "AUX-QA": "pcs",
    "RM": "gr", "PM": "pcs", "AX": "pcs"
  };
  /* Roles, F/G field ownership, master ownership and the document state
     machine live in rbac.js - one source of truth shared by every view
     (and later by the RLS policy generator). Aliased here for brevity. */
  var ROLES = RBAC.ROLES;
  var FG_FIELD_RIGHTS = RBAC.FG_FIELD_RIGHTS;
  function canEditFG() { return RBAC.canEditFG(); }

  /* ---------------- Dashboard ---------------- */
  var STATUS_COLORS = { "Aktif": "#9fe8c7", "Pending BPOM": "#ffd98a", "Non Aktif": "#ffc2c6" };
    var FACET_SVG = "<svg class='hero-facet' viewBox='0 0 100 90' aria-hidden='true'>" +
      "<polygon points='50,2 38,30 62,30' fill='#ffdade'/>" +
      "<polygon points='38,30 26,58 50,58' fill='#f2767c'/>" +
      "<polygon points='62,30 50,58 74,58' fill='#e04b52'/>" +
      "<polygon points='26,58 14,86 38,86' fill='#8f1a1e'/>" +
      "<polygon points='50,58 38,86 62,86' fill='#b12024'/>" +
      "<polygon points='74,58 62,86 86,86' fill='#f2767c'/>" +
      "</svg>";

  function dashboard(root) {
    var db = Store.get();
    var counts = { "Aktif": 0, "Non Aktif": 0, "Pending BPOM": 0 };
    db.fgs.forEach(function (f) { counts[f.status] = (counts[f.status] || 0) + 1; });
    var formulas = {}, kemas = {};
    db.fgs.forEach(function (f) { if (f.ffs) formulas[f.ffs] = 1; if (f.fps) kemas[f.fps] = 1; });
    var total = db.fgs.length;

    /* ----- hero briefing panel ----- */
    var dateLine = new Intl.DateTimeFormat("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta"
    }).format(new Date());
    var hero = UI.el("section", { class: "dash-hero" });
    hero.innerHTML =
      "<div class='hero-col'>" +
        "<div class='hero-kicker'>Master List Finish Good &middot; live briefing</div>" +
        "<div class='hero-total'>" + total + "</div>" +
        "<div class='hero-sub'>finish-good SKUs built from <b>" + Object.keys(formulas).length +
          "</b> formula codes and <b>" + Object.keys(kemas).length + "</b> kemas codes, with <b>" +
          db.boms.length + "</b> BOM on file</div>" +
        "<div class='hero-date'>" + Engine.esc(dateLine) + " &middot; " + Engine.nowWIB().slice(11, 16) +
          " WIB &middot; " + Engine.esc(db.meta.user.role) + " on desk</div>" +
      "</div>" +
      "<div class='hero-col donut-wrap'>" + donutSVG(counts, total) +
        "<div class='donut-legend'>" +
          legendRow("Aktif", counts["Aktif"], total) +
          legendRow("Pending BPOM", counts["Pending BPOM"], total) +
          legendRow("Non Aktif", counts["Non Aktif"], total) +
        "</div>" +
      "</div>" +
      "<div class='hero-col hero-status'>" +
        meterRow("Aktif &amp; trade-ready", counts["Aktif"], total, STATUS_COLORS["Aktif"]) +
        meterRow("Waiting BPOM registration", counts["Pending BPOM"], total, STATUS_COLORS["Pending BPOM"]) +
        meterRow("Non aktif / discontinued", counts["Non Aktif"], total, STATUS_COLORS["Non Aktif"]) +
      "</div>" + FACET_SVG;
    root.appendChild(hero);

    /* ----- quick action tiles ----- */
    var tiles = UI.el("div", { class: "dash-tiles" });
    tiles.appendChild(canEditFG()
      ? tile("+", "New F/G SKU", "formula + kemas + regulatory fields", function () { App.go("fg"); })
      : tile("\u2261", "Browse Master F/G", "view the SKU list & copy codes", function () { App.go("fg"); }));
    tiles.appendChild(tile("≡", "Build a BOM", "complete formula & kemas material list", function () { App.go("bom"); }));
    tiles.appendChild(tile("→", "Simulate an order", "explode BOM into MR / PR", function () { App.go("sim"); }));
    root.appendChild(tiles);

    /* ----- row 1: watchlist + production readiness ----- */
    var warn = db.meta.expWarnDays || 90;
    var todayMs = Engine.parseDate(Engine.todayISO()).getTime();
    var watch = db.fgs.filter(function (f) { return f.tglExpire && Engine.parseDate(f.tglExpire); })
      .map(function (f) {
        f._days = Math.floor((Engine.parseDate(f.tglExpire).getTime() - todayMs) / 86400000);
        return f;
      })
      .sort(function (a, b) { return a._days - b._days; })
      .slice(0, 6);
    var watchHTML = watch.length ? watch.map(function (f) {
      var cls = f._days <= 30 ? "crit" : (f._days <= warn ? "warn" : "ok");
      var lab = f._days < 0 ? "EXP" : f._days + "d";
      return "<div class='watch-item'><span class='days-chip " + cls + "'>" + lab + "</span>" +
        "<div class='w-body'><div class='w-kode'>" + Engine.esc(f.kodeFG) + "</div>" +
        "<div class='w-desc'>" + Engine.esc(f.deskripsi) + "</div></div>" +
        "<div class='w-exp'>NA exp " + Engine.esc(f.tglExpire) + "</div></div>";
    }).join("") : "<div class='empty'>No NA registration carries an expiry date yet.</div>";

    var ready = db.boms.map(function (b) {
      var fg = Store.fgById(b.fgId);
      if (!fg) return null;
      var cap = Infinity, constraint = null;
      b.items.forEach(function (it) {
        var m = Store.matMap()[it.materialCode];
        if (!m) return;
        var per = (Number(it.qtyPerUnit) || 0) * (1 + (Number(it.lossPct) || 0) / 100);
        if (per <= 0) return;
        var u = Math.floor((Number(m.stockQty) || 0) / per);
        if (u < cap) { cap = u; constraint = m; }
      });
      return { fg: fg, units: cap === Infinity ? 0 : cap, constraint: constraint };
    }).filter(Boolean);
    var readHTML = ready.length ? ready.map(function (r) {
      var scale = Math.max(1000, r.units);
      var pct = Math.min(100, Math.round(r.units / scale * 100));
      return "<div class='read-row'><div class='read-head'><span class='r-name'>" + Engine.esc(r.fg.deskripsi) +
        "</span><b>&asymp; " + r.units.toLocaleString("en-US") + " pcs</b></div>" +
        "<div class='meter light'><i style='width:" + pct + "%;background:linear-gradient(90deg,var(--accent),var(--rose))'></i></div>" +
        "<div class='constraint'>from current warehouse stock &middot; binding constraint: <b>" +
        Engine.esc(r.constraint ? r.constraint.name : "-") + "</b>" +
        (r.constraint ? " (on hand " + Engine.fmtNum(r.constraint.stockQty) + " " + Engine.esc(r.constraint.unit) + ")" : "") +
        "</div></div>";
    }).join("") : "<div class='empty'>No BOM yet - readiness cannot be projected.</div>";

    var g1 = UI.el("div", { class: "dash-grid" });
    g1.appendChild(panel("BPOM & expiry watchlist", "Every NA registration ordered by urgency - red ≤ 30 days, amber inside the " + warn + "-day window, green beyond", watchHTML));
    g1.appendChild(panel("PPIC readiness", "How many pieces each BOM can build from stock on hand right now", readHTML));
    root.appendChild(g1);

    /* ----- row 2: warehouse alerts + activity feed ----- */
    var zero = db.materials.filter(function (m) { return (Number(m.stockQty) || 0) <= 0; });
    var alertHTML = zero.length ? zero.map(function (m) {
      return "<span class='alert-chip'><i class='dot'></i>" + Engine.esc(m.code) + " &middot; " + Engine.esc(m.name) + "</span>";
    }).join("") : "<div class='ok-note'>Warehouse covers every stocked material - no zero-stock line.</div>";

    /* Activity feed: role-filtered so each user only sees their domain.
       Admin sees everything; other roles see only their DASH_ENTITIES. */
    var feedEntries = db.audit;
    if (!RBAC.isAdmin()) {
      var visible = RBAC.DASH_ENTITIES[db.meta.user.role] || [];
      feedEntries = feedEntries.filter(function (a) { return visible.indexOf(a.entity) >= 0; });
    }
    var feedHTML = feedEntries.length ? "<div class='feed'>" + feedEntries.slice(0, 6).map(function (a) {
      return "<div class='feed-item'><div><b>" + Engine.esc(a.action) + "</b> " + Engine.esc(a.entity) +
        " &mdash; " + Engine.esc(a.detail) + "</div>" +
        "<div class='f-meta'>" + Engine.esc(a.ts) + " WIB &middot; " + Engine.esc(a.user) + "</div></div>";
    }).join("") + "</div>" : "<div class='empty'>No activity recorded yet for your role.</div>";

    var g2 = UI.el("div", { class: "dash-grid" });
    g2.appendChild(panel("Warehouse alerts", "Zero-stock items block the next production run", alertHTML));
    var feedHint = RBAC.isAdmin() ? "Latest changes captured across all modules" : "Latest activity relevant to " + db.meta.user.role;
    g2.appendChild(panel("Activity feed", feedHint, feedHTML));
    root.appendChild(g2);
  }

  function donutSVG(counts, total) {
    var r = 46, c = 2 * Math.PI * r, acc = 0;
    var segs = ["Aktif", "Pending BPOM", "Non Aktif"].map(function (k) {
      var frac = total ? (counts[k] || 0) / total : 0;
      var s = "<circle r='" + r + "' cx='69' cy='69' fill='none' stroke='" + STATUS_COLORS[k] +
        "' stroke-width='15' stroke-linecap='butt' stroke-dasharray='" + (frac * c).toFixed(2) + " " +
        (c - frac * c).toFixed(2) + "' stroke-dashoffset='" + (-acc * c).toFixed(2) + "'/>";
      acc += frac;
      return s;
    }).join("");
    var pctAktif = total ? Math.round((counts["Aktif"] || 0) / total * 100) : 0;
    return "<div class='donut-box'><svg width='138' height='138' viewBox='0 0 138 138' style='transform:rotate(-90deg)'>" +
      segs + "</svg><div class='donut-center'><b>" + pctAktif + "%</b><span>aktif</span></div></div>";
  }
  function legendRow(label, value, total) {
    var pct = total ? Math.round(value / total * 100) : 0;
    return "<span class='legend-row'><i class='legend-dot' style='background:" + STATUS_COLORS[label] + "'></i>" +
      label + " <b>" + value + "</b> <span class='lg-pct'>" + pct + "%</span></span>";
  }
  function meterRow(label, value, total, color) {
    var pct = total ? Math.round(value / total * 100) : 0;
    return "<div class='hstat'><div class='row'><span>" + label + "</span><b>" + value + " &middot; " + pct + "%</b></div>" +
      "<div class='meter'><i style='width:" + pct + "%;background:" + color + "'></i></div></div>";
  }
  function tile(glyph, label, sub, fn) {
    return UI.el("button", { class: "dash-tile", type: "button", onclick: fn }, [
      UI.el("span", { class: "t-ico", text: glyph }),
      UI.el("span", { class: "t-label", text: label }),
      UI.el("span", { class: "t-sub", text: sub })
    ]);
  }
  function panel(title, sub, innerHTML) {
    return UI.el("section", { class: "panel" }, [
      UI.el("h3", { text: title }),
      UI.el("div", { class: "p-sub", text: sub }),
      UI.el("div", { html: innerHTML })
    ]);
  }

  /* ---------------- Master F/G ---------------- */
  var fgFilter = { q: "", status: "ALL" };
  var fgCountEl = null;
  var FG_CHIPS = [
    ["ALL", "All status"],
    ["Aktif", "Aktif"],
    ["Pending BPOM", "Pending BPOM"],
    ["Non Aktif", "Non Aktif"],
    ["DISCONTINUE", "Discontinue"]
  ];

  function fg(root) {
    var db = Store.get();
    var headActions = [UI.btn("Export Sheet CSV", function () { Store.exportMasterCSV(); UI.toast("Master F/G CSV downloaded", "ok"); }, "")];
    if (canEditFG()) headActions.push(UI.btn("+ New F/G SKU", function () { fgEditor(null); }, "btn-primary"));
    root.appendChild(UI.pageHead("Master List Finish Good", "", headActions));

    var search = UI.input({ placeholder: "Search code, description, FFS, FPS, NA...", value: fgFilter.q });
    var body = UI.el("div", { class: "card-body tight" });
    search.addEventListener("input", function () { fgFilter.q = search.value; renderFGTable(body); });
    var chips = UI.el("div", { class: "filter-chips" });
    FG_CHIPS.forEach(function (c) {
      chips.appendChild(UI.el("button", {
        class: "chip" + (fgFilter.status === c[0] ? " active" : ""), text: c[1],
        onclick: function () { fgFilter.status = c[0]; App.refresh(); }
      }));
    });
    /* the SKU counter sits right after the status chips so it reads as part
       of the selector, not as a far-right page statistic */
    fgCountEl = UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.fgs.length + " SKU" });
    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, chips, fgCountEl]));
    card.appendChild(body);
    root.appendChild(card);
    renderFGTable(body);
  }

  function renderFGTable(body) {
    UI.clear(body);
    var db = Store.get();
    var q = fgFilter.q.toLowerCase();
    var rows = db.fgs.filter(function (f) {
      /* Discontinue shows every flagged row; Non Aktif shows only rows that
         are inactive for other reasons (discontinued ones have their chip). */
      if (fgFilter.status === "DISCONTINUE") { if (!f.discontinue) return false; }
      else if (fgFilter.status === "Non Aktif") { if (f.status !== "Non Aktif" || f.discontinue) return false; }
      else if (fgFilter.status !== "ALL" && f.status !== fgFilter.status) return false;
      if (!q) return true;
      return (f.kodeFG + " " + f.deskripsi + " " + f.ffs + " " + f.fps + " " + f.kodeNA).toLowerCase().indexOf(q) >= 0;
    });
    /* most recently updated first (Waktu Update desc) */
    rows.sort(Store.fgRecentCompare);
    if (fgCountEl) {
      fgCountEl.textContent = (fgFilter.status !== "ALL" || q)
        ? rows.length + " of " + db.fgs.length + " SKU"
        : db.fgs.length + " SKU";
    }
    var cols = [
      { label: "F/G Product Code", render: function (r) {
        return UI.el("div", { style: "display:flex;gap:6px;align-items:center" }, [
          UI.el("span", { class: "mono", style: "font-weight:700", text: r.kodeFG }),
          UI.btn("copy", function () { UI.copyText(r.kodeFG); }, "btn-ghost btn-sm")
        ]);
      } },
      { label: "Product Description", render: function (r) {
        return UI.el("div", { style: "display:flex;gap:6px;align-items:center" }, [
          UI.el("span", { text: r.deskripsi }),
          UI.btn("copy", function () { UI.copyText(r.deskripsi); }, "btn-ghost btn-sm")
        ]);
      } },
      { label: "F/G Status", render: function (r) { return UI.pill(r.status); } },
      { label: "FFS Formula", cls: "mono", key: "ffs" },
      { label: "FPS Packaging", cls: "mono", key: "fps" },
      { label: "NA Code", cls: "mono", render: function (r) { return r.kodeNA || "<span class='row-muted'>-</span>"; } },
      { label: "NA Expiry Date", cls: "mono", render: function (r) { return r.tglExpire || "<span class='row-muted'>-</span>"; } },
      { label: "Discontinue", render: function (r) { return r.discontinue ? UI.tag("YES") : "<span class='row-muted'>-</span>"; } },
      { label: "Modified By / When", render: function (r) {
        return UI.el("div", { style: "font-size:11px;color:var(--muted)" }, [
          UI.el("div", { text: r.diubahOleh || "-" }),
          UI.el("div", { class: "mono", text: r.waktuUpdate || "-" })
        ]);
      } }
    ];
    if (canEditFG()) cols.push({ label: "", render: function (r) {
        return UI.el("div", { class: "btn-row" }, [
          UI.btn("Edit", function () { fgEditor(r); }, "btn-sm"),
          UI.btn("Revision", function () { fgRevision(r); }, "btn-sm"),
          UI.btn("Delete", function () {
            UI.confirmDialog("Delete F/G " + r.kodeFG + "? BOMs referencing it will keep a dangling reference.", function () {
              Store.deleteFG(r.id); App.refresh();
            });
          }, "btn-danger btn-sm")
        ]);
      } });
    body.appendChild(UI.table(cols, rows, { emptyText: "No F/G matches the current filter." }));
  }

  function fgEditor(rec) {
    if (!canEditFG()) {
      UI.toast("Master F/G is read-only for " + (Store.get().meta.user || {}).role, "err");
      return;
    }
    var isNew = !rec;
    var d = Object.assign({ ffs: "", fps: "", deskripsi: "", kodeNA: "", tglExpire: "", discontinue: false }, rec || {});

    var pvKode = UI.el("span", { class: "pv-kode", text: "-" });
    var pvStatus = UI.el("span");
    function preview() {
      pvKode.textContent = Engine.kodeFG(d.ffs, d.fps) || "(empty)";
      UI.clear(pvStatus);
      pvStatus.appendChild(UI.pill(Engine.evaluateStatus(d.ffs, d.fps, d.kodeNA, d.tglExpire, d.discontinue)));
    }

    var iFfs = UI.input({ class: "input mono", value: d.ffs, placeholder: "e.g. TO01MR03" });
    var iFps = UI.input({ class: "input mono", value: d.fps, placeholder: "e.g. 100200100" });
    var iDesc = UI.input({ value: d.deskripsi, placeholder: "Brand + product + size" });
    var iNa = UI.input({ class: "input mono", value: d.kodeNA, placeholder: "NA1826..." });
    var iExp = UI.input({ type: "date", value: d.tglExpire || "" });
    [iFfs, iFps, iDesc, iNa, iExp].forEach(function (n) {
      n.addEventListener("input", function () {
        d.ffs = iFfs.value.trim(); d.fps = iFps.value.trim(); d.deskripsi = iDesc.value.trim();
        d.kodeNA = iNa.value.trim(); d.tglExpire = iExp.value;
        preview();
      });
    });
    var disc = UI.checkRow("Discontinue / superseded revision (forces status Non Aktif)", d.discontinue, function (v) { d.discontinue = v; preview(); });

    /* Field-level rights: fields this role does not own become read-only
       (grey styling) with a tooltip naming the owning department; the
       Discontinue checkbox is disabled instead (readonly n/a to boxes). */
    var role = (Store.get().meta.user || {}).role;
    var rights = FG_FIELD_RIGHTS[role] || { ffs: true, fps: true, desc: true, na: true, exp: true, disc: true };
    function lockField(inp, editable, who) {
      if (!editable) {
        inp.readOnly = true;
        inp.title = "Locked for " + role + " - " + who;
      }
    }
    lockField(iFfs, rights.ffs, "RND Formula / Regulatory own the formula code");
    lockField(iFps, rights.fps, "RND Kemas owns the kemas code");
    lockField(iDesc, rights.desc, "owned by the master-data roles");
    lockField(iNa, rights.na, "Regulatory owns Kode NA");
    lockField(iExp, rights.exp, "Regulatory owns the NA expiry date");
    var discCb = disc.querySelector("input");
    if (discCb && !rights.disc) { discCb.disabled = true; discCb.title = "Locked for " + role; }
    function lk(editable) { return editable ? "" : " Locked for your role."; }

    var body = UI.el("div", {}, [
      UI.el("div", { class: "preview-box" }, [
        UI.el("div", {}, [UI.el("div", { class: "pv-label", text: "F/G Product Code (auto)" }), pvKode]),
        UI.el("div", {}, [UI.el("div", { class: "pv-label", text: "F/G Status (auto)" }), pvStatus])
      ]),
      fieldset("RND Formula", [UI.field("FFS Formula code", iFfs, "Initial formula code input by RND formula team; corrected after BPOM approval." + lk(rights.ffs))]),
      fieldset("RND Packaging", [UI.field("FPS Packaging code", iFps, "Packaging code entered by RND Packaging team." + lk(rights.fps))]),
      fieldset("Regulatory", [
        UI.field("Product Description", iDesc, rights.desc ? null : "Locked for your role."),
        UI.el("div", { class: "form-grid" }, [
          UI.field("NA Code (BPOM)", iNa, (rights.na ? "Leave empty while registration is in progress -> status Pending BPOM." : "") + lk(rights.na)),
          UI.field("NA Expiry Date", iExp, (rights.exp ? "Passed date -> status flips to Non Aktif on next refresh." : "") + lk(rights.exp))
        ])
      ]),
      disc
    ]);
    preview();

    UI.modal({
      title: isNew ? "New Finish Good SKU" : "Edit Finish Good - " + rec.kodeFG,
      body: body,
      wide: true,
      actions: [{
        label: "Save SKU", cls: "btn-primary", onClick: function () {
          if (!d.ffs && !d.fps) { UI.toast("FFS Formula or FPS Packaging is required", "err"); return; }
          var id = d.ffs + "|" + d.fps;
          if (isNew && Store.fgById(id)) { UI.toast("SKU already exists: " + Engine.kodeFG(d.ffs, d.fps), "err"); return; }
          if (!isNew && id !== rec.id && Store.fgById(id)) { UI.toast("Another SKU already uses " + Engine.kodeFG(d.ffs, d.fps), "err"); return; }
          d.id = id;
          Store.saveFG(d, isNew, rec ? rec.id : null);
          UI.closeModal();
          UI.toast("Saved " + Engine.kodeFG(d.ffs, d.fps) + " - status " + d.status, "ok");
          App.refresh();
        }
      }]
    });
  }
  function fieldset(legend, kids) {
    return UI.el("fieldset", { class: "role-group" }, [UI.el("legend", { text: legend })].concat(kids));
  }

  /* ---------------- Revision workflow ----------------
     Formula / kemas code revised for the same product: instead of the
     user re-typing a whole new SKU, one dialog supersedes the old row
     (auto Discontinue -> Non Aktif) and creates the new revision with
     Kode NA / Tgl Expire NA cleared (BPOM recertification) -> Pending BPOM. */
  function fgRevision(rec) {
    var role = (Store.get().meta.user || {}).role;
    var rights = FG_FIELD_RIGHTS[role] || { ffs: true, fps: true };
    var iFfs = UI.input({ class: "input mono", value: rec.ffs, placeholder: "e.g. TO01MR03" });
    var iFps = UI.input({ class: "input mono", value: rec.fps, placeholder: "e.g. 100200100" });
    if (!rights.ffs) { iFfs.readOnly = true; iFfs.title = "Locked for " + role; }
    if (!rights.fps) { iFps.readOnly = true; iFps.title = "Locked for " + role; }
    var body = UI.el("div", {}, [
      UI.el("div", { class: "preview-box", style: "margin-bottom:12px" }, [
        UI.el("div", { style: "font-size:12.5px;line-height:1.7" }, [
          UI.el("div", { html: "Current SKU <span class='mono' style='font-weight:700'>" + Engine.esc(rec.kodeFG) +
            "</span> will be marked <b>Discontinue</b> (status Non Aktif) as superseded." }),
          UI.el("div", { html: "The new revision keeps the same Product Description but starts <b>without NA Code and NA Expiry Date</b> (BPOM recertification required) &rarr; status Pending BPOM." }),
          UI.el("div", { html: "BOMs referencing the old SKU keep their reference; build a new BOM for the revision when ready." })
        ])
      ]),
      UI.el("div", { class: "form-grid" }, [
        UI.field("New FFS Formula code", iFfs, rights.ffs ? "Change this when the formula (bulk) is revised." : "Locked for your role."),
        UI.field("New FPS Packaging code", iFps, rights.fps ? "Change this when the packaging is revised." : "Locked for your role.")
      ])
    ]);
    UI.modal({
      title: "New revision - " + rec.kodeFG,
      body: body,
      actions: [{
        label: "Create revision", cls: "btn-primary", onClick: function () {
          var ffs = iFfs.value.trim(), fps = iFps.value.trim();
          if (!ffs && !fps) { UI.toast("FFS Formula or FPS Kemas is required", "err"); return; }
          if (ffs === rec.ffs && fps === rec.fps) { UI.toast("Change at least one code to create a revision", "err"); return; }
          var id = ffs + "|" + fps;
          if (Store.fgById(id)) { UI.toast("SKU already exists: " + Engine.kodeFG(ffs, fps), "err"); return; }
          UI.closeModal();
          var nu = Store.reviseFG(rec.id, ffs, fps);
          if (nu) {
            UI.toast("Revision " + nu.kodeFG + " created - " + rec.kodeFG + " discontinued (Pending BPOM until recertified)", "ok");
            App.refresh();
          }
        }
      }]
    });
  }

  /* ---------------- Master Material ---------------- */
  var matFilter = { q: "", cat: "ALL" };

  function materials(root) {
    var db = Store.get();
    root.appendChild(UI.pageHead("Master Material",
      "All items used by BOMs: internal/external raw materials, internal/external packaging, premix blends and QA/QC auxiliary. Formula-side categories feed the BOM Formula pool, packaging the Kemas pool; QA/QC auxiliary is not a product component. On-hand stock drives the Material Request vs Purchase Request split in the order simulation.",
      [UI.btn("+ New Material", function () { matEditor(null); }, "btn-primary")]));

    var search = UI.input({ placeholder: "Search item code / description...", value: matFilter.q });
    search.addEventListener("input", function () { matFilter.q = search.value; draw(); });
    var chips = UI.el("div", { class: "filter-chips" });
    [["ALL", "All"]].concat(CAT_OPTS).forEach(function (c) {
      chips.appendChild(UI.el("button", {
        class: "chip" + (matFilter.cat === c[0] ? " active" : ""), text: c[1],
        onclick: function () { matFilter.cat = c[0]; App.refresh(); }
      }));
    });

    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = matFilter.q.toLowerCase();
      var rows = db.materials.filter(function (m) {
        if (matFilter.cat !== "ALL" && m.category !== matFilter.cat) return false;
        if (!q) return true;
        return (m.code + " " + m.name + " " + (m.supplier || "")).toLowerCase().indexOf(q) >= 0;
      });
      bodyWrap.appendChild(UI.table([
        { label: "Item Code", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.code) + "</b>"; } },
        { label: "Description", key: "name" },
        { label: "Category", render: function (r) { return UI.tag(CAT_LABEL[r.category] || r.category); } },
        { label: "Unit", key: "unit" },
        { label: "On Hand", cls: "num", render: function (r) {
          var v = Number(r.stockQty) || 0;
          return v <= 0 ? "<b style='color:var(--red)'>" + Engine.fmtNum(v) + "</b>" : Engine.fmtNum(v);
        } },
        { label: "Stocked", render: function (r) { return r.stocked ? UI.tag("Stocked") : UI.tag("Non-stock / direct buy"); } },
        { label: "Supplier", render: function (r) {
          var links = r.supplierLinks || [];
          var nm = supplierName(r.supplierId) || r.supplier || "";
          if (!nm) return "<span class='row-muted'>-</span>";
          var badge = links.length > 1 ? " <span style='font-size:10px;color:var(--muted)'>(+" + (links.length - 1) + ")</span>" : "";
          return Engine.esc(nm) + badge;
        } },
        { label: "", render: function (r) {
          return UI.el("div", { class: "btn-row" }, [
            UI.btn("Edit", function () { matEditor(r); }, "btn-sm"),
            UI.btn("Delete", function () {
              UI.confirmDialog("Delete material " + r.code + "?", function () {
                if (!Store.deleteMaterial(r.code)) UI.toast("Material is used in a BOM - cannot delete", "err");
                else App.refresh();
              });
            }, "btn-danger btn-sm")
          ]);
        } }
      ], rows, { emptyText: "No material matches the filter." }));
    }
    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, chips, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.materials.length + " items" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    root.appendChild(card);
    draw();
  }

  function matEditor(rec) {
    var isNew = !rec;
    var d = Object.assign({ code: "", name: "", category: "RM-INT", unit: "", stockQty: 0, stocked: true, supplier: "", supplierId: "", supplierLinks: [] }, rec || {});
    /* Backward compat: if no links yet, derive from single supplierId */
    if (!d.supplierLinks.length && d.supplierId) {
      d.supplierLinks = [{ supplierId: d.supplierId, moq: Number(d.moq) || 0, leadDays: Number(d.leadDays) || 0 }];
    }
    /* enforce unit from category; fall back to stored unit for legacy */
    d.unit = MAT_CAT_UNIT[d.category] || d.unit || "gr";
    var iCode = UI.input({ class: "input mono", value: d.code, placeholder: "e.g. 30200001" });
    var iName = UI.input({ value: d.name });
    var iCat = UI.select(CAT_OPTS, d.category);
    /* Unit is read-only: auto-filled from category selection */
    var iUnit = UI.input({ value: d.unit, disabled: true, style: "background:#f4f5f7;color:var(--muted);cursor:not-allowed" });
    iCat.addEventListener("change", function () {
      iUnit.value = MAT_CAT_UNIT[iCat.value] || "";
    });
    var iStock = UI.input({ type: "number", step: "0.0001", value: String(d.stockQty) });

    /* --- Multi-supplier links table --- */
    var linksWrap = UI.el("div", { class: "supplier-links-table" });
    function addLinkRow(link) {
      var row = UI.el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:6px" });
      var iSup = supplierCombo(link.supplierId || "");
      iSup.style.flex = "2";
      var iMoq = UI.input({ type: "number", step: "0.001", min: "0", value: String(link.moq || ""), placeholder: "MOQ", style: "width:80px" });
      var iLead = UI.input({ type: "number", step: "1", min: "0", value: String(link.leadDays || ""), placeholder: "Days", style: "width:70px" });
      var tag = UI.el("span", { class: "pill aktif", style: "font-size:10px;padding:2px 6px", text: "Primary" });
      var rmBtn = UI.btn("\u00d7", function () { row.remove(); refreshPrimaryTags(); }, "btn-danger btn-sm");
      row.appendChild(iSup); row.appendChild(tag); row.appendChild(iMoq); row.appendChild(iLead); row.appendChild(rmBtn);
      row._iSup = iSup; row._iMoq = iMoq; row._iLead = iLead; row._tag = tag;
      linksWrap.appendChild(row);
    }
    function refreshPrimaryTags() {
      var rows = linksWrap.children;
      for (var i = 0; i < rows.length; i++) {
        rows[i]._tag.style.display = i === 0 ? "" : "none";
        if (rows.length === 1) rows[i]._tag.style.display = "none";
      }
    }
    (d.supplierLinks.length ? d.supplierLinks : [{ supplierId: "", moq: 0, leadDays: 0 }]).forEach(addLinkRow);
    refreshPrimaryTags();
    var addBtn = UI.btn("+ Add Supplier", function () { addLinkRow({ supplierId: "", moq: 0, leadDays: 0 }); refreshPrimaryTags(); }, "btn-sm");
    var linksBlock = UI.el("div", {}, [
      UI.el("div", { style: "font-weight:600;font-size:12px;margin-bottom:4px", text: "Suppliers (first = primary)" }),
      UI.el("div", { style: "display:flex;gap:8px;margin-bottom:4px;font-size:10.5px;color:var(--muted)" }, [
        UI.el("span", { style: "flex:2", text: "Supplier" }),
        UI.el("span", { style: "width:80px", text: "MOQ" }),
        UI.el("span", { style: "width:70px", text: "Lead (days)" }),
        UI.el("span", { style: "width:28px", text: "" })
      ]),
      linksWrap, addBtn
    ]);

    var body = UI.el("div", {}, [
      UI.el("div", { class: "form-grid" }, [
        UI.field("Item Code", iCode),
        UI.field("Category", iCat),
        UI.field("Description", iName),
        UI.field("Unit", iUnit, "Auto from category (gr = raw/premix, pcs = packaging/aux)."),
        UI.field("On-hand stock", iStock)
      ]),
      linksBlock,
      UI.checkRow("Stocked item (warehouse keeps stock; shortages become Purchase Request)", d.stocked, function (v) { d.stocked = v; })
    ]);
    UI.modal({
      title: isNew ? "New Material" : "Edit Material - " + rec.code,
      body: body,
      wide: true,
      actions: [{
        label: "Save Material", cls: "btn-primary", onClick: function () {
          d.code = iCode.value.trim(); d.name = iName.value.trim();
          d.category = iCat.value; d.unit = iUnit.value.trim() || MAT_CAT_UNIT[iCat.value] || "gr";
          d.stockQty = Number(iStock.value) || 0;
          /* Collect supplier links from the table rows */
          d.supplierLinks = [];
          var rows = linksWrap.children;
          for (var i = 0; i < rows.length; i++) {
            var sid = rows[i]._iSup.value;
            if (sid) d.supplierLinks.push({ supplierId: sid, moq: Number(rows[i]._iMoq.value) || 0, leadDays: Number(rows[i]._iLead.value) || 0 });
          }
          /* Derive primary for backward compat */
          var primary = d.supplierLinks[0] || {};
          d.supplierId = primary.supplierId || "";
          d.supplier = supplierName(d.supplierId);
          d.moq = primary.moq || 0;
          d.leadDays = primary.leadDays || 0;
          if (!d.code || !d.name) { UI.toast("Item code and description are required", "err"); return; }
          if (isNew && Store.matMap()[d.code]) { UI.toast("Item code already exists", "err"); return; }
          if (!isNew && d.code !== rec.code && Store.matMap()[d.code]) { UI.toast("Item code already exists", "err"); return; }
          Store.saveMaterial(d, isNew, rec ? rec.code : null);
          UI.closeModal(); App.refresh();
          UI.toast("Material " + d.code + " saved", "ok");
        }
      }]
    });
  }

  /* ---------------- Master Customer ----------------
     Customers own finished-good brands and (from Phase 2) raise sales orders.
     Maintained by Marketing; every other role sees a read-only list. */
  var custFilter = { q: "" };

  function customers(root) {
    var db = Store.get();
    var canEdit = RBAC.canEditMaster("customers");
    root.appendChild(UI.pageHead("Master Customer",
      "Customer / brand owners referenced by the production BOM and, from Phase 2, by Sales Orders. Maintained by Marketing.",
      canEdit ? [UI.btn("+ New Customer", function () { custEditor(null); }, "btn-primary")] : []));

    var search = UI.input({ placeholder: "Search code / name / PIC...", value: custFilter.q });
    search.addEventListener("input", function () { custFilter.q = search.value; draw(); });
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = custFilter.q.toLowerCase();
      var rows = db.customers.filter(function (c) {
        if (!q) return true;
        return (c.id + " " + (c.name || "") + " " + (c.pic || "")).toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) {
        return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
      });
      var cols = [
        { label: "Code", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.id) + "</b>"; } },
        { label: "Name", key: "name" },
        { label: "PIC", render: function (r) { return Engine.esc(r.pic || "-"); } },
        { label: "Contact", render: function (r) { return Engine.esc(r.contact || "-"); } },
        { label: "Terms", render: function (r) { return Engine.esc(r.terms || "-"); } },
        { label: "Address", render: function (r) { return Engine.esc(r.address || "-"); } }
      ];
      if (canEdit) cols.push({ label: "", render: function (r) {
        return UI.el("div", { class: "btn-row" }, [
          UI.btn("Edit", function () { custEditor(r); }, "btn-sm"),
          UI.btn("Delete", function () {
            UI.confirmDialog("Delete customer " + r.id + " (" + (r.name || "") + ")? BOMs keep their text reference.", function () {
              Store.deleteCustomer(r.id); App.refresh();
            });
          }, "btn-danger btn-sm")
        ]);
      } });
      bodyWrap.appendChild(UI.table(cols, rows, { emptyText: "No customer yet. Create the first one." }));
    }
    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.customers.length + " customers" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    root.appendChild(card);
    draw();
    if (!canEdit) root.appendChild(UI.el("div", { class: "hint", style: "margin-top:6px",
      text: "Read-only for " + ((db.meta.user || {}).role || "your role") + " - the customer master is maintained by Marketing." }));
  }

  function custEditor(rec) {
    if (!RBAC.canEditMaster("customers")) { UI.toast("Customer master is read-only for your role", "err"); return; }
    var isNew = !rec;
    var d = Object.assign({ id: "", name: "", address: "", pic: "", contact: "", terms: "" }, rec || {});
    var iCode = UI.input({ class: "input mono", value: d.id, placeholder: "e.g. CUST-001" });
    var iName = UI.input({ value: d.name, placeholder: "Customer / brand owner" });
    var iPic = UI.input({ value: d.pic, placeholder: "Person in charge" });
    var iContact = UI.input({ value: d.contact, placeholder: "Phone / email" });
    var iTerms = UI.input({ value: d.terms, placeholder: "e.g. TOP 30 days" });
    var iAddr = UI.el("textarea", { class: "input", rows: "2", style: "width:100%", placeholder: "Billing / shipping address" });
    iAddr.value = d.address || "";
    var body = UI.el("div", {}, [
      UI.el("div", { class: "form-grid" }, [
        UI.field("Customer Code", iCode),
        UI.field("Name", iName),
        UI.field("PIC", iPic),
        UI.field("Contact", iContact),
        UI.field("Terms", iTerms)
      ]),
      UI.field("Address", iAddr)
    ]);
    UI.modal({
      title: isNew ? "New Customer" : "Edit Customer - " + rec.id,
      body: body,
      actions: [{
        label: "Save Customer", cls: "btn-primary", onClick: function () {
          d.id = iCode.value.trim(); d.name = iName.value.trim(); d.pic = iPic.value.trim();
          d.contact = iContact.value.trim(); d.terms = iTerms.value.trim(); d.address = iAddr.value.trim();
          if (!d.id || !d.name) { UI.toast("Customer code and name are required", "err"); return; }
          if (isNew && Store.customerById(d.id)) { UI.toast("Customer code already exists", "err"); return; }
          if (!isNew && d.id !== rec.id && Store.customerById(d.id)) { UI.toast("Customer code already exists", "err"); return; }
          Store.saveCustomer(d, isNew, rec ? rec.id : null);
          UI.closeModal(); App.refresh();
          UI.toast("Customer " + d.id + " saved", "ok");
        }
      }]
    });
  }

  /* ---------------- shared bits for the pipeline masters ---------------- */
  /* Customer picker used by the formula / packaging editors. Value is the
     customer id (m_customer pk); the label shows the human name. */
  function customerCombo(value) {
    var db = Store.get();
    var opts = [["", "(no customer)"]].concat(db.customers.map(function (c) {
      return [c.id, (c.name || c.id) + (c.id ? "  (" + c.id + ")" : "")];
    }));
    if (value && !db.customers.some(function (c) { return c.id === value; })) {
      opts.push([value, value + "  (not in master)"]);
    }
    return UI.combo(opts, value || "", "Type to search customer...");
  }
  function customerName(id) {
    var c = id ? Store.customerById(id) : null;
    return c ? (c.name || c.id) : "";
  }

  /* ---------------- Master Supplier ----------------
     Vendors labelled by what they supply, using the same category vocabulary
     as Master Material (CAT_OPTS above). Maintained by Purchasing; every
     other role sees a read-only list. Each material and Purchase Order
     references a supplier by id (m_supplier pk), replacing the old free-text
     "Astoria / Customer / vendor name" field. */
  var SUP_CAT_LABEL = CAT_LABEL;
  var SUP_CAT_OPTS = [["", "(not set)"]].concat(CAT_OPTS);
  var supFilter = { q: "" };
  function supplierMaterials(id) {
    return Store.get().materials.filter(function (m) {
      var links = m.supplierLinks || [];
      if (links.length) return links.some(function (l) { return String(l.supplierId) === String(id); });
      return String(m.supplierId || "") === String(id);
    });
  }
  function suppliers(root) {
    var db = Store.get();
    var canEdit = RBAC.canEditMaster("suppliers");
    root.appendChild(UI.pageHead("Master Supplier",
      "Vendors classified by what they supply: internal / external raw materials, internal / external packaging, premix blends and QA/QC auxiliary items. Referenced by Master Material and Purchase Orders. Maintained by Purchasing.",
      canEdit ? [UI.btn("+ New Supplier", function () { supEditor(null); }, "btn-primary")] : []));

    var search = UI.input({ placeholder: "Search code / name / PIC...", value: supFilter.q });
    search.addEventListener("input", function () { supFilter.q = search.value; draw(); });
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = supFilter.q.toLowerCase();
      var rows = db.suppliers.filter(function (s) {
        if (!q) return true;
        return (s.id + " " + (s.name || "") + " " + (s.pic || "") + " " + (s.category || "")).toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) {
        return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
      });
      var cols = [
        { label: "Code", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.id) + "</b>"; } },
        { label: "Name", key: "name" },
        { label: "Category", render: function (r) { return r.category ? UI.tag(SUP_CAT_LABEL[r.category] || r.category) : "-"; } },
        { label: "PIC", render: function (r) { return Engine.esc(r.pic || "-"); } },
        { label: "Contact", render: function (r) { return Engine.esc(r.contact || "-"); } },
        { label: "Terms", render: function (r) { return Engine.esc(r.terms || "-"); } },
        { label: "Materials", cls: "num", render: function (r) { return String(supplierMaterials(r.id).length); } },
        { label: "", render: function (r) {
          var btns = [UI.btn("Materials", function () { viewSupplierMaterials(r); }, "btn-sm")];
          if (canEdit) {
            btns.push(UI.btn("Edit", function () { supEditor(r); }, "btn-sm"));
            btns.push(UI.btn("Delete", function () {
              UI.confirmDialog("Delete supplier " + r.id + " (" + (r.name || "") + ")? Materials keep their text reference.", function () {
                Store.deleteSupplier(r.id); App.refresh();
              });
            }, "btn-danger btn-sm"));
          }
          return UI.el("div", { class: "btn-row" }, btns);
        } }
      ];
      bodyWrap.appendChild(UI.table(cols, rows, { emptyText: "No supplier yet. Create the first one." }));
    }
    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.suppliers.length + " suppliers" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    root.appendChild(card);
    draw();
    if (!canEdit) root.appendChild(UI.el("div", { class: "hint", style: "margin-top:6px",
      text: "Read-only for " + ((db.meta.user || {}).role || "your role") + " - the supplier master is maintained by Purchasing." }));
  }

  function supEditor(rec) {
    if (!RBAC.canEditMaster("suppliers")) { UI.toast("Supplier master is read-only for your role", "err"); return; }
    var isNew = !rec;
    var d = Object.assign({ id: "", name: "", address: "", pic: "", contact: "", terms: "", category: "" }, rec || {});
    var iCode = UI.input({ class: "input mono", value: d.id, placeholder: "e.g. SUP-001" });
    var iName = UI.input({ value: d.name, placeholder: "Vendor / supplier name" });
    var iCat = UI.select(SUP_CAT_OPTS, d.category || "");
    var iPic = UI.input({ value: d.pic, placeholder: "Person in charge" });
    var iContact = UI.input({ value: d.contact, placeholder: "Phone / email" });
    var iTerms = UI.input({ value: d.terms, placeholder: "e.g. TOP 30 days" });
    var iAddr = UI.el("textarea", { class: "input", rows: "2", style: "width:100%", placeholder: "Supplier address" });
    iAddr.value = d.address || "";
    var body = UI.el("div", {}, [
      UI.el("div", { class: "form-grid" }, [
        UI.field("Supplier Code", iCode),
        UI.field("Name", iName),
        UI.field("Category", iCat, "What this vendor supplies. Premix = raw materials blended into a new production material; Auxiliary = QA/QC consumables."),
        UI.field("PIC", iPic),
        UI.field("Contact", iContact),
        UI.field("Terms", iTerms)
      ]),
      UI.field("Address", iAddr)
    ]);
    UI.modal({
      title: isNew ? "New Supplier" : "Edit Supplier - " + rec.id,
      body: body,
      actions: [{
        label: "Save Supplier", cls: "btn-primary", onClick: function () {
          d.id = iCode.value.trim(); d.name = iName.value.trim(); d.pic = iPic.value.trim();
          d.contact = iContact.value.trim(); d.terms = iTerms.value.trim(); d.address = iAddr.value.trim();
          d.category = iCat.value;
          if (!d.id || !d.name) { UI.toast("Supplier code and name are required", "err"); return; }
          if (isNew && Store.supplierById(d.id)) { UI.toast("Supplier code already exists", "err"); return; }
          if (!isNew && d.id !== rec.id && Store.supplierById(d.id)) { UI.toast("Supplier code already exists", "err"); return; }
          Store.saveSupplier(d, isNew, rec ? rec.id : null);
          UI.closeModal(); App.refresh();
          UI.toast("Supplier " + d.id + " saved", "ok");
        }
      }]
    });
  }

  function viewSupplierMaterials(s) {
    var rows = supplierMaterials(s.id);
    UI.modal({
      title: "Materials from " + s.id + " - " + (s.name || ""),
      body: UI.el("div", {}, [UI.table([
        { label: "Item Code", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.code) + "</b>"; } },
        { label: "Description", key: "name" },
        { label: "Category", render: function (r) { return UI.tag(CAT_LABEL[r.category] || r.category); } },
        { label: "Unit", key: "unit" }
      ], rows, { emptyText: "No material is linked to this supplier yet." })]),
      actions: [{ label: "Close", onClick: function () { UI.closeModal(); } }]
    });
  }

  /* Supplier picker used by the material / purchase-order editors. Value is
     the supplier id (m_supplier pk); the label shows the human name. */
  function supplierCombo(value) {
    var db = Store.get();
    var opts = [["", "(no supplier)"]].concat(db.suppliers.map(function (s) {
      return [s.id, (s.name || s.id) + (s.id ? "  (" + s.id + ")" : "")];
    }));
    if (value && !db.suppliers.some(function (s) { return s.id === value; })) {
      opts.push([value, value + "  (not in master)"]);
    }
    return UI.combo(opts, value || "", "Type to search supplier...");
  }
  function supplierName(id) {
    var s = id ? Store.supplierById(id) : null;
    return s ? (s.name || s.id) : "";
  }

  var STAB_OPTS = [["-", "- (not set)"], ["Running", "Running"], ["Pass", "Pass"], ["Fail", "Fail"]];
  function stabTag(v) {
    var map = { "Pass": ["#1a7f4b", "#e7f6ee"], "Fail": ["#b42318", "#fdeceb"], "Running": ["#9a6b00", "#fff5e0"] };
    var c = map[v] || ["var(--muted)", "transparent"];
    return UI.el("span", { class: "tag", style: "color:" + c[0] + ";background:" + c[1], text: v || "-" });
  }

  /* ---------- Composition helpers ----------
     Masters (FFS/FPS) are the source of truth for composition lines.
     BOM inherits from the linked master's `lines` array. */
  function compLines(section, masterField, masterId) {
    var db = Store.get();
    /* read from master's own lines array (primary source) */
    var master;
    if (masterField === "formulaId") {
      master = db.formulas.filter(function (f) { return f.id === masterId; })[0];
      return master ? (master.lines || []) : [];
    } else {
      master = db.packagings.filter(function (p) { return p.id === masterId; })[0];
      return master ? (master.lines || []) : [];
    }
  }

  /* ---------------- Master Formula (FFS, FR-RD-09) ----------------
     Bulk formula parameters on the 100% ratio basis: kategori, customer,
     urutan, BJ, pH range, viscosity and the four stability tests. The recipe
     percentages themselves live on the production BOM's FORMULA lines. */
  var formulaFilter = { q: "" };

  function formulas(root) {
    var db = Store.get();
    var canEdit = RBAC.canEditMaster("formulas");
    var headBtns = [];
    if (canEdit && window.OCRImport && OCRImport.configured()) {
      headBtns.push(UI.btn("Import from PDF", importFormulaPdf, ""));
    }
    if (canEdit) headBtns.push(UI.btn("+ New Formula", function () { formulaEditor(null); }, "btn-primary"));
    root.appendChild(UI.pageHead("Master Formula (FFS)",
      "Bulk formula parameters (form FR-RD-09): specific gravity, pH range, viscosity and the TK / TKUL / T50 / TM stability tests. Maintained by RND Formula; the recipe percentages are entered on each production BOM.",
      headBtns));
    var search = UI.input({ placeholder: "Search FFS code / kategori / viscosity...", value: formulaFilter.q });
    search.addEventListener("input", function () { formulaFilter.q = search.value; draw(); });
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = formulaFilter.q.toLowerCase();
      var rows = db.formulas.filter(function (f) {
        if (!q) return true;
        return (f.id + " " + (f.kategori || "") + " " + (f.viscosity || "") + " " + customerName(f.customerId)).toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
      var cols = [
        { label: "FFS Code", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.id) + "</b>"; } },
        { label: "Kategori", render: function (r) { return Engine.esc(r.kategori || "-"); } },
        { label: "Customer", render: function (r) { return Engine.esc(customerName(r.customerId) || "-"); } },
        { label: "BJ", cls: "num", render: function (r) { return Engine.fmtNum(r.bj); } },
        { label: "pH", cls: "num", render: function (r) {
          var a = r.phMin === "" || r.phMin == null ? "" : r.phMin;
          var b = r.phMax === "" || r.phMax == null ? "" : r.phMax;
          return (a === "" && b === "") ? "<span class='row-muted'>-</span>" : Engine.esc(a + (b !== "" && b !== a ? " - " + b : ""));
        } },
        { label: "Viscosity", render: function (r) { return Engine.esc(r.viscosity || "-"); } },
        { label: "Lines", cls: "num", render: function (r) {
          var n = compLines("FORMULA", "formulaId", r.id).length;
          return n ? "<b>" + n + "</b>" : "<span class='row-muted'>0</span>";
        } },
        { label: "Stability (TK / TKUL / T50 / TM)", render: function (r) {
          return UI.el("div", { class: "btn-row", style: "gap:3px" }, [stabTag(r.stabTk), stabTag(r.stabTkul), stabTag(r.stabT50), stabTag(r.stabTm)]);
        } },
        { label: "", render: function (r) {
          if (!canEdit) return "";
          return UI.el("div", { class: "btn-row" }, [
            UI.btn("Edit", function () { formulaEditor(r); }, "btn-sm"),
            UI.btn("Delete", function () {
              UI.confirmDialog("Delete formula " + r.id + "? BOMs referencing it keep a dangling link.", function () {
                Store.deleteFormula(r.id); App.refresh();
              });
            }, "btn-danger btn-sm")
          ]);
        } }
      ];
      bodyWrap.appendChild(UI.table(cols, rows, { emptyText: "No formula yet. Create the first one." }));
    }
    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.formulas.length + " formulas" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    root.appendChild(card);
    draw();
    if (!canEdit) root.appendChild(UI.el("div", { class: "hint", style: "margin-top:6px",
      text: "Read-only for " + ((db.meta.user || {}).role || "your role") + " - the formula master is maintained by RND Formula." }));
  }

  /* ------------------------------------------------------------------
     Import from PDF (n8n webhook -> OpenAI -> prefilled editor).
     Visible only when window.ASTORIA_OCR is configured AND the user
     may edit Master Formula.
     ------------------------------------------------------------------ */
  function importFormulaPdf() {
    var inp = UI.el("input", { type: "file", accept: ".pdf,application/pdf", style: "display:none" });
    document.body.appendChild(inp);
    inp.addEventListener("change", function () {
      if (inp.files && inp.files[0]) {
        var f = inp.files[0];
        inp.remove();
        runFormulaOcr(f);
      } else {
        inp.remove();
      }
    });
    inp.click();
  }

  function runFormulaOcr(file) {
    var sp = UI.el("div", { class: "spinner" });
    var sub = UI.el("p", { style: "margin:8px 0 0;font-size:12px;color:var(--muted);text-align:center" },
      ["Parsing " + file.name + " with n8n\u2026 usually 10\u201330 s"]);
    var box = UI.el("div", { style: "padding:8px 0" }, [sp, sub]);
    UI.modal({ title: "Import formula from PDF", body: box, actions: [], wide: false });
    var t0 = Date.now();
    var timer = setInterval(function () {
      sub.textContent = "Parsing " + file.name + " with n8n\u2026 " + Math.round((Date.now() - t0) / 1000) + " s (limit 120 s)";
    }, 1000);
    function done() { clearInterval(timer); UI.closeModal(); }
    OCRImport.parsePdf(file).then(function (payload) {
      var res = OCRImport.mapToFormulaDraft(payload, Store.get());
      done();
      formulaEditor(res.existing, {
        importInfo: {
          fileName: (payload.document && payload.document.fileName) || file.name,
          warnings: res.warnings
        },
        importData: res.draft
      });
    }, function (err) {
      done();
      UI.toast((err && err.message) || "Import failed", "err");
    });
  }

  function importBanner(info, existingRec) {
    var list = [UI.el("div", {}, ["Imported from " + info.fileName + " \u2014 check every value before saving."])];
    if (existingRec) {
      list.push(UI.el("div", {}, ["Formula " + existingRec.id + " already exists \u2014 saving will overwrite its parameters and composition."]));
    }
    if (info.warnings && info.warnings.length) {
      list.push(UI.el("ul", {}, info.warnings.map(function (w) { return UI.el("li", {}, [w]); })));
    }
    return UI.el("div", { class: "import-banner" }, list);
  }

  function formulaEditor(rec, opts) {
    if (!RBAC.canEditMaster("formulas")) { UI.toast("Formula master is read-only for your role", "err"); return; }
    opts = opts || {};
    var isNew = !rec;
    var d = Object.assign({ id: "", kategori: "", customerId: "", urutan: 0, bj: 1, phMin: "", phMax: "",
      viscosity: "", stabTk: "-", stabTkul: "-", stabT50: "-", stabTm: "-", note: "", lines: [] }, rec || {});
    if (!d.lines) d.lines = [];
    if (opts.importData) {
      Object.keys(opts.importData).forEach(function (k) {
        if (opts.importData[k] !== undefined) d[k] = opts.importData[k];
      });
      d.lines = (opts.importData.lines || []).map(function (l) { return Object.assign({}, l); });
    }
    var iCode = UI.input({ class: "input mono", value: d.id, placeholder: "[Kategori]-[Customer]-[Urutan]" });
    var iKat = UI.input({ value: d.kategori, placeholder: "e.g. Cream, Lotion, Serum" });
    var iCust = customerCombo(d.customerId);
    var iUrutan = UI.input({ type: "number", step: "1", min: "0", value: String(d.urutan || 0) });
    var iBj = UI.input({ type: "number", step: "0.0001", min: "0", value: String(d.bj == null ? 1 : d.bj) });
    var iPhMin = UI.input({ type: "number", step: "0.01", value: (d.phMin === "" || d.phMin == null) ? "" : String(d.phMin) });
    var iPhMax = UI.input({ type: "number", step: "0.01", value: (d.phMax === "" || d.phMax == null) ? "" : String(d.phMax) });
    var iVisc = UI.input({ value: d.viscosity, placeholder: "e.g. 20000 - 30000 cP" });
    var iTk = UI.select(STAB_OPTS, d.stabTk || "-");
    var iTkul = UI.select(STAB_OPTS, d.stabTkul || "-");
    var iT50 = UI.select(STAB_OPTS, d.stabT50 || "-");
    var iTm = UI.select(STAB_OPTS, d.stabTm || "-");
    var iNote = UI.el("textarea", { class: "input", rows: "2", style: "width:100%" });
    iNote.value = d.note || "";

    /* ---- Editable Material Composition (source of truth for BOM) ---- */
    var FORMULA_CATS = ["RM-INT", "RM-EXT", "PREMIX", "RM"];
    var db = Store.get();
    var matPool = db.materials.filter(function (m) { return FORMULA_CATS.indexOf(m.category) >= 0; });
    matPool.sort(function (a, b) { return a.code.localeCompare(b.code); });
    var matOpts = [["", "(select material)"]].concat(matPool.map(function (m) {
      return [m.code, m.code + " - " + (m.name || "")];
    }));
    var compWrap = UI.el("div");
    function renderCompLines() {
      UI.clear(compWrap);
      var tbl = UI.el("table", { class: "editor", style: "width:100%;font-size:12.5px" });
      tbl.appendChild(UI.el("thead", {}, [UI.el("tr", {}, [
        UI.el("th", { text: "No", style: "width:32px" }),
        UI.el("th", { text: "Material" }),
        UI.el("th", { text: "Ratio %", style: "width:90px" }),
        UI.el("th", { text: "Note", style: "width:120px" }),
        UI.el("th", { text: "", style: "width:36px" })
      ])]));
      var tb = UI.el("tbody");
      var totalPct = 0;
      d.lines.forEach(function (ln, idx) {
        var pct = Number(ln.pct) || 0;
        totalPct += pct;
        var tr = UI.el("tr");
        tr.appendChild(UI.el("td", { text: String(idx + 1) }));
        /* material select */
        var sel = UI.select(matOpts, ln.materialCode || "");
        sel.style.width = "100%";
        sel.addEventListener("change", function () { ln.materialCode = sel.value; });
        tr.appendChild(UI.el("td", {}, [sel]));
        /* pct input */
        var iPct = UI.input({ type: "number", step: "0.001", min: "0", max: "100", value: String(pct || ""), style: "width:80px;text-align:right" });
        iPct.addEventListener("input", function () { ln.pct = Number(iPct.value) || 0; updateTotal(); });
        tr.appendChild(UI.el("td", {}, [iPct]));
        /* note */
        var iNt = UI.input({ value: ln.note || "", placeholder: "", style: "width:100%" });
        iNt.addEventListener("input", function () { ln.note = iNt.value; });
        tr.appendChild(UI.el("td", {}, [iNt]));
        /* delete */
        tr.appendChild(UI.el("td", {}, [UI.btn("\u00d7", function () {
          d.lines.splice(idx, 1); renderCompLines();
        }, "btn-danger btn-sm", { style: "padding:2px 7px;font-size:14px" })]));
        tb.appendChild(tr);
      });
      if (!d.lines.length) tb.appendChild(UI.el("tr", {}, [UI.el("td", { colspan: "5", class: "empty", text: "No composition lines yet." })]));
      tbl.appendChild(tb);
      /* footer total */
      var totalEl = UI.el("td", { colspan: "5", style: "font-weight:700;font-size:12px" });
      tbl.appendChild(UI.el("tfoot", {}, [UI.el("tr", {}, [totalEl])]));
      function updateTotal() {
        var sum = d.lines.reduce(function (s, l) { return s + (Number(l.pct) || 0); }, 0);
        var ok = Math.abs(sum - 100) < 0.01;
        totalEl.textContent = "\u03a3 Ratio = " + sum.toFixed(3) + "%" + (ok ? "  \u2713 100%" : (sum === 0 ? "" : "  \u2014 must equal 100%"));
        totalEl.style.color = ok ? "#1a7f4b" : (sum === 0 ? "var(--muted)" : "#b42318");
      }
      updateTotal();
      compWrap.appendChild(tbl);
      var addBtn = UI.btn("+ Add Material", function () {
        d.lines.push({ materialCode: "", pct: 0, note: "" });
        renderCompLines();
      }, "btn-sm");
      compWrap.appendChild(UI.el("div", { style: "margin-top:6px" }, [addBtn]));
    }
    renderCompLines();

    var body = UI.el("div", {}, [
      UI.el("div", { class: "form-grid" }, [
        UI.field("FFS Code", iCode, "Formula code, e.g. MR03-BN-01"),
        UI.field("Kategori", iKat),
        UI.field("Customer", iCust),
        UI.field("Urutan", iUrutan),
        UI.field("BJ (specific gravity)", iBj, "Must be > 0; used by netting: qty x netto x BJ x (1+loss)."),
        UI.field("Viscosity", iVisc)
      ]),
      fieldset("pH range", [UI.el("div", { class: "form-grid" }, [
        UI.field("pH min", iPhMin, "Leave blank if not specified."),
        UI.field("pH max", iPhMax)
      ])]),
      fieldset("Stability tests", [UI.el("div", { class: "form-grid" }, [
        UI.field("TK (room temp)", iTk),
        UI.field("TKUL (refrigerator)", iTkul),
        UI.field("T50 (oven 50\u00b0C)", iT50),
        UI.field("TM (sunlight)", iTm)
      ])]),
      UI.field("Note", iNote),
      fieldset("Material Composition", [compWrap])
    ]);
    if (opts.importInfo) body.insertBefore(importBanner(opts.importInfo, rec), body.firstChild);
    UI.modal({
      title: (isNew ? "New Formula (FFS)" : "Edit Formula - " + rec.id) + (opts.importInfo ? " (imported)" : ""),
      body: body, wide: true,
      actions: [{
        label: "Save Formula", cls: "btn-primary", onClick: function () {
          d.id = iCode.value.trim(); d.kategori = iKat.value.trim(); d.customerId = iCust.value || "";
          d.urutan = Number(iUrutan.value) || 0; d.bj = Number(iBj.value) || 0;
          d.phMin = iPhMin.value === "" ? null : Number(iPhMin.value);
          d.phMax = iPhMax.value === "" ? null : Number(iPhMax.value);
          d.viscosity = iVisc.value.trim();
          d.stabTk = iTk.value; d.stabTkul = iTkul.value; d.stabT50 = iT50.value; d.stabTm = iTm.value;
          d.note = iNote.value.trim();
          if (!d.id) { UI.toast("FFS code is required", "err"); return; }
          if (!(d.bj > 0)) { UI.toast("BJ must be greater than 0", "err"); return; }
          if (d.phMin != null && d.phMax != null && d.phMax < d.phMin) { UI.toast("pH max must be >= pH min", "err"); return; }
          if (isNew && Store.formulaById(d.id)) { UI.toast("FFS code already exists", "err"); return; }
          if (!isNew && d.id !== rec.id && Store.formulaById(d.id)) { UI.toast("FFS code already exists", "err"); return; }
          /* clean lines: remove empty material rows */
          d.lines = d.lines.filter(function (l) { return l.materialCode; });
          Store.saveFormula(d, isNew, rec ? rec.id : null);
          if (opts.importInfo) {
            Store.audit("IMPORT", "Master Formula", d.id + " confirmed from " + opts.importInfo.fileName);
          }
          UI.closeModal(); App.refresh();
          UI.toast("Formula " + d.id + " saved", "ok");
        }
      }]
    });
  }

  /* ---------------- Master Packaging (FPS, FR-PD-02 / SBK ST-PD-01) ----------------
     Packaging parameters: fill volume range, shrink tunnel temperature and the
     inkjet syntax. Component supply ownership (Customer vs Astoria) is set per
     line on the production BOM's KEMAS section. */
  var packFilter = { q: "" };

  function packagings(root) {
    var db = Store.get();
    var canEdit = RBAC.canEditMaster("packagings");
    root.appendChild(UI.pageHead("Master Packaging (FPS)",
      "Packaging parameters (form FR-PD-02 / SBK ST-PD-01): nominal fill volume with its tolerance band and inkjet syntax. Maintained by RND Kemas; component supply ownership is set on each production BOM.",
      canEdit ? [UI.btn("+ New Packaging", function () { packagingEditor(null); }, "btn-primary")] : []));
    var search = UI.input({ placeholder: "Search FPS code / inkjet...", value: packFilter.q });
    search.addEventListener("input", function () { packFilter.q = search.value; draw(); });
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = packFilter.q.toLowerCase();
      var rows = db.packagings.filter(function (p) {
        if (!q) return true;
        return (p.id + " " + (p.inkjetSyntax || "") + " " + customerName(p.customerId)).toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
      bodyWrap.appendChild(UI.table([
        { label: "FPS Code", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.id) + "</b>"; } },
        { label: "Customer", render: function (r) { return Engine.esc(customerName(r.customerId) || "-"); } },
        { label: "Varian", cls: "num", render: function (r) { return String(r.urutanVarian || 0); } },
        { label: "Volume (mL)", cls: "num", render: function (r) {
          return Engine.fmtNum(r.volumeMl || 0) + (r.fillTolPct ? " \u00b1" + Engine.fmtNum(r.fillTolPct) + "%" : "");
        } },
        { label: "Inkjet syntax", cls: "mono", render: function (r) { return Engine.esc(r.inkjetSyntax || "-"); } },
        { label: "Lines", cls: "num", render: function (r) {
          var n = compLines("KEMAS", "packagingId", r.id).length;
          return n ? "<b>" + n + "</b>" : "<span class='row-muted'>0</span>";
        } },
        { label: "", render: function (r) {
          if (!canEdit) return "";
          return UI.el("div", { class: "btn-row" }, [
            UI.btn("Edit", function () { packagingEditor(r); }, "btn-sm"),
            UI.btn("Delete", function () {
              UI.confirmDialog("Delete packaging " + r.id + "? BOMs referencing it keep a dangling link.", function () {
                Store.deletePackaging(r.id); App.refresh();
              });
            }, "btn-danger btn-sm")
          ]);
        } }
      ], rows, { emptyText: "No packaging yet. Create the first one." }));
    }
    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.packagings.length + " packagings" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    root.appendChild(card);
    draw();
    if (!canEdit) root.appendChild(UI.el("div", { class: "hint", style: "margin-top:6px",
      text: "Read-only for " + ((db.meta.user || {}).role || "your role") + " - the packaging master is maintained by RND Kemas." }));
  }

  function packagingEditor(rec) {
    if (!RBAC.canEditMaster("packagings")) { UI.toast("Packaging master is read-only for your role", "err"); return; }
    var isNew = !rec;
    var d = Object.assign({ id: "", customerId: "", urutanVarian: 0, volumeMl: 0, fillTolPct: 0,
      inkjetSyntax: "", note: "", lines: [] }, rec || {});
    if (!d.lines) d.lines = [];
    var iCode = UI.input({ class: "input mono", value: d.id, placeholder: "[Kategori]-[Customer]-[Varian]" });
    var iCust = customerCombo(d.customerId);
    var iVarian = UI.input({ type: "number", step: "1", min: "0", value: String(d.urutanVarian || 0) });
    var iVol = UI.input({ type: "number", step: "0.01", min: "0", value: String(d.volumeMl || 0) });
    var iTol = UI.input({ type: "number", step: "0.1", min: "0", max: "100", value: String(d.fillTolPct || 0) });
    var iInk = UI.input({ class: "input mono", value: d.inkjetSyntax, placeholder: "e.g. EXP {MM/YY} BATCH {NO}" });
    var iNote = UI.el("textarea", { class: "input", rows: "2", style: "width:100%" });
    iNote.value = d.note || "";

    /* ---- Editable Packaging Composition (source of truth for BOM) ---- */
    var KEMAS_CATS = ["PKG-INT", "PKG-EXT", "PM"];
    var db = Store.get();
    var pkgPool = db.materials.filter(function (m) { return KEMAS_CATS.indexOf(m.category) >= 0; });
    pkgPool.sort(function (a, b) { return a.code.localeCompare(b.code); });
    var pkgOpts = [["", "(select item)"]].concat(pkgPool.map(function (m) {
      return [m.code, m.code + " - " + (m.name || "")];
    }));
    var SUPP_OPTS = [["Astoria", "Astoria"], ["Customer", "Customer"]];
    var compWrap = UI.el("div");
    function renderPackLines() {
      UI.clear(compWrap);
      var tbl = UI.el("table", { class: "editor", style: "width:100%;font-size:12.5px" });
      tbl.appendChild(UI.el("thead", {}, [UI.el("tr", {}, [
        UI.el("th", { text: "No", style: "width:32px" }),
        UI.el("th", { text: "Item" }),
        UI.el("th", { text: "Qty / pcs FG", style: "width:80px" }),
        UI.el("th", { text: "Supported by", style: "width:110px" }),
        UI.el("th", { text: "Note", style: "width:100px" }),
        UI.el("th", { text: "", style: "width:36px" })
      ])]));
      var tb = UI.el("tbody");
      d.lines.forEach(function (ln, idx) {
        var tr = UI.el("tr");
        tr.appendChild(UI.el("td", { text: String(idx + 1) }));
        /* item select */
        var sel = UI.select(pkgOpts, ln.materialCode || "");
        sel.style.width = "100%";
        sel.addEventListener("change", function () { ln.materialCode = sel.value; });
        tr.appendChild(UI.el("td", {}, [sel]));
        /* qty input */
        var iQty = UI.input({ type: "number", step: "1", min: "0", value: String(Number(ln.qty) || 1), style: "width:70px;text-align:right" });
        iQty.addEventListener("input", function () { ln.qty = Number(iQty.value) || 0; });
        tr.appendChild(UI.el("td", {}, [iQty]));
        /* supported by */
        var iSupp = UI.select(SUPP_OPTS, ln.supportedBy || "Astoria");
        iSupp.style.width = "100%";
        iSupp.addEventListener("change", function () { ln.supportedBy = iSupp.value; });
        tr.appendChild(UI.el("td", {}, [iSupp]));
        /* note */
        var iNt = UI.input({ value: ln.note || "", placeholder: "", style: "width:100%" });
        iNt.addEventListener("input", function () { ln.note = iNt.value; });
        tr.appendChild(UI.el("td", {}, [iNt]));
        /* delete */
        tr.appendChild(UI.el("td", {}, [UI.btn("\u00d7", function () {
          d.lines.splice(idx, 1); renderPackLines();
        }, "btn-danger btn-sm", { style: "padding:2px 7px;font-size:14px" })]));
        tb.appendChild(tr);
      });
      if (!d.lines.length) tb.appendChild(UI.el("tr", {}, [UI.el("td", { colspan: "6", class: "empty", text: "No packaging components yet." })]));
      tbl.appendChild(tb);
      compWrap.appendChild(tbl);
      var addBtn = UI.btn("+ Add Item", function () {
        d.lines.push({ materialCode: "", qty: 1, supportedBy: "Astoria", note: "" });
        renderPackLines();
      }, "btn-sm");
      compWrap.appendChild(UI.el("div", { style: "margin-top:6px" }, [addBtn]));
    }
    renderPackLines();

    var body = UI.el("div", {}, [
      UI.el("div", { class: "form-grid" }, [
        UI.field("FPS Code", iCode),
        UI.field("Customer", iCust),
        UI.field("Variant Order", iVarian),
        UI.field("Volume (mL)", iVol, "Nominal fill volume."),
        UI.field("Tolerance (\u00b1%)", iTol, "Sets the QA fill-check band: volume \u00b1 this percentage."),
        UI.field("Inkjet syntax", iInk)
      ]),
      UI.field("Note", iNote),
      fieldset("Packaging Composition", [compWrap])
    ]);
    UI.modal({
      title: isNew ? "New Packaging (FPS)" : "Edit Packaging - " + rec.id,
      body: body, wide: true,
      actions: [{
        label: "Save Packaging", cls: "btn-primary", onClick: function () {
          d.id = iCode.value.trim(); d.customerId = iCust.value || "";
          d.urutanVarian = Number(iVarian.value) || 0;
          d.volumeMl = Number(iVol.value) || 0; d.fillTolPct = Number(iTol.value) || 0;
          d.inkjetSyntax = iInk.value.trim();
          d.note = iNote.value.trim();
          /* drop the pre-012 parameters an old working copy may carry */
          delete d.fillMin; delete d.fillMax; delete d.revisi; delete d.shrinkTunnelC;
          if (!d.id) { UI.toast("FPS code is required", "err"); return; }
          if (d.volumeMl < 0) { UI.toast("Volume must be >= 0", "err"); return; }
          if (d.fillTolPct < 0 || d.fillTolPct > 100) { UI.toast("Tolerance must be between 0 and 100%", "err"); return; }
          if (isNew && Store.packagingById(d.id)) { UI.toast("FPS code already exists", "err"); return; }
          if (!isNew && d.id !== rec.id && Store.packagingById(d.id)) { UI.toast("FPS code already exists", "err"); return; }
          /* clean lines: remove empty item rows */
          d.lines = d.lines.filter(function (l) { return l.materialCode; });
          Store.savePackaging(d, isNew, rec ? rec.id : null);
          UI.closeModal(); App.refresh();
          UI.toast("Packaging " + d.id + " saved", "ok");
        }
      }]
    });
  }

  function pickFile(cb) {
    var inp = UI.el("input", { type: "file", accept: ".csv,text/csv,.json,application/json", style: "display:none" });
    document.body.appendChild(inp);
    inp.addEventListener("change", function () {
      if (inp.files && inp.files[0]) UI.readFile(inp.files[0], function (txt) { inp.remove(); cb(txt); });
    });
    inp.click();
  }

  return { dashboard: dashboard, fg: fg, materials: materials, customers: customers, suppliers: suppliers,
    formulas: formulas, packagings: packagings, CAT_LABEL: CAT_LABEL, ROLES: ROLES, pickFile: pickFile,
    supplierCombo: supplierCombo, supplierName: supplierName };
})();
