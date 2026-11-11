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

    var search = UI.input({ placeholder: "Search code, description, Formula, FPS, NA...", value: fgFilter.q });
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
    /* recode keeps the pipe id, so "still legacy" means not yet issued a 13-char code */
    var legacy = db.fgs.filter(function (f) { return f.id.indexOf("|") >= 0 && !(f.brandId && f.seq); }).length;
    if (legacy) body.appendChild(UI.el("div", { class: "preview-box", style: "margin-bottom:10px" }, [
      UI.el("span", { text: legacy + " SKU(s) still on the legacy FFS-FPS code. " }),
      UI.btn("Open recode tool", function () { App.go("recode"); }, "btn-sm")
    ]));
    var q = fgFilter.q.toLowerCase();
    var rows = db.fgs.filter(function (f) {
      /* Discontinue shows every flagged row; Non Aktif shows only rows that
         are inactive for other reasons (discontinued ones have their chip). */
      if (fgFilter.status === "DISCONTINUE") { if (!f.discontinue) return false; }
      else if (fgFilter.status === "Non Aktif") { if (f.status !== "Non Aktif" || f.discontinue) return false; }
      else if (fgFilter.status !== "ALL" && f.status !== fgFilter.status) return false;
      if (!q) return true;
      return (f.kodeFG + " " + (f.legacyCode || "") + " " + f.deskripsi + " " + (f.brandId || "") + " " + (f.formulaId || f.ffs) + " " + (f.packagingId || f.fps) + " " + f.kodeNA).toLowerCase().indexOf(q) >= 0;
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
      { label: "Brand", cls: "mono", render: function (r) { return r.brandId || "<span class='row-muted'>-</span>"; } },
      { label: "Formula Code", cls: "mono", render: function (r) { return r.formulaId || r.ffs; } },
      { label: "FPS Packaging", cls: "mono", render: function (r) { return r.packagingId || r.fps; } },
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
          UI.btn("Rev Formula", function () { fgRevFormula(r); }, "btn-sm"),
          UI.btn("Rev Packaging", function () { fgRevPackaging(r); }, "btn-sm"),
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
    if (!canEditFG()) { UI.toast("Master F/G is read-only for " + (Store.get().meta.user || {}).role, "err"); return; }
    var isNew = !rec;
    /* Legacy rows keep their ffs|fps id until recoded: desc/NA/expiry stay
       editable (Regulatory keeps working during the transition), but the
       code itself can only change via the SKU Recode tool. */
    var isLegacy = !isNew && !(rec.brandId && rec.seq);
    var db = Store.get();
    var d = Object.assign({ brandId: "", formulaId: "", packagingId: "", deskripsi: "", kodeNA: "", tglExpire: "", discontinue: false }, rec || {});
    var rights = FG_FIELD_RIGHTS[(db.meta.user || {}).role] || {};
    var pvKode = UI.el("span", { class: "pv-kode", text: "-" });
    var pvStatus = UI.el("span");
    var pvSeg = UI.el("div", { class: "hint", style: "margin-top:4px" });
    function derived() {
      var f = Store.formulaById(d.formulaId), p = Store.packagingById(d.packagingId);
      var app = f ? Engine.appOf(f.kategori) : "", form = f ? (f.dosageForm || "") : "";
      var netto = p ? Number(p.volumeMl) || 0 : 0, rev = p ? Number(p.revisi) || 1 : 0;
      var seq = 0, size = "";
      if (d.brandId && app && form && d.formulaId) {
        seq = Engine.seqFor(db.fgs, d.brandId, app, form, d.formulaId);
        size = Engine.sizeFor(db.fgs, d.brandId, app, form, seq, netto);
      }
      return { app: app, form: form, seq: seq, size: size, netto: netto, rev: rev };
    }
    function codeOf(s) {
      return (d.brandId && s.app && s.form && s.seq && s.size && s.rev)
        ? Engine.skuCode({ brand: d.brandId, app: s.app, form: s.form, seq: s.seq, size: s.size, rev: s.rev }) : "";
    }
    function preview() {
      if (!isNew) {
        /* Issued codes are frozen: show the stored code, never re-derive. */
        pvKode.textContent = rec.kodeFG;
        pvSeg.textContent = isLegacy
          ? "Legacy FFS-FPS code - use SKU Recode to issue the 13-char code."
          : "Issued code - segments are frozen; masters links cannot change here.";
        UI.clear(pvStatus);
        pvStatus.appendChild(UI.pill(Engine.evaluateStatus(d.formulaId || d.ffs, d.packagingId || d.fps, d.kodeNA, d.tglExpire, d.discontinue)));
        return;
      }
      var s = derived(), code = codeOf(s);
      pvKode.textContent = code || "(empty)";
      pvSeg.textContent = code
        ? "Seq " + Engine.pad(s.seq, 3) + " · Size " + s.size + " (" + s.netto + " mL) · Rev " + Engine.pad(s.rev, 2)
        : "Pick brand, formula and FPS to build the 13-char code.";
      UI.clear(pvStatus);
      pvStatus.appendChild(UI.pill(Engine.evaluateStatus(d.formulaId || d.ffs, d.packagingId || d.fps, d.kodeNA, d.tglExpire, d.discontinue)));
    }
    var brandOpts = [["", "(select brand)"]].concat(db.brands.map(function (b) {
      var c = Store.customerById(b.customerId);
      return [b.id, b.id + " - " + b.name + (c ? " (" + c.name + ")" : "")];
    }));
    var fOpts = [["", "(select formula)"]].concat(db.formulas.map(function (f) { return [f.id, f.id + " - " + (f.productName || f.kategori || "")]; }));
    var pOpts = [["", "(select FPS)"]].concat(db.packagings.map(function (p) { return [p.id, p.id + " - " + (p.productName || "") + " · " + (p.volumeMl || 0) + " mL"]; }));
    var iBrand = UI.combo(brandOpts, d.brandId, "Brand...");
    var iFfs = UI.combo(fOpts, d.formulaId, "Formula master...");
    var iFps = UI.combo(pOpts, d.packagingId, "FPS packaging...");
    var iDesc = UI.input({ value: d.deskripsi, placeholder: "Brand + product + size" });
    var iNa = UI.input({ class: "input mono", value: d.kodeNA, placeholder: "NA1826..." });
    var iExp = UI.input({ type: "date", value: d.tglExpire || "" });
    /* UI.combo returns a wrapper div - disable its inner input, not the div. */
    function lock(inp, editable, who) {
      if (editable) return;
      var target = inp.classList.contains("combo") ? inp.querySelector("input") : inp;
      target.disabled = true; target.title = "Locked - " + who;
    }
    lock(iBrand, !isLegacy && isNew && rights.brand, "Marketing owns brand codes; issued codes are frozen");
    lock(iFfs, !isLegacy && isNew && rights.ffs, "RND Formula owns the formula link; issued codes are frozen");
    lock(iFps, !isLegacy && isNew && rights.fps, "RND Kemas owns the FPS link; issued codes are frozen");
    lock(iDesc, rights.desc, "master-data roles");
    lock(iNa, rights.na, "Regulatory owns Kode NA");
    lock(iExp, rights.exp, "Regulatory owns the NA expiry date");
    [iBrand, iFfs, iFps].forEach(function (n) { n.addEventListener("change", function () { d.brandId = iBrand.value; d.formulaId = iFfs.value; d.packagingId = iFps.value; preview(); }); });
    [iDesc, iNa, iExp].forEach(function (n) { n.addEventListener("input", function () { d.deskripsi = iDesc.value.trim(); d.kodeNA = iNa.value.trim(); d.tglExpire = iExp.value; preview(); }); });
    var disc = UI.checkRow("Discontinue / superseded revision (forces status Non Aktif)", d.discontinue, function (v) { d.discontinue = v; preview(); });
    if (!rights.disc) { var cb = disc.querySelector("input"); if (cb) { cb.disabled = true; cb.title = "Locked for your role"; } }
    var body = UI.el("div", {}, [
      UI.el("div", { class: "preview-box" }, [
        UI.el("div", {}, [UI.el("div", { class: "pv-label", text: "F/G SKU Code (auto, 13 chars)" }), pvKode, pvSeg]),
        UI.el("div", {}, [UI.el("div", { class: "pv-label", text: "F/G Status (auto)" }), pvStatus])
      ]),
      fieldset("Brand & masters", [UI.el("div", { class: "form-grid" }, [
        UI.field("Brand", iBrand), UI.field("Formula (FFS)", iFfs), UI.field("Packaging (FPS)", iFps)
      ])]),
      fieldset("Regulatory", [
        UI.field("Product Description", iDesc),
        UI.el("div", { class: "form-grid" }, [
          UI.field("NA Code (BPOM)", iNa, "Leave empty while registration is in progress -> Pending BPOM."),
          UI.field("NA Expiry Date", iExp, "Passed date -> Non Aktif on next refresh.")
        ])
      ]),
      disc
    ]);
    preview();
    UI.modal({
      title: isNew ? "New Finish Good SKU" : "Edit Finish Good - " + rec.kodeFG,
      body: body, wide: true,
      actions: [{ label: "Save SKU", cls: "btn-primary", onClick: function () {
        if (isLegacy) {
          /* Legacy edit: desc/NA/expiry/discontinue only; code + id untouched. */
          Store.saveFG(d, false, rec.id);
          UI.closeModal();
          UI.toast("Saved " + d.kodeFG + " - status " + d.status, "ok");
          App.refresh();
          return;
        }
        if (!isNew) {
          /* Issued SKU: segments stay frozen exactly as stored on the row. */
          d.ffs = d.formulaId; d.fps = d.packagingId;
          Store.saveFG(d, false, rec.id);
          UI.closeModal();
          UI.toast("Saved " + d.kodeFG + " - status " + d.status, "ok");
          App.refresh();
          return;
        }
        var s = derived();
        if (!d.brandId) { UI.toast("Brand is required", "err"); return; }
        if (!d.formulaId) { UI.toast("Formula is required", "err"); return; }
        var f = Store.formulaById(d.formulaId);
        if (!Engine.appOf(f.kategori)) { UI.toast("Formula has no category - set it on the formula master", "err"); return; }
        if (!f.dosageForm) { UI.toast("Formula has no dosage form - set it on the formula master", "err"); return; }
        if (!d.packagingId) { UI.toast("FPS packaging is required", "err"); return; }
        if (!s.seq) { UI.toast("Sequence overflow (999) for this brand/app/form", "err"); return; }
        if (!s.size) { UI.toast("Size letters exhausted for this item", "err"); return; }
        var code = codeOf(s);
        if (!Engine.validSkuCode(code)) { UI.toast("Invalid SKU code: " + code, "err"); return; }
        if (Store.fgById(code)) { UI.toast("SKU already exists: " + code, "err"); return; }
        d.app = s.app; d.form = s.form; d.seq = s.seq; d.sizeLetter = s.size; d.nettoMl = s.netto; d.rev = s.rev;
        d.ffs = d.formulaId; d.fps = d.packagingId;
        Store.saveFG(d, true, null);
        UI.closeModal();
        UI.toast("Saved " + d.kodeFG + " - status " + d.status, "ok");
        App.refresh();
      } }]
    });
  }
  function fieldset(legend, kids) {
    return UI.el("fieldset", { class: "role-group" }, [UI.el("legend", { text: legend })].concat(kids));
  }

  /* ---------------- Revision workflow ----------------
     Formula revision keeps the issued SKU code and swaps the formula link;
     packaging revision issues a new SKU at the higher FPS revision. Both
     clear Kode NA / Tgl Expire NA (BPOM recertification) -> Pending BPOM,
     and packaging revision auto-discontinues the superseded row. */
  function fgRevFormula(rec) {
    var db = Store.get();
    var iF = UI.combo([["", "(select formula)"]].concat(db.formulas.map(function (f) { return [f.id, f.id + " - " + (f.productName || "")]; })), rec.formulaId, "New formula...");
    UI.modal({
      title: "Formula revision - " + rec.kodeFG,
      body: UI.el("div", {}, [
        UI.el("p", { class: "hint", text: "Keeps the same SKU code; swaps the formula link; clears NA (BPOM recertification). The new formula must have the same category + dosage form." }),
        UI.field("New Formula", iF)
      ]),
      actions: [{ label: "Apply revision", cls: "btn-primary", onClick: function () {
        if (!iF.value || iF.value === rec.formulaId) { UI.toast("Pick a different formula", "err"); return; }
        var r = Store.reviseFormulaFG(rec.id, iF.value);
        if (!r) { UI.toast("Formula not found", "err"); return; }
        if (r.error) { UI.toast(r.error === "form" ? "New formula has no dosage form" : "New formula category/dosage form differs from the issued code", "err"); return; }
        UI.closeModal(); App.refresh();
        UI.toast("Formula revised - " + r.kodeFG + " Pending BPOM until recertified", "ok");
      } }]
    });
  }
  function fgRevPackaging(rec) {
    var db = Store.get();
    var iF = UI.combo([["", "(select FPS)"]].concat(db.packagings.map(function (p) { return [p.id, p.id + " · rev " + (p.revisi || 1) + " · " + (p.volumeMl || 0) + " mL"]; })), "", "New FPS revision...");
    UI.modal({
      title: "Packaging revision - " + rec.kodeFG,
      body: UI.el("div", {}, [
        UI.el("p", { class: "hint", text: "Creates a new SKU at the higher FPS revision (same netto); the old SKU is discontinued and NA cleared (BPOM recertification)." }),
        UI.field("New FPS (higher revision, same netto)", iF)
      ]),
      actions: [{ label: "Create revision", cls: "btn-primary", onClick: function () {
        if (!iF.value) { UI.toast("Pick the new FPS", "err"); return; }
        var r = Store.revisePackagingFG(rec.id, iF.value);
        if (!r) { UI.toast("FPS not found", "err"); return; }
        if (r.error) { UI.toast(r.error === "netto" ? "Netto differs - use New SKU for a size variant" : "FPS revision must be higher than " + rec.rev, "err"); return; }
        UI.closeModal(); App.refresh();
        UI.toast("Revision " + r.kodeFG + " created - " + rec.kodeFG + " discontinued", "ok");
      } }]
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
  var formulaFilter = { q: "", kat: "", stab: "", page: 1, rpp: 10, open: null };
  var FFS_CATS = ["Lip Makeup", "Face Makeup", "Eye Makeup", "Skincare", "Cleansers & Makeup Removers", "Sun Care", "Body Care", "Hair Care"];
  var FFS_STAB = { "Pass": { cls: "pass", word: "PASS" }, "Running": { cls: "run", word: "RUNNING" }, "Fail": { cls: "fail", word: "FAIL" }, "-": { cls: "none", word: "NOT SET" } };
  var FFS_TESTS = [["stabTk", "TK", "Thermal cycle"], ["stabTkul", "TKUL", "UV cycle"], ["stabT50", "T50", "50\u00b0C oven"], ["stabTm", "TM", "Real-time"]];
  var FFS_HUES = ["#4a7fc1", "#5fb3a1", "#9b7bc0", "#e2603f", "#dfb54c", "#7fa05a", "#c0788f", "#8a8a8c"];

  function ffsEsc(s) { return Engine.esc(s); }
  function ffsPct(n) { return (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, "") + "%"; }
  function ffsMatName(code) {
    var db = Store.get();
    var m = (db.materials || []).filter(function (x) { return x.code === code; })[0];
    return m ? m.name : code;
  }

  function formulas(root) {
    var db = Store.get();
    var canEdit = RBAC.canEditMaster("formulas");
    root.appendChild(UI.pageHead("Master Formula",
      "Composition + product specification + test result + machine setup, keyed by Formula Code. Open a formula and choose Edit to work on all four parts in one window; each part imports from its own webhook (Settings & Data). Records stay Draft until the approval chain lands. Maintained by RND Formula.",
      []));

    function renderComp(host) {
      if (canEdit) host.appendChild(UI.el("div", { class: "btn-row", style: "margin:0 0 12px" },
        [UI.btn("+ New Formula", function () { formulaEditor(null); }, "btn-primary")]));
      var wrap = UI.el("div", { class: "ffs-page" });
      host.appendChild(wrap);

    function ffsFiltered() {
      var q = formulaFilter.q.toLowerCase();
      return db.formulas.filter(function (f) {
        if (formulaFilter.kat && (f.kategori || "") !== formulaFilter.kat) return false;
        if (q && (f.id + " " + (f.kategori || "") + " " + customerName(f.customerId) + " " + (f.productName || "") + " " + (f.variant || "")).toLowerCase().indexOf(q) < 0) return false;
        if (formulaFilter.stab) {
          var v = [f.stabTk, f.stabTkul, f.stabT50, f.stabTm];
          if (formulaFilter.stab === "fail" && v.indexOf("Fail") < 0) return false;
          if (formulaFilter.stab === "run" && v.indexOf("Running") < 0) return false;
          if (formulaFilter.stab === "pass" && v.some(function (x) { return x !== "Pass"; })) return false;
          if (formulaFilter.stab === "open" && v.indexOf("-") < 0) return false;
        }
        return true;
      }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
    }

    function ffsLamps(f) {
      return FFS_TESTS.map(function (t) {
        var s = FFS_STAB[f[t[0]]] || FFS_STAB["-"];
        return '<td class="ffs-lamps"><span class="ffs-lamp ' + s.cls + '" title="' + t[1] + ': ' + s.word + '"></span></td>';
      }).join("");
    }

    function ffsPanel(f) {
      var lines = (f.lines || []).map(function (ln) { return [ffsMatName(ln.materialCode), Number(ln.pct) || 0]; });
      var total = lines.reduce(function (a, l) { return a + l[1]; }, 0);
      var hueOf = function (l, i) { return l[0] === "Others" ? "#8a8a8c" : FFS_HUES[i % FFS_HUES.length]; };
      var bar = lines.map(function (l, i) {
        var hue = hueOf(l, i);
        var txt = l[1] >= 3 ? ffsPct(l[1]) : "";
        return '<i class="' + (l[0] === "Others" ? "txt-dark" : "") + '" style="width:' + l[1] + '%;background:' + hue + '" title="' + ffsEsc(l[0]) + ' ' + ffsPct(l[1]) + '">' + txt + '</i>';
      }).join("");
      var legend = lines.map(function (l, i) {
        return '<li><i style="background:' + hueOf(l, i) + '"></i>' + ffsEsc(l[0]) + '<b>' + ffsPct(l[1]) + '</b></li>';
      }).join("");
      var nodes = FFS_TESTS.map(function (t, i) {
        var s = FFS_STAB[f[t[0]]] || FFS_STAB["-"];
        return '<div class="ffs-tnode ' + s.cls + '"><span class="dot">' + (i + 1) + '</span><b>' + t[1] + '</b><small>' + t[2] + '</small><em>' + s.word + '</em></div>';
      }).join("");
      var actions = "";
      if (canEdit) {
        actions = '<div class="ffs-actions"><button class="btn btn-sm" data-act="edit" data-id="' + ffsEsc(f.id) + '">Edit</button>' +
          '<button class="btn btn-danger btn-sm" data-act="del" data-id="' + ffsEsc(f.id) + '">Delete</button></div>';
      }
      return '<div class="ffs-panel-wrap"><div class="ffs-panel-clip"><div class="ffs-panel">' +
        '<div><h3>Composition (w/w%)</h3>' + (lines.length ? '<div class="ffs-bar">' + bar + '</div><ul class="ffs-legend">' + legend + '</ul><div class="ffs-total"><span>Total</span><b>' + ffsPct(total) + '</b></div>' : '<p style="color:var(--muted);font-size:12px">No composition lines yet.</p>') + '</div>' +
        '<div><h3>Stability Tests</h3><div class="ffs-timeline">' + nodes + '</div></div>' +
        (f.note ? '<p class="ffs-pnotes"><b>Notes:</b> ' + ffsEsc(f.note) + '</p>' : "") +
        actions + '</div></div></div>';
    }

    function ffsRow(f) {
      var open = formulaFilter.open === f.id;
      var ph = (f.phMin === "" || f.phMin == null) && (f.phMax === "" || f.phMax == null) ? "-" :
        ffsEsc(String(f.phMin) + (f.phMax !== "" && f.phMax != null && f.phMax !== f.phMin ? " \u2013 " + f.phMax : ""));
      var n = (f.lines || []).length;
      return '<tr class="ffs-row' + (open ? " open" : "") + '" data-id="' + ffsEsc(f.id) + '" tabindex="0" aria-expanded="' + open + '">' +
        '<td class="ffs-code"><span class="ffs-mono">' + ffsEsc(f.id) + '</span></td>' +
        '<td class="ffs-kat"><span>' + ffsEsc(f.kategori || "-") + '</span></td>' +
        '<td class="ffs-cust">' + ffsEsc(customerName(f.customerId) || "-") + '</td>' +
        '<td class="ffs-prod"><b>' + ffsEsc(f.productName || "-") + '</b><span>(' + ffsEsc(f.variant || "-") + ')</span></td>' +
        '<td class="ffs-num">' + Engine.fmtNum(f.bj) + '</td>' +
        '<td class="ffs-num">' + ph + '</td>' +
        '<td class="ffs-num">' + ffsEsc(f.viscosity || "-") + '</td>' +
        '<td class="ffs-num">' + (n || '<span style="color:var(--faint)">0</span>') + '</td>' +
        ffsLamps(f) +
        '<td class="ffs-expc"><button class="ffs-btn-exp" type="button" aria-label="Toggle details for ' + ffsEsc(f.id) + '"><svg width="16" height="16" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button></td></tr>' +
        '<tr class="ffs-expander' + (open ? " open" : "") + '" data-for="' + ffsEsc(f.id) + '"><td colspan="13">' + ffsPanel(f) + '</td></tr>';
    }

    function ffsPagerHtml(pages) {
      function btn(label, page, dis, cur) {
        return '<button class="ffs-pg" type="button" data-page="' + page + '"' + (dis ? " disabled" : "") + (cur ? ' aria-current="page"' : "") + '>' + label + '</button>';
      }
      var chev = function (d) { return '<svg width="14" height="14" viewBox="0 0 24 24"><path d="' + d + '"/></svg>'; };
      var h = btn(chev("m14 17-5-5 5-5"), formulaFilter.page - 1, formulaFilter.page === 1, false);
      var list = [];
      for (var p = 1; p <= pages; p++) {
        if (pages <= 6 || p === 1 || p === pages || Math.abs(p - formulaFilter.page) <= 1) list.push(p);
        else if (list[list.length - 1] !== "\u2026") list.push("\u2026");
      }
      list.forEach(function (p) {
        h += p === "\u2026" ? '<span class="ffs-pg dots">\u2026</span>' : btn(p, p, false, p === formulaFilter.page);
      });
      h += btn(chev("m10 17 5-5-5-5"), formulaFilter.page + 1, formulaFilter.page === pages, false);
      return h;
    }

    function ffsRender() {
      var list = ffsFiltered();
      var pages = Math.max(1, Math.ceil(list.length / formulaFilter.rpp));
      if (formulaFilter.page > pages) formulaFilter.page = pages;
      var slice = list.slice((formulaFilter.page - 1) * formulaFilter.rpp, formulaFilter.page * formulaFilter.rpp);
      var pill = wrap.querySelector(".ffs-count");
      if (pill) pill.innerHTML = "<b>" + list.length + "</b> / " + db.formulas.length + " formulas";
      var showing = wrap.querySelector(".ffs-showing");
      if (showing) showing.textContent = list.length ? "Showing " + ((formulaFilter.page - 1) * formulaFilter.rpp + 1) + "\u2013" + Math.min(formulaFilter.page * formulaFilter.rpp, list.length) + " of " + list.length : "No formulas to show";
      var pager = wrap.querySelector(".ffs-pager");
      if (pager) pager.innerHTML = ffsPagerHtml(pages);
      var empty = wrap.querySelector(".ffs-empty");
      if (empty) empty.hidden = list.length > 0;
      var tbody = wrap.querySelector("tbody");
      if (tbody) tbody.innerHTML = slice.map(ffsRow).join("");
    }

    var catOpts = '<option value="">Category: all</option>' + FFS_CATS.map(function (c) { return '<option value="' + ffsEsc(c) + '">' + ffsEsc(c) + '</option>'; }).join("");
    var stabOpts = '<option value="">Stability: all</option><option value="fail">Has Fail</option><option value="run">Has Running</option><option value="pass">All Pass</option><option value="open">Not complete</option>';
    var chevSvg = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

    wrap.innerHTML =
      '<div class="ffs-toolbar">' +
        '<span class="ffs-search"><svg width="16" height="16" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="Search formula code / customer / product\u2026" aria-label="Search formulas"></span>' +
        '<span class="ffs-sel"><select aria-label="Filter by category">' + catOpts + '</select>' + chevSvg + '</span>' +
        '<span class="ffs-sel"><select aria-label="Filter by stability">' + stabOpts + '</select>' + chevSvg + '</span>' +
        '<span class="ffs-count"></span>' +
      '</div>' +
      '<section class="ffs-sheet"><div class="ffs-scroll"><table class="ffs"><thead>' +
        '<tr><th class="ffs-col ffs-span2" rowspan="2">Formula Code</th><th class="ffs-grp" colspan="3">Identity</th><th class="ffs-grp" colspan="4">Technical</th><th class="ffs-grp" colspan="4">Stability</th><th class="ffs-span2" rowspan="2"></th></tr>' +
        '<tr><th class="ffs-col">Category</th><th class="ffs-col">Customer</th><th class="ffs-col">Product <small>(variant)</small></th><th class="ffs-col">BJ <small>(g/mL)</small></th><th class="ffs-col">pH <small>(25\u00b0C)</small></th><th class="ffs-col">Viscosity <small>(cP)</small></th><th class="ffs-col">Lines</th><th class="ffs-col">TK</th><th class="ffs-col">TKUL</th><th class="ffs-col">T50</th><th class="ffs-col">TM</th></tr>' +
      '</thead><tbody></tbody></table></div>' +
      '<div class="ffs-empty" hidden><svg width="44" height="44" viewBox="0 0 24 24"><path d="M9 3h6M10 3v6.3L4.8 18a2.4 2.4 0 0 0 2.1 3.5h10.2a2.4 2.4 0 0 0 2.1-3.5L14 9.3V3M7.5 15h9"/></svg><h2>No formulas match</h2><p>Adjust the search or filters to see the master list again.</p><button class="btn btn-sm ffs-clear" type="button">Clear search &amp; filters</button></div>' +
      '<footer class="ffs-foot"><span class="ffs-showing"></span><nav class="ffs-pager" aria-label="Pagination"></nav><label class="ffs-rpp">Rows <span class="ffs-sel"><select><option>10</option><option>25</option><option>50</option></select>' + chevSvg + '</span></label></footer>' +
      '</section>';

    var searchInput = wrap.querySelector(".ffs-search input");
    var katSel = wrap.querySelector('[aria-label="Filter by category"]');
    var stabSel = wrap.querySelector('[aria-label="Filter by stability"]');
    var rppSel = wrap.querySelector(".ffs-rpp select");
    searchInput.value = formulaFilter.q;
    katSel.value = formulaFilter.kat;
    stabSel.value = formulaFilter.stab;
    rppSel.value = String(formulaFilter.rpp);

    searchInput.addEventListener("input", function () { formulaFilter.q = this.value.trim(); formulaFilter.page = 1; ffsRender(); });
    katSel.addEventListener("change", function () { formulaFilter.kat = this.value; formulaFilter.page = 1; ffsRender(); });
    stabSel.addEventListener("change", function () { formulaFilter.stab = this.value; formulaFilter.page = 1; ffsRender(); });
    rppSel.addEventListener("change", function () { formulaFilter.rpp = +this.value; formulaFilter.page = 1; ffsRender(); });
    wrap.querySelector(".ffs-clear").addEventListener("click", function () {
      formulaFilter.q = ""; formulaFilter.kat = ""; formulaFilter.stab = ""; formulaFilter.page = 1;
      searchInput.value = ""; katSel.value = ""; stabSel.value = "";
      ffsRender();
    });
    wrap.querySelector(".ffs-pager").addEventListener("click", function (e) {
      var b = e.target.closest("button.ffs-pg");
      if (!b || b.disabled) return;
      formulaFilter.page = +b.getAttribute("data-page");
      ffsRender();
    });
    wrap.querySelector("tbody").addEventListener("click", function (e) {
      var actBtn = e.target.closest("[data-act]");
      if (actBtn) {
        var id = actBtn.getAttribute("data-id");
        var rec = db.formulas.filter(function (f) { return f.id === id; })[0];
        if (actBtn.getAttribute("data-act") === "edit" && rec) formulaEditor(rec);
        if (actBtn.getAttribute("data-act") === "del" && rec) {
          UI.confirmDialog("Delete formula " + id + "? BOMs referencing it keep a dangling link.", function () { Store.deleteFormula(id); App.refresh(); });
        }
        return;
      }
      var r = e.target.closest("tr.ffs-row");
      if (r) {
        var rid = r.getAttribute("data-id");
        formulaFilter.open = formulaFilter.open === rid ? null : rid;
        ffsRender();
      }
    });
    wrap.querySelector("tbody").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var r = e.target.closest("tr.ffs-row");
      if (r) { e.preventDefault(); var rid = r.getAttribute("data-id"); formulaFilter.open = formulaFilter.open === rid ? null : rid; ffsRender(); }
    });

    ffsRender();
    if (!canEdit) wrap.appendChild(UI.el("div", { class: "hint", style: "margin-top:6px",
      text: "Read-only for " + ((db.meta.user || {}).role || "your role") + " - the formula master is maintained by RND Formula." }));
    }
    renderComp(root);
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

  function buildCompositionPanel(d, opts) {
    opts = opts || {};
    var iCode = UI.input({ class: "input mono", value: d.id, placeholder: "e.g. LB01SC04BB" });
    if (opts.lockCode) { iCode.disabled = true; iCode.title = "The Formula Code keys all four parts and can't be changed here."; }
    var iKat = UI.select([["", "(select category)"]].concat(FFS_CATS.map(function (c) { return [c, c]; })), d.kategori || "");
    var iForm = UI.select([["", "(select dosage form)"]].concat(Engine.DOSAGE_FORMS), d.dosageForm || "");
    var iCust = customerCombo(d.customerId);
    var iPdr = UI.input({ class: "input mono", value: d.pdrNo || "", placeholder: "e.g. 077/01/2026" });
    var iProductName = UI.input({ value: d.productName || "", placeholder: "e.g. Foundation Cream" });
    var iVariant = UI.input({ value: d.variant || "", placeholder: "e.g. Natural Beige" });
    var iBj = UI.input({ type: "number", step: "0.0001", min: "0", value: String(d.bj == null ? 1 : d.bj) });
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

    /* ---- Special-material handling (FFS tab 5) ---- */
    var specialWrap = UI.el("div");
    function renderSpecial() {
      UI.clear(specialWrap);
      var tbl = UI.el("table", { class: "editor", style: "width:100%;font-size:12.5px" });
      tbl.appendChild(UI.el("thead", {}, [UI.el("tr", {}, [
        UI.el("th", { text: "Material", style: "width:34%" }),
        UI.el("th", { text: "Handling before weighing" }),
        UI.el("th", { style: "width:36px" })
      ])]));
      var tb = UI.el("tbody");
      d.specialHandling.forEach(function (sh, idx) {
        var iMat = UI.input({ value: sh.material || "", placeholder: "e.g. Semua Pasta / material code", style: "width:100%" });
        iMat.addEventListener("input", function () { sh.material = iMat.value; });
        var iHand = UI.input({ value: sh.handling || "", placeholder: "e.g. Diaduk sebelum ditimbang", style: "width:100%" });
        iHand.addEventListener("input", function () { sh.handling = iHand.value; });
        tb.appendChild(UI.el("tr", {}, [
          UI.el("td", {}, [iMat]), UI.el("td", {}, [iHand]),
          UI.el("td", {}, [UI.btn("\u00d7", function () { d.specialHandling.splice(idx, 1); renderSpecial(); }, "btn-danger btn-sm")])
        ]));
      });
      if (!d.specialHandling.length) tb.appendChild(UI.el("tr", {}, [UI.el("td", { colspan: "3", class: "empty", text: "No special-material handling notes." })]));
      tbl.appendChild(tb);
      specialWrap.appendChild(tbl);
      specialWrap.appendChild(UI.el("div", { style: "margin-top:6px" }, [
        UI.btn("+ Add handling", function () { d.specialHandling.push({ material: "", handling: "" }); renderSpecial(); }, "btn-sm")
      ]));
    }
    renderSpecial();

    var body = UI.el("div", { class: "wm-panel" }, [
      UI.el("div", { class: "form-grid" }, [
        UI.field("Formula Code", iCode, opts.lockCode ? "Locked — the Formula Code keys all four parts." : "The doc Kode, e.g. LB01SC04BB (never the FFS document number)."),
        UI.field("Customer", iCust),
        UI.field("PDR No. (Marketing)", iPdr),
        UI.field("Product Name", iProductName),
        UI.field("Variant", iVariant),
        UI.field("Category", iKat),
        UI.field("Dosage Form", iForm, "Feeds the Form segment of the SKU code."),
        UI.field("BJ (specific gravity)", iBj, "Must be > 0; used by netting: qty x netto x BJ x (1+loss).")
      ]),
      UI.el("p", { class: "hint", style: "margin:2px 0 10px",
        text: "pH, viscosity and stability results are edited in the Product Specification and Test Result tabs; they feed this formula automatically." }),
      UI.field("Note", iNote),
      fieldset("Material Composition", [compWrap]),
      fieldset("Special-material handling (FFS tab 5)", [specialWrap])
    ]);
    if (opts.importInfo) body.insertBefore(importBanner(opts.importInfo, opts.existingRec || null), body.firstChild);

    function collect() {
      d.id = iCode.value.trim(); d.kategori = iKat.value; d.dosageForm = iForm.value; d.customerId = iCust.value || "";
      d.pdrNo = iPdr.value.trim();
      d.productName = iProductName.value.trim(); d.variant = iVariant.value.trim();
      d.bj = Number(iBj.value) || 0; d.note = iNote.value.trim();
      d.specialHandling = d.specialHandling.filter(function (sh) { return (sh.material || "").trim() || (sh.handling || "").trim(); })
        .map(function (sh) { return { material: (sh.material || "").trim(), handling: (sh.handling || "").trim() }; });
      d.lines = d.lines.filter(function (l) { return l.materialCode; });
    }
    return { body: body, collect: collect };
  }

  /* ---------------- Master Formula wide editor (Option B) ----------------
     One modal keyed by the selected Formula Code, four tabs inside:
     Composition + Product Specification + Test Result + Machine Setup.
     Panels are built once and cached so typed values survive tab switches;
     each tab imports inline from its own webhook (a nested modal would close
     this editor). Save writes the composition plus every touched part as
     Draft and syncs the QC cache back to the core formula. */
  function formulaEditor(rec) {
    if (!RBAC.canEditMaster("formulas")) { UI.toast("Formula master is read-only for your role", "err"); return; }
    var isNew = !rec;
    var clone = function (o) { return o == null ? null : JSON.parse(JSON.stringify(o)); };
    var d = Object.assign({
      id: "", kategori: "", dosageForm: "", customerId: "", urutan: 0, bj: 1, phMin: "", phMax: "", viscosity: "",
      stabTk: "-", stabTkul: "-", stabT50: "-", stabTm: "-", productName: "", variant: "",
      pdrNo: "", specialHandling: [], note: "", lines: []
    }, clone(rec) || {});
    if (!d.lines) d.lines = [];
    if (!d.specialHandling) d.specialHandling = [];

    var importInfo = {};

    var fid = rec ? rec.id : "";
    var subs = {}, subExisted = {};
    ["lab", "stab", "machine"].forEach(function (k) {
      var existing = Store[ViewsFormulaSub.KINDS[k].byId](fid);
      subExisted[k] = !!existing;
      subs[k] = Object.assign(ViewsFormulaSub.defaults(k), clone(existing) || {}, { id: fid });
    });

    var active = "comp", importing = false, panels = {};
    var TABS = [["comp", "Composition"], ["lab", "Product Specification"], ["stab", "Test Result"], ["machine", "Machine Setup"]];
    var tabBar = UI.el("div", { class: "wm-tabs", role: "tablist" });
    var toolbar = UI.el("div", { class: "wm-toolbar" });
    var panelHost = UI.el("div", { class: "wm-body" });
    var wideBody = UI.el("div", { class: "wm" }, [tabBar, toolbar, panelHost]);

    function presence(k) { return k === "comp" ? !!(d.id || (d.lines || []).length) : ViewsFormulaSub.hasContent(k, subs[k]); }
    function getPanel(k) {
      if (!panels[k]) {
        panels[k] = k === "comp"
          ? buildCompositionPanel(d, { importInfo: importInfo.comp, existingRec: rec, lockCode: !isNew })
          : ViewsFormulaSub.panel(k, subs[k], { importInfo: importInfo[k] });
      }
      return panels[k];
    }
    function collectActive() { if (panels[active]) panels[active].collect(); }
    function drawTabs() {
      UI.clear(tabBar);
      TABS.forEach(function (t) {
        var k = t[0], ok = presence(k);
        tabBar.appendChild(UI.el("button", {
          class: "wm-tab" + (active === k ? " on" : ""), role: "tab", "aria-selected": active === k ? "true" : "false",
          onclick: function () { showTab(k); }
        }, [t[1], UI.el("span", { class: ok ? "ok" : "miss", text: ok ? "✓" : "—" })]));
      });
    }
    function drawToolbar() {
      UI.clear(toolbar);
      toolbar.appendChild(UI.el("span", { class: "wm-code mono", text: d.id || "(new formula)" }));
      toolbar.appendChild(UI.el("span", { class: "sp" }));
      toolbar.appendChild(UI.btn("Import PDF", function () { doImport(active); }, "btn-sm"));
    }
    function showTab(k) {
      if (importing) return;
      collectActive();
      active = k;
      drawTabs(); drawToolbar();
      UI.clear(panelHost);
      panelHost.appendChild(getPanel(k).body);
    }
    function doImport(k) {
      if (importing) return;
      var cfg = Store.ocrConfig(k === "comp" ? "formula" : ViewsFormulaSub.KINDS[k].cfg);
      if (!cfg.webhookUrl || !cfg.token) {
        UI.toast("Import isn't configured for this part yet — add its webhook in Settings & Data.", "err");
        return;
      }
      var inp = UI.el("input", { type: "file", accept: ".pdf,application/pdf", style: "display:none" });
      document.body.appendChild(inp);
      inp.addEventListener("change", function () {
        if (inp.files && inp.files[0]) { var f = inp.files[0]; inp.remove(); runTabImport(k, f); }
        else inp.remove();
      });
      inp.click();
    }
    function runTabImport(k, file) {
      collectActive();
      importing = true;
      UI.clear(panelHost);
      panelHost.appendChild(UI.el("div", { class: "wm-importing" }, [
        UI.el("div", { class: "spinner" }),
        UI.el("p", { text: "Parsing " + file.name + "… usually 10–30 s" })
      ]));
      function fail(err) { importing = false; showTab(k); UI.toast((err && err.message) || "Import failed", "err"); }
      if (k === "comp") {
        OCRImport.parsePdf(file, Store.ocrConfig("formula")).then(function (payload) {
          var res = OCRImport.mapToFormulaDraft(payload, Store.get());
          Object.keys(res.draft).forEach(function (kk) { if (res.draft[kk] !== undefined) d[kk] = res.draft[kk]; });
          d.lines = (res.draft.lines || []).map(function (l) { return Object.assign({}, l); });
          if (!isNew) d.id = rec.id;
          importInfo.comp = { fileName: (payload.document && payload.document.fileName) || file.name, warnings: res.warnings };
          delete panels.comp;
          importing = false; showTab("comp");
          UI.toast("Parsed " + file.name + " — review the values, then Save as Draft", "ok");
        }, fail);
      } else {
        ViewsFormulaSub.parseImport(k, file, function (res, fileName) {
          Object.keys(res.draft).forEach(function (kk) { subs[k][kk] = res.draft[kk]; });
          subs[k].id = d.id || fid;
          importInfo[k] = { fileName: fileName, warnings: res.warnings };
          delete panels[k];
          importing = false; showTab(k);
          UI.toast("Parsed " + fileName + " — review the values, then Save as Draft", "ok");
        }, fail);
      }
    }
    function saveAll() {
      if (importing) { UI.toast("Import in progress — wait for it to finish", "err"); return; }
      Object.keys(panels).forEach(function (k) { panels[k].collect(); });
      if (!d.id) { UI.toast("Formula Code is required", "err"); showTab("comp"); return; }
      if (!(d.bj > 0)) { UI.toast("BJ must be greater than 0", "err"); showTab("comp"); return; }
      if (isNew && Store.formulaById(d.id)) { UI.toast("Formula Code already exists", "err"); showTab("comp"); return; }
      Store.saveFormula(d, isNew, rec ? rec.id : null);
      if (importInfo.comp) Store.audit("IMPORT", "Master Formula", d.id + " confirmed from " + importInfo.comp.fileName);
      ["lab", "stab", "machine"].forEach(function (k) {
        if (!panels[k] && !importInfo[k]) return;
        var sd = subs[k];
        if (!subExisted[k] && !ViewsFormulaSub.hasContent(k, sd)) return;
        sd.id = d.id; sd.status = "Draft";
        ViewsFormulaSub.stamp(sd);
        Store[ViewsFormulaSub.KINDS[k].save](sd, !subExisted[k], subExisted[k] ? fid : null);
        ViewsFormulaSub.syncCoreCache(k, sd);
        if (importInfo[k]) Store.audit("IMPORT", ViewsFormulaSub.KINDS[k].entity, sd.id + " confirmed from " + importInfo[k].fileName);
      });
      UI.closeModal(); App.refresh();
      UI.toast("Formula " + d.id + " saved as Draft", "ok");
    }

    UI.modal({
      title: isNew ? "New Formula" : "Edit Formula — " + rec.id,
      body: wideBody, wide: true,
      actions: [{ label: "Save as Draft", cls: "btn-primary", onClick: saveAll }]
    });
    showTab("comp");
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
      "Packaging parameters (FR-PD-03 / PD00100): variants, container, nominal fill volume with its absolute QA band, packing machines and process steps. NA is supplied by Regulatory on the F/G later. Maintained by RND Kemas.",
      canEdit ? [UI.btn("+ New Packaging", function () { packagingEditor(null); }, "btn-primary")] : []));
    var search = UI.input({ placeholder: "Search FPS code, product, customer, variant...", value: packFilter.q });
    search.addEventListener("input", function () { packFilter.q = search.value; draw(); });
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = packFilter.q.toLowerCase();
      var rows = db.packagings.filter(function (p) {
        if (!q) return true;
        return (p.id + " " + (p.productName || "") + " " + (p.inkjetSyntax || "") + " " +
          customerName(p.customerId) + " " + (p.variants || []).join(" ")).toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
      bodyWrap.appendChild(UI.table([
        { label: "FPS Code", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.id) + "</b>"; } },
        { label: "Customer", render: function (r) { return Engine.esc(customerName(r.customerId) || "-"); } },
        { label: "Product", render: function (r) { return Engine.esc(r.productName || "-"); } },
        { label: "Variants", render: function (r) {
          var v = r.variants || [];
          return v.length ? Engine.esc(v.join(", ")) : "<span class='row-muted'>\u2014</span>";
        } },
        { label: "Fill (mL)", cls: "num", render: function (r) {
          var s = Engine.fmtNum(r.volumeMl || 0);
          if (r.fillMinMl != null && r.fillMaxMl != null) {
            return s + " <span class='row-muted'>(" + Engine.fmtNum(r.fillMinMl) + "\u2013" + Engine.fmtNum(r.fillMaxMl) + ")</span>";
          }
          return s + (r.fillTolPct ? " \u00b1" + Engine.fmtNum(r.fillTolPct) + "%" : "");
        } },
        { label: "Inkjet positions", render: function (r) { return Engine.esc(r.inkjetSyntax || "-"); } },
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
    var d = Object.assign({ id: "", customerId: "", productName: "", urutanVarian: 0,
      volumeMl: 0, fillTolPct: 0, fillMinMl: null, fillMaxMl: null, revisi: 1,
      storageTemp: "", mboxQty: 0, inkjetSyntax: "", note: "",
      variants: [], container: [], machines: [], steps: [], lines: [] }, rec || {});
    if (!d.lines) d.lines = [];
    if (!d.variants) d.variants = [];
    if (!d.container) d.container = [];
    if (!d.machines) d.machines = [];
    if (!d.steps) d.steps = [];
    var iCode = UI.input({ class: "input mono", value: d.id, placeholder: "e.g. 10040300 (NO FG)" });
    var iCust = customerCombo(d.customerId);
    var iProd = UI.input({ value: d.productName || "", placeholder: "e.g. SASC Liquid Blush" });
    var iVol = UI.input({ type: "number", step: "0.01", min: "0", value: String(d.volumeMl || 0) });
    var iRev = UI.input({ type: "number", step: "1", min: "1", max: "99", value: String(d.revisi || 1) });
    var iFillMin = UI.input({ type: "number", step: "0.01", min: "0", value: d.fillMinMl == null ? "" : String(d.fillMinMl) });
    var iFillMax = UI.input({ type: "number", step: "0.01", min: "0", value: d.fillMaxMl == null ? "" : String(d.fillMaxMl) });
    var iStore = UI.input({ value: d.storageTemp || "", placeholder: "e.g. 25\u201337 \u00b0C" });
    var iMbox = UI.input({ type: "number", step: "1", min: "0", value: String(d.mboxQty || 0) });
    var iInk = UI.input({ value: d.inkjetSyntax || "", placeholder: "e.g. bottom sticker \u00b7 box satuan \u00b7 mbox" });
    var iNote = UI.el("textarea", { class: "input", rows: "2", style: "width:100%" });
    iNote.value = d.note || "";

    /* ---- Reusable name-list editor (variants / container / machines) ---- */
    function stringList(arr, placeholder, addLabel, emptyText) {
      var wrap = UI.el("div");
      function draw() {
        UI.clear(wrap);
        arr.forEach(function (val, idx) {
          var row = UI.el("div", { class: "btn-row", style: "margin:0 0 4px;align-items:center" });
          var inp = UI.input({ value: val || "", placeholder: placeholder, style: "flex:1" });
          inp.addEventListener("input", function () { arr[idx] = inp.value; });
          row.appendChild(inp);
          row.appendChild(UI.btn("\u00d7", function () { arr.splice(idx, 1); draw(); }, "btn-danger btn-sm"));
          wrap.appendChild(row);
        });
        if (!arr.length) wrap.appendChild(UI.el("p", { class: "hint", style: "margin:0 0 4px", text: emptyText }));
        wrap.appendChild(UI.el("div", {}, [UI.btn(addLabel, function () { arr.push(""); draw(); }, "btn-sm")]));
      }
      draw();
      return wrap;
    }
    var variantsWrap = stringList(d.variants, "e.g. Rich Girl Era", "+ Add variant", "No variants listed yet.");
    var containerWrap = stringList(d.container, "e.g. Pot, Inner plug, Cap", "+ Add container part", "No container parts listed yet.");
    var machinesWrap = stringList(d.machines, "e.g. Inkjet print, Mesin segel, Shrink tunnel", "+ Add machine", "No packing machines listed yet.");

    /* ---- Packing process steps (step + parameter / standard) ---- */
    var stepsWrap = UI.el("div");
    function drawSteps() {
      UI.clear(stepsWrap);
      var tbl = UI.el("table", { class: "editor", style: "width:100%;font-size:12.5px" });
      tbl.appendChild(UI.el("thead", {}, [UI.el("tr", {}, [
        UI.el("th", { text: "No", style: "width:32px" }),
        UI.el("th", { text: "Packing step" }),
        UI.el("th", { text: "Parameter / standard", style: "width:200px" }),
        UI.el("th", { text: "", style: "width:36px" })
      ])]));
      var tb = UI.el("tbody");
      d.steps.forEach(function (st, idx) {
        var tr = UI.el("tr");
        tr.appendChild(UI.el("td", { text: String(idx + 1) }));
        var iStep = UI.el("textarea", { class: "input", rows: "2", style: "width:100%" });
        iStep.value = st.step || "";
        iStep.addEventListener("input", function () { st.step = iStep.value; });
        tr.appendChild(UI.el("td", {}, [iStep]));
        var iParam = UI.input({ value: st.param || "", placeholder: "e.g. Sesuai \u00b7 rapi", style: "width:100%" });
        iParam.addEventListener("input", function () { st.param = iParam.value; });
        tr.appendChild(UI.el("td", {}, [iParam]));
        tr.appendChild(UI.el("td", {}, [UI.btn("\u00d7", function () {
          d.steps.splice(idx, 1); drawSteps();
        }, "btn-danger btn-sm", { style: "padding:2px 7px;font-size:14px" })]));
        tb.appendChild(tr);
      });
      if (!d.steps.length) tb.appendChild(UI.el("tr", {}, [UI.el("td", { colspan: "4", class: "empty", text: "No packing steps yet." })]));
      tbl.appendChild(tb);
      stepsWrap.appendChild(tbl);
      stepsWrap.appendChild(UI.el("div", { style: "margin-top:6px" }, [
        UI.btn("+ Add step", function () { d.steps.push({ step: "", param: "" }); drawSteps(); }, "btn-sm")
      ]));
    }
    drawSteps();

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
        UI.field("FPS Code", iCode, "Packaging master code (NO FG) - not the F/G product code."),
        UI.field("Customer", iCust),
        UI.field("Product Name", iProd),
        UI.field("Volume / Netto (mL)", iVol, "Nominal fill volume."),
        UI.field("Revision (01-99)", iRev, "Feeds the Rev segment of the SKU code; bump on packaging revision."),
        UI.field("Fill min (mL)", iFillMin, "Absolute QA fill band; overrides nominal \u00b1 tolerance when both are set."),
        UI.field("Fill max (mL)", iFillMax),
        UI.field("FG storage temp", iStore),
        UI.field("Mbox qty (pcs)", iMbox),
        UI.field("Inkjet positions", iInk)
      ]),
      UI.field("Note", iNote),
      fieldset("Variants (names only)", [variantsWrap,
        UI.el("p", { class: "hint", style: "margin:6px 0 0", text: "NA numbers are supplied by Regulatory on the F/G later - not stored here." })]),
      fieldset("Container", [containerWrap]),
      fieldset("Packaging Composition", [compWrap]),
      fieldset("Packing machines", [machinesWrap]),
      fieldset("Packing process steps", [stepsWrap])
    ]);
    UI.modal({
      title: isNew ? "New Packaging (FPS)" : "Edit Packaging - " + rec.id,
      body: body, wide: true,
      actions: [{
        label: "Save Packaging", cls: "btn-primary", onClick: function () {
          d.id = iCode.value.trim(); d.customerId = iCust.value || "";
          d.productName = iProd.value.trim();
          d.volumeMl = Number(iVol.value) || 0;
          d.revisi = Math.min(99, Math.max(1, Number(iRev.value) || 1));
          d.fillMinMl = iFillMin.value.trim() === "" ? null : Number(iFillMin.value);
          d.fillMaxMl = iFillMax.value.trim() === "" ? null : Number(iFillMax.value);
          d.storageTemp = iStore.value.trim();
          d.mboxQty = Number(iMbox.value) || 0;
          d.inkjetSyntax = iInk.value.trim();
          d.note = iNote.value.trim();
          d.variants = d.variants.map(function (s) { return String(s || "").trim(); }).filter(Boolean);
          d.container = d.container.map(function (s) { return String(s || "").trim(); }).filter(Boolean);
          d.machines = d.machines.map(function (s) { return String(s || "").trim(); }).filter(Boolean);
          d.steps = d.steps.map(function (s) { return { step: String(s.step || "").trim(), param: String(s.param || "").trim() }; })
            .filter(function (s) { return s.step || s.param; });
          d.urutanVarian = d.variants.length;
          /* derive the legacy tolerance band for list/BOM display; the QA check
             itself prefers the absolute fillMinMl/fillMaxMl recorded above */
          if (d.fillMinMl != null && d.fillMaxMl != null && d.volumeMl > 0) {
            var dev = Math.max(Math.abs(d.fillMaxMl - d.volumeMl), Math.abs(d.volumeMl - d.fillMinMl));
            d.fillTolPct = Math.round(dev / d.volumeMl * 10000) / 100;
          }
          /* drop the pre-012 parameters an old working copy may carry (revisi
             is kept - 020 re-adds it as the SKU Rev segment) */
          delete d.fillMin; delete d.fillMax; delete d.shrinkTunnelC;
          if (!d.id) { UI.toast("FPS code is required", "err"); return; }
          if (d.volumeMl < 0) { UI.toast("Volume must be >= 0", "err"); return; }
          if (d.fillMinMl != null && d.fillMinMl < 0) { UI.toast("Fill min must be >= 0", "err"); return; }
          if (d.fillMaxMl != null && d.fillMaxMl < 0) { UI.toast("Fill max must be >= 0", "err"); return; }
          if (d.fillMinMl != null && d.fillMaxMl != null && d.fillMaxMl < d.fillMinMl) { UI.toast("Fill max must be >= fill min", "err"); return; }
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
