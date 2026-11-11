/* ============================================================
   VIEWS - SKU Recode (legacy FFS-FPS -> 13-char, one-time)
   ============================================================ */
window.ViewsRecode = (function () {
  function list(root) {
    var db = Store.get();
    var legacy = db.fgs.filter(function (f) { return f.id.indexOf("|") >= 0 && !(f.brandId && f.seq); })
      .sort(function (a, b) { return Store.fgRecentCompare(b, a); }); /* oldest first */
    root.appendChild(UI.el("div", { class: "btn-row", style: "margin-bottom:10px" }, [
      UI.el("h2", { text: "SKU Recode", style: "margin:0;flex:1" }),
      UI.btn("Export crosswalk CSV", function () { Store.exportCrosswalkCSV(); }, "btn-sm")
    ]));
    root.appendChild(UI.el("p", { class: "hint", text: legacy.length
      ? legacy.length + " legacy SKU(s). Rows are proposed oldest-first; confirm each row (or fix the proposal) to issue its 13-char code. Ids and downstream documents never change; the old code is kept as Legacy Code."
      : "Nothing to recode - every SKU is on the 13-char scheme." }));
    legacy.forEach(function (f) { root.appendChild(row(f)); });
  }
  function row(f) {
    var db = Store.get();
    var st = {
      brand: f.brandId || "",
      formulaId: f.formulaId || (Store.formulaById(f.ffs) ? f.ffs : ""),
      packagingId: f.packagingId || (Store.packagingById(f.fps) ? f.fps : ""),
      seq: 0, size: ""
    };
    var wrap = UI.el("div", { class: "preview-box", style: "margin-bottom:10px" });
    var pv = UI.el("span", { class: "mono", style: "font-weight:700" });
    function propose() {
      var fo = Store.formulaById(st.formulaId), pa = Store.packagingById(st.packagingId);
      var app = fo ? Engine.appOf(fo.kategori) : "", form = fo ? (fo.dosageForm || "") : "";
      var netto = pa ? Number(pa.volumeMl) || 0 : 0, rev = pa ? Number(pa.revisi) || 1 : 0;
      st.seq = (st.brand && app && form) ? Engine.seqFor(db.fgs, st.brand, app, form, st.formulaId) : 0;
      st.size = (st.seq) ? Engine.sizeFor(db.fgs, st.brand, app, form, st.seq, netto) : "";
      st.app = app; st.form = form; st.netto = netto; st.rev = rev;
      pv.textContent = (st.brand && app && form && st.seq && st.size)
        ? Engine.skuCode({ brand: st.brand, app: app, form: form, seq: st.seq, size: st.size, rev: rev })
        : "(incomplete)";
    }
    var iB = UI.combo([["", "(brand)"]].concat(db.brands.map(function (b) { return [b.id, b.id + " - " + b.name]; })), st.brand, "Brand...");
    var iF = UI.combo([["", "(formula)"]].concat(db.formulas.map(function (x) { return [x.id, x.id + " - " + (x.productName || "")]; })), st.formulaId, "Formula...");
    var iP = UI.combo([["", "(FPS)"]].concat(db.packagings.map(function (x) { return [x.id, x.id + " · " + (x.volumeMl || 0) + " mL"]; })), st.packagingId, "FPS...");
    var iSeq = UI.input({ type: "number", min: "1", max: "999", style: "width:70px" });
    var iSize = UI.input({ class: "mono", maxlength: 1, style: "width:50px" });
    iB.addEventListener("change", function () { st.brand = iB.value; propose(); iSeq.value = st.seq; iSize.value = st.size; });
    iF.addEventListener("change", function () { st.formulaId = iF.value; propose(); iSeq.value = st.seq; iSize.value = st.size; });
    iP.addEventListener("change", function () { st.packagingId = iP.value; propose(); iSeq.value = st.seq; iSize.value = st.size; });
    iSeq.addEventListener("input", function () { st.seq = Number(iSeq.value) || 0; });
    iSize.addEventListener("input", function () { st.size = (iSize.value || "").toUpperCase(); });
    wrap.appendChild(UI.el("div", { style: "margin-bottom:6px" }, [
      UI.el("span", { class: "mono", text: f.kodeFG }), UI.el("span", { text: "  " + f.deskripsi })
    ]));
    wrap.appendChild(UI.el("div", { class: "form-grid" }, [
      UI.field("Brand", iB), UI.field("Formula", iF), UI.field("FPS", iP),
      UI.field("Seq (override)", iSeq), UI.field("Size (override)", iSize),
      UI.field("New code", pv)
    ]));
    wrap.appendChild(UI.btn("Confirm recode", function () {
      var fo = Store.formulaById(st.formulaId);
      if (!st.brand || !Store.brandById(st.brand)) { UI.toast("Pick a brand", "err"); return; }
      if (!fo) { UI.toast("Pick the formula master", "err"); return; }
      if (!Engine.appOf(fo.kategori) || !fo.dosageForm) { UI.toast("Formula needs category + dosage form first", "err"); return; }
      if (!Store.packagingById(st.packagingId)) { UI.toast("Pick the FPS master", "err"); return; }
      if (!st.seq || st.seq > 999 || !/^[A-Z]$/.test(st.size)) { UI.toast("Seq/size invalid", "err"); return; }
      var code = Engine.skuCode({ brand: st.brand, app: st.app, form: st.form, seq: st.seq, size: st.size, rev: st.rev });
      if (!Engine.validSkuCode(code)) { UI.toast("Invalid code " + code, "err"); return; }
      if (Store.fgById(code)) { UI.toast("Code already issued: " + code, "err"); return; }
      Store.recodeFG(f.id, { brand: st.brand, formulaId: st.formulaId, packagingId: st.packagingId, app: st.app, form: st.form, seq: st.seq, size: st.size, netto: st.netto, rev: st.rev });
      UI.toast("Recoded " + f.kodeFG + " -> " + code, "ok");
      App.refresh();
    }, "btn-primary btn-sm"));
    propose();
    iSeq.value = st.seq; iSize.value = st.size;
    return wrap;
  }
  return { list: list };
})();