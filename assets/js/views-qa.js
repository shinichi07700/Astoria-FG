/* ============================================================
   VIEWS - QA / QC (Phase 4)
   Three QC surfaces over the production work orders:
     1. Line clearances FR-QA-21 (mixing & filling), FR-QA-22
        (packing), FR-QA-23 (inkjet batch/ED). A Passed clearance
        gates the matching work order (store.transitionBulkWo /
        transitionPackWo refuse to start until it is Passed).
     2. In-process controls FR-QA-25 (weight uniformity) and
        FR-QC-05 (seal integrity) plus homogenizer Hz / temperature
        profiles, validated against the limits on the formula and
        packaging masters (Store.ipcLimit through the FG's BOM).
     3. Release FR-QC-06: QA disposition Approved / Rejected / Hold;
        only an Approved release may proceed to FG receipt (Phase 5).
   ============================================================ */
window.ViewsQA = (function () {

  var lcFilter = { q: "", status: "", type: "" };
  var ipcFilter = { q: "", type: "" };
  var relFilter = { q: "", disposition: "" };

  var CHECKLISTS = {
    "FR-QA-21": ["Line cleared from previous product", "No leftover bulk / labels / documents",
      "Equipment clean & calibrated", "Raw materials verified vs BOM & released lots",
      "Weighing balance verified", "Environmental (RH / temp) within limit"],
    "FR-QA-22": ["Packing line cleared", "Correct packaging components staged",
      "Inkjet / label artwork verified vs FPS", "Carton & master shipper correct",
      "Sealer / shrink-tunnel settings verified", "Bulk release & BTIP transfer confirmed"],
    "FR-QA-23": ["Batch code correct vs work order", "Expiry date (ED) correct",
      "Inkjet legible & correctly positioned", "Coding syntax matches FPS master",
      "Batch / ED verified against SO & label spec"]
  };
  var IPC_PARAMS = [["fill", "Fill / weight uniformity"], ["ph", "pH"], ["seal", "Seal integrity (leaks)"],
    ["homogenizer_hz", "Homogenizer (Hz)"], ["temperature_c", "Temperature (\u00b0C)"], ["other", "Other"]];

  function lcPill(s) { var cls = s === "Passed" ? "aktif" : s === "Failed" ? "nonaktif" : "pending"; return UI.el("span", { class: "pill " + cls, text: s || "Open" }); }
  function resPill(s) { return UI.el("span", { class: "pill " + (s === "Fail" ? "nonaktif" : "aktif"), text: s || "Pass" }); }
  /* mirror of store.checkPass for live (pre-save) row feedback */
  function localPass(c) {
    var v = Number(c.value);
    if (isNaN(v)) return c.pass !== false;
    if (c.min !== "" && c.min != null && v < Number(c.min)) return false;
    if (c.max !== "" && c.max != null && v > Number(c.max)) return false;
    return true;
  }
  function dispPill(s) { var cls = s === "Approved" ? "aktif" : s === "Rejected" ? "nonaktif" : s === "Hold" ? "info" : "pending"; return UI.el("span", { class: "pill " + cls, text: s || "Pending" }); }

  function woOptions(db) {
    var opts = [["", "(select a work order)"]];
    db.workOrdersBulk.forEach(function (w) {
      var f = Store.fgById(w.fgId);
      opts.push([w.id, "BULK " + (w.campaignNo || w.woNo) + " \u00b7 batch " + w.batchSeq + " \u00b7 " + (f ? f.kodeFG : (w.fgId || "-")) + " [" + w.status + "]"]);
    });
    db.workOrdersPack.forEach(function (w) {
      var f = Store.fgById(w.fgId);
      opts.push([w.id, "PACK " + (w.woNo || w.campaignNo) + " \u00b7 " + (f ? f.kodeFG : (w.fgId || "-")) + " [" + w.status + "]"]);
    });
    return opts;
  }
  function findWo(db, id) {
    if (!id) return null;
    var b = db.workOrdersBulk.filter(function (w) { return String(w.id) === String(id); })[0];
    if (b) return { wo: b, type: "Bulk" };
    var p = db.workOrdersPack.filter(function (w) { return String(w.id) === String(id); })[0];
    if (p) return { wo: p, type: "Pack" };
    return null;
  }
  function woRefOf(f) { return f ? (f.type === "Bulk" ? (f.wo.campaignNo || f.wo.woNo) : f.wo.woNo) : ""; }

  /* ---------------- page ---------------- */
  function list(root) {
    var db = Store.get();
    root.appendChild(UI.pageHead("QA / QC",
      "Line clearances (FR-QA-21/22/23) gate each production step, in-process controls (FR-QA-25 weight uniformity, FR-QC-05 seal integrity) are validated against the formula/packaging master limits, and the final release (FR-QC-06) dispositions the finished batch.",
      []));
    root.appendChild(clearanceCard(db));
    root.appendChild(ipcCard(db));
    root.appendChild(releaseCard(db));
    if (!RBAC.canInspect()) root.appendChild(UI.el("div", { class: "hint", style: "margin-top:6px",
      text: "Read-only for " + ((db.meta.user || {}).role || "your role") + " - QA/QC signs clearances, IPC and releases." }));
  }

  /* ---------- 1. line clearances ---------- */
  function clearanceCard(db) {
    var canQA = RBAC.canInspect();
    var search = UI.input({ placeholder: "Search clearance no / work order / campaign...", value: lcFilter.q });
    var fType = UI.select([["", "All types"], ["FR-QA-21", "FR-QA-21 mixing/filling"], ["FR-QA-22", "FR-QA-22 packing"], ["FR-QA-23", "FR-QA-23 inkjet"]], lcFilter.type);
    var fStatus = UI.select([["", "All statuses"], ["Open", "Open"], ["Passed", "Passed"], ["Failed", "Failed"]], lcFilter.status);
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = lcFilter.q.toLowerCase();
      var rows = db.lineClearances.filter(function (c) {
        if (lcFilter.type && c.clearanceType !== lcFilter.type) return false;
        if (lcFilter.status && c.status !== lcFilter.status) return false;
        if (!q) return true;
        return ((c.clearanceNo || "") + " " + (c.woRef || "") + " " + (c.campaignNo || "") + " " + (c.clearanceType || "")).toLowerCase().indexOf(q) >= 0;
      });
      bodyWrap.appendChild(UI.table([
        { label: "Clearance No", cls: "mono", render: function (c) { return "<b>" + Engine.esc(c.clearanceNo) + "</b>"; } },
        { label: "Type", render: function (c) { return UI.tag(c.clearanceType); } },
        { label: "Work order", cls: "mono", render: function (c) { return Engine.esc(c.woRef || c.woId || "-"); } },
        { label: "Campaign", cls: "mono", render: function (c) { return Engine.esc(c.campaignNo || "-"); } },
        { label: "Checks", cls: "num", render: function (c) {
          var n = (c.checklist || []).filter(function (x) { return x.ok; }).length;
          return n + " / " + (c.checklist || []).length;
        } },
        { label: "QC signer", render: function (c) { return Engine.esc(c.qcSigner || "-"); } },
        { label: "Status", render: function (c) { return lcPill(c.status); } },
        { label: "", render: function (c) { return lcActions(c, canQA); } }
      ], rows, { emptyText: "No line clearance yet. Raise one against a released work order." }));
    }
    function lcActions(c, canQA) {
      var btns = [UI.btn("View", function () { viewClearance(c); }, "btn-sm")];
      if (canQA && c.status === "Open") {
        RBAC.transitionsFrom("lineClearance", "Open").forEach(function (t) {
          btns.push(UI.btn(t.to === "Passed" ? "Pass" : "Fail", function () { decide(c, t.to); },
            "btn-sm " + (t.to === "Passed" ? "btn-primary" : "btn-danger")));
        });
      }
      btns.push(UI.btn("Print", function () { printClearance(c.clearanceNo); }, "btn-sm"));
      return UI.el("div", { class: "btn-row" }, btns);
    }
    function decide(c, to) {
      UI.confirmDialog((to === "Passed" ? "Pass" : "Fail") + " line clearance " + c.clearanceNo +
        " (" + c.clearanceType + ") for " + (c.woRef || c.woId) + "?" +
        (to === "Passed" ? " The gated work order may then start." : " The work order stays blocked."), function () {
        if (Store.setClearanceStatus(c.id, to)) { App.refresh(); UI.toast("Clearance " + to.toLowerCase(), "ok"); }
        else UI.toast("QA disposition not allowed for your role", "err");
      }, to + " clearance");
    }
    search.addEventListener("input", function () { lcFilter.q = search.value; draw(); });
    fType.addEventListener("change", function () { lcFilter.type = fType.value; draw(); });
    fStatus.addEventListener("change", function () { lcFilter.status = fStatus.value; draw(); });

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "Line clearances (FR-QA-21 / 22 / 23)" }),
      canQA ? UI.btn("New clearance", clearanceEditor, "btn-primary btn-sm") : UI.el("span", { class: "hint", text: "Read-only for your role" })]));
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, fType, fStatus, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.lineClearances.length + " records" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    draw();
    return card;
  }
  function clearanceEditor() {
    if (!RBAC.canInspect()) { UI.toast("Only QA may raise a line clearance", "err"); return; }
    var db = Store.get();
    var iWo = UI.combo(woOptions(db), "", "Type to search work order...");
    var iType = UI.select([["FR-QA-21", "FR-QA-21 (mixing & filling)"], ["FR-QA-22", "FR-QA-22 (packing)"], ["FR-QA-23", "FR-QA-23 (inkjet batch/ED)"]], "FR-QA-21");
    var iNote = UI.input({ value: "", placeholder: "Note" });
    var items = [];
    var checksWrap = UI.el("div");
    function loadChecklist() {
      items = (CHECKLISTS[iType.value] || []).map(function (t) { return { item: t, ok: false, note: "" }; });
      drawChecks();
    }
    function drawChecks() {
      UI.clear(checksWrap);
      items.forEach(function (it) {
        var cb = UI.el("input", { type: "checkbox" }); cb.checked = !!it.ok;
        cb.addEventListener("change", function () { it.ok = cb.checked; });
        var note = UI.input({ value: it.note || "", placeholder: "remark", style: "width:180px" });
        note.addEventListener("input", function () { it.note = note.value; });
        checksWrap.appendChild(UI.el("div", { style: "display:flex;gap:8px;align-items:center;margin:3px 0" },
          [cb, UI.el("span", { style: "flex:1;font-size:12.5px", text: it.item }), note]));
      });
    }
    iType.addEventListener("change", loadChecklist);
    loadChecklist();
    UI.modal({
      title: "New line clearance", wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "form-grid" }, [
          UI.field("Work order", iWo, "Bulk WOs are gated by FR-QA-21; pack WOs by FR-QA-22."),
          UI.field("Clearance type", iType)
        ]),
        UI.el("div", { style: "font-weight:700;font-size:12.5px;margin:8px 0 4px", text: "Checklist" }),
        checksWrap, UI.field("Note", iNote)
      ]),
      actions: [{
        label: "Create clearance", cls: "btn-primary", onClick: function () {
          if (!iWo.value) { UI.toast("Select a work order", "err"); return; }
          var f = findWo(db, iWo.value);
          var res = Store.createLineClearance({
            clearanceType: iType.value, woType: f ? f.type : "Bulk", woId: iWo.value,
            woRef: woRefOf(f), campaignNo: f && f.wo.campaignNo ? f.wo.campaignNo : "",
            checklist: items, note: iNote.value.trim()
          });
          UI.closeModal(); App.refresh(); UI.toast("Line clearance " + res.clearanceNo + " created (Open)", "ok");
        }
      }]
    });
  }
  function viewClearance(c) {
    UI.modal({
      title: "Line clearance " + c.clearanceNo, wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "kv", style: "margin-bottom:10px" }, [
          UI.el("dt", { text: "Type" }), UI.el("dd", {}, [UI.tag(c.clearanceType)]),
          UI.el("dt", { text: "Work order" }), UI.el("dd", { class: "mono", text: (c.woRef || c.woId || "-") + " (" + c.woType + ")" }),
          UI.el("dt", { text: "Campaign" }), UI.el("dd", { class: "mono", text: c.campaignNo || "-" }),
          UI.el("dt", { text: "Status" }), UI.el("dd", {}, [lcPill(c.status)]),
          UI.el("dt", { text: "QC signer" }), UI.el("dd", { text: c.qcSigner || "-" }),
          UI.el("dt", { text: "QC time" }), UI.el("dd", { class: "mono", text: c.qcTime || "-" }),
          UI.el("dt", { text: "Note" }), UI.el("dd", { text: c.note || "-" })
        ]),
        UI.table([
          { label: "#", cls: "num", render: function (x, i) { return String((c.checklist || []).indexOf(x) + 1); } },
          { label: "Checklist item", render: function (x) { return Engine.esc(x.item); } },
          { label: "OK", render: function (x) { return x.ok ? "<span style='color:var(--green)'>&#10003;</span>" : "<span style='color:var(--muted)'>&mdash;</span>"; } },
          { label: "Remark", render: function (x) { return Engine.esc(x.note || ""); } }
        ], c.checklist || [], { emptyText: "No checklist." })
      ]),
      actions: [{ label: "Print", onClick: function () { UI.closeModal(); printClearance(c.clearanceNo); } }]
    });
  }

  /* ---------- 2. in-process controls ---------- */
  function ipcCard(db) {
    var canQA = RBAC.canInspect();
    var search = UI.input({ placeholder: "Search IPC no / work order / campaign...", value: ipcFilter.q });
    var fType = UI.select([["", "All types"], ["FR-QA-25", "FR-QA-25 weight uniformity"], ["FR-QC-05", "FR-QC-05 seal integrity"], ["PROCESS", "Process profile"]], ipcFilter.type);
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = ipcFilter.q.toLowerCase();
      var rows = db.ipcRecords.filter(function (r) {
        if (ipcFilter.type && r.ipcType !== ipcFilter.type) return false;
        if (!q) return true;
        return ((r.ipcNo || "") + " " + (r.woRef || "") + " " + (r.campaignNo || "") + " " + (r.ipcType || "")).toLowerCase().indexOf(q) >= 0;
      });
      bodyWrap.appendChild(UI.table([
        { label: "IPC No", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.ipcNo) + "</b>"; } },
        { label: "Type", render: function (r) { return UI.tag(r.ipcType); } },
        { label: "Work order", cls: "mono", render: function (r) { return Engine.esc(r.woRef || r.woId || "-"); } },
        { label: "Checkpoints", cls: "num", render: function (r) { return String((r.checks || []).length); } },
        { label: "Inspector", render: function (r) { return Engine.esc(r.inspector || "-"); } },
        { label: "Recorded", cls: "mono", render: function (r) { return Engine.esc(r.recordedAt || "-"); } },
        { label: "Result", render: function (r) { return resPill(r.result); } },
        { label: "", render: function (r) { return UI.el("div", { class: "btn-row" }, [
          UI.btn("View", function () { viewIpc(r); }, "btn-sm"),
          UI.btn("Print", function () { printIpc(r.ipcNo); }, "btn-sm")
        ]); } }
      ], rows, { emptyText: "No IPC record yet." }));
    }
    search.addEventListener("input", function () { ipcFilter.q = search.value; draw(); });
    fType.addEventListener("change", function () { ipcFilter.type = fType.value; draw(); });

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "In-process control (FR-QA-25 / FR-QC-05)" }),
      canQA ? UI.btn("New IPC record", ipcEditor, "btn-primary btn-sm") : UI.el("span", { class: "hint", text: "Read-only for your role" })]));
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, fType, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.ipcRecords.length + " records" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    draw();
    return card;
  }
  function ipcEditor() {
    if (!RBAC.canInspect()) { UI.toast("Only QA/QC may record an IPC", "err"); return; }
    var db = Store.get();
    var iWo = UI.combo(woOptions(db), "", "Type to search work order...");
    var iType = UI.select([["FR-QA-25", "FR-QA-25 (weight uniformity)"], ["FR-QC-05", "FR-QC-05 (seal integrity)"], ["PROCESS", "Process profile (Hz / temp)"]], "FR-QA-25");
    var iNote = UI.input({ value: "", placeholder: "Note" });
    var iParam = UI.select(IPC_PARAMS, "fill");
    var iVal = UI.input({ type: "number", step: "0.01", value: "", style: "width:120px", placeholder: "value" });
    var checks = [];
    var checksWrap = UI.el("div");
    function fgOf() { var f = findWo(db, iWo.value); return f && f.wo.fgId ? f.wo.fgId : ""; }
    function addCheckpoint() {
      var param = iParam.value, v = iVal.value;
      if (v === "") { UI.toast("Enter a measured value", "err"); return; }
      var lim = Store.ipcLimit(fgOf(), param);
      checks.push({
        param: param, value: Number(v), unit: lim ? lim.unit : (param === "seal" ? "pcs" : ""),
        min: lim && lim.min != null ? lim.min : "", max: lim && lim.max != null ? lim.max : ""
      });
      iVal.value = ""; drawChecks();
    }
    function drawChecks() {
      UI.clear(checksWrap);
      if (!checks.length) { checksWrap.appendChild(UI.el("div", { class: "hint", style: "color:var(--muted)", text: "No checkpoint added yet. Limits for fill / pH load from the packaging / formula master." })); return; }
      checksWrap.appendChild(UI.table([
        { label: "Parameter", cls: "mono", key: "param" },
        { label: "Value", cls: "num", render: function (c) { return Engine.fmtNum(c.value); } },
        { label: "Unit", render: function (c) { return Engine.esc(c.unit || ""); } },
        { label: "Min", cls: "num", render: function (c) { return c.min === "" ? "-" : Engine.fmtNum(c.min); } },
        { label: "Max", cls: "num", render: function (c) { return c.max === "" ? "-" : Engine.fmtNum(c.max); } },
        { label: "Result", render: function (c) { return resPill(localPass(c) ? "Pass" : "Fail"); } },
        { label: "", render: function (c) { return UI.btn("Remove", function () { checks = checks.filter(function (x) { return x !== c; }); drawChecks(); }, "btn-sm btn-danger"); } }
      ], checks, { emptyText: "" }));
    }
    UI.modal({
      title: "New IPC record", wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "form-grid" }, [
          UI.field("Work order", iWo), UI.field("IPC type", iType)
        ]),
        UI.el("div", { class: "toolbar", style: "margin:6px 0" }, [iParam, iVal, UI.btn("Add checkpoint", addCheckpoint, "")]),
        checksWrap, UI.field("Note", iNote)
      ]),
      actions: [{
        label: "Save IPC record", cls: "btn-primary", onClick: function () {
          if (!iWo.value) { UI.toast("Select a work order", "err"); return; }
          if (!checks.length) { UI.toast("Add at least one checkpoint", "err"); return; }
          var f = findWo(db, iWo.value);
          var res = Store.createIpcRecord({
            ipcType: iType.value, woId: iWo.value, woRef: woRefOf(f),
            campaignNo: f && f.wo.campaignNo ? f.wo.campaignNo : "", fgId: fgOf(),
            checks: checks, note: iNote.value.trim()
          });
          UI.closeModal(); App.refresh();
          UI.toast("IPC " + res.ipcNo + " saved - " + res.result, res.result === "Pass" ? "ok" : "err");
        }
      }]
    });
    drawChecks();
  }
  function viewIpc(r) {
    UI.modal({
      title: "IPC " + r.ipcNo, wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "kv", style: "margin-bottom:10px" }, [
          UI.el("dt", { text: "Type" }), UI.el("dd", {}, [UI.tag(r.ipcType)]),
          UI.el("dt", { text: "Work order" }), UI.el("dd", { class: "mono", text: r.woRef || r.woId || "-" }),
          UI.el("dt", { text: "Campaign" }), UI.el("dd", { class: "mono", text: r.campaignNo || "-" }),
          UI.el("dt", { text: "Result" }), UI.el("dd", {}, [resPill(r.result)]),
          UI.el("dt", { text: "Inspector" }), UI.el("dd", { text: r.inspector || "-" }),
          UI.el("dt", { text: "Recorded" }), UI.el("dd", { class: "mono", text: r.recordedAt || "-" }),
          UI.el("dt", { text: "Note" }), UI.el("dd", { text: r.note || "-" })
        ]),
        UI.table([
          { label: "Parameter", cls: "mono", key: "param" },
          { label: "Value", cls: "num", render: function (c) { return Engine.fmtNum(c.value); } },
          { label: "Unit", render: function (c) { return Engine.esc(c.unit || ""); } },
          { label: "Min", cls: "num", render: function (c) { return c.min === "" ? "-" : Engine.fmtNum(c.min); } },
          { label: "Max", cls: "num", render: function (c) { return c.max === "" ? "-" : Engine.fmtNum(c.max); } },
          { label: "Result", render: function (c) { return resPill(c.pass === false ? "Fail" : "Pass"); } }
        ], r.checks || [], { emptyText: "No checkpoint." })
      ]),
      actions: [{ label: "Print", onClick: function () { UI.closeModal(); printIpc(r.ipcNo); } }]
    });
  }

  /* ---------- 3. release / disposition (FR-QC-06) ---------- */
  function releaseCard(db) {
    var canQA = RBAC.canRelease();
    var search = UI.input({ placeholder: "Search release no / batch / campaign...", value: relFilter.q });
    var fDisp = UI.select([["", "All dispositions"], ["Pending", "Pending"], ["Approved", "Approved"], ["Rejected", "Rejected"], ["Hold", "Hold"]], relFilter.disposition);
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = relFilter.q.toLowerCase();
      var rows = db.releases.filter(function (r) {
        if (relFilter.disposition && r.disposition !== relFilter.disposition) return false;
        if (!q) return true;
        return ((r.releaseNo || "") + " " + (r.batchLot || "") + " " + (r.campaignNo || "")).toLowerCase().indexOf(q) >= 0;
      });
      bodyWrap.appendChild(UI.table([
        { label: "Release No", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.releaseNo) + "</b>"; } },
        { label: "Finish Good", cls: "mono", render: function (r) { var f = Store.fgById(r.fgId); return Engine.esc(f ? f.kodeFG : (r.fgId || "-")); } },
        { label: "Batch / lot", cls: "mono", render: function (r) { return Engine.esc(r.batchLot || "-"); } },
        { label: "Campaign", cls: "mono", render: function (r) { return Engine.esc(r.campaignNo || "-"); } },
        { label: "Signer", render: function (r) { return Engine.esc(r.signer || "-"); } },
        { label: "Disposition", render: function (r) { return dispPill(r.disposition); } },
        { label: "", render: function (r) { return relActions(r, canQA); } }
      ], rows, { emptyText: "No release yet. Raise one from a finished (Done) pack work order." }));
    }
    function relActions(r, canQA) {
      var btns = [UI.btn("View", function () { viewRelease(r); }, "btn-sm")];
      if (canQA) RBAC.transitionsFrom("release", r.disposition).forEach(function (t) {
        btns.push(UI.btn(t.to, function () { dispose(r, t.to); },
          "btn-sm " + (t.to === "Approved" ? "btn-primary" : t.to === "Rejected" ? "btn-danger" : "")));
      });
      btns.push(UI.btn("Print", function () { printRelease(r.releaseNo); }, "btn-sm"));
      return UI.el("div", { class: "btn-row" }, btns);
    }
    function dispose(r, to) {
      UI.confirmDialog("Set release " + r.releaseNo + " (batch " + (r.batchLot || "-") + ") to " + to + "?" +
        (to === "Approved" ? " Approved batches may proceed to FG receipt." : ""), function () {
        if (Store.setReleaseDisposition(r.id, to)) { App.refresh(); UI.toast("Release " + to, "ok"); }
        else UI.toast("Disposition not allowed for your role", "err");
      }, to + " release");
    }
    search.addEventListener("input", function () { relFilter.q = search.value; draw(); });
    fDisp.addEventListener("change", function () { relFilter.disposition = fDisp.value; draw(); });

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "Release / disposition (FR-QC-06)" }),
      canQA ? UI.btn("New release", releaseEditor, "btn-primary btn-sm") : UI.el("span", { class: "hint", text: "Read-only for your role" })]));
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, fDisp, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.releases.length + " records" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    draw();
    return card;
  }
  function releaseEditor() {
    if (!RBAC.canRelease()) { UI.toast("Only QA may raise a release", "err"); return; }
    var db = Store.get();
    var done = db.workOrdersPack.filter(function (w) { return w.status === "Done"; });
    var iPack = UI.combo([["", "(select a finished pack WO)"]].concat(done.map(function (w) {
      var f = Store.fgById(w.fgId);
      return [w.id, (w.woNo || w.campaignNo) + " \u00b7 " + (f ? f.kodeFG : "-") + " \u00b7 yield " + Engine.fmtNum(w.actualYield, 0) + " " + w.outputUnit + " \u00b7 rendemen " + Engine.fmtNum(w.rendemenPct, 2) + "%"];
    })), "", "Type to search pack work order...");
    var iBatch = UI.input({ value: "", placeholder: "FG batch / lot no" });
    var iQa = UI.input({ value: "", placeholder: "QA archive copy ref" });
    var iQc = UI.input({ value: "", placeholder: "QC archive copy ref" });
    var iNote = UI.input({ value: "", placeholder: "Note" });
    UI.modal({
      title: "New release (FR-QC-06)", wide: true,
      body: UI.el("div", {}, [
        UI.field("Finished pack work order", iPack, done.length ? "" : "No pack work order is Done yet - finish packing first."),
        UI.el("div", { class: "form-grid" }, [
          UI.field("FG batch / lot", iBatch), UI.field("QA copy ref", iQa),
          UI.field("QC copy ref", iQc)
        ]),
        UI.field("Note", iNote)
      ]),
      actions: [{
        label: "Create release (Pending)", cls: "btn-primary", onClick: function () {
          if (!iPack.value) { UI.toast("Select a finished pack work order", "err"); return; }
          var w = Store.packWoById(iPack.value);
          var res = Store.createRelease({
            woPackId: w.id, fgId: w.fgId, campaignNo: w.campaignNo, batchLot: iBatch.value.trim(),
            qaCopy: iQa.value.trim(), qcCopy: iQc.value.trim(), note: iNote.value.trim()
          });
          UI.closeModal(); App.refresh(); UI.toast("Release " + res.releaseNo + " created (Pending)", "ok");
        }
      }]
    });
  }
  function viewRelease(r) {
    var w = r.woPackId ? Store.packWoById(r.woPackId) : null;
    UI.modal({
      title: "Release " + r.releaseNo, wide: true,
      body: UI.el("div", { class: "kv" }, [
        UI.el("dt", { text: "Disposition" }), UI.el("dd", {}, [dispPill(r.disposition)]),
        UI.el("dt", { text: "Finish Good" }), UI.el("dd", { class: "mono", text: (Store.fgById(r.fgId) || {}).kodeFG || r.fgId || "-" }),
        UI.el("dt", { text: "Batch / lot" }), UI.el("dd", { class: "mono", text: r.batchLot || "-" }),
        UI.el("dt", { text: "Campaign" }), UI.el("dd", { class: "mono", text: r.campaignNo || "-" }),
        UI.el("dt", { text: "Pack WO" }), UI.el("dd", { class: "mono", text: w ? w.woNo : (r.woPackId || "-") }),
        UI.el("dt", { text: "Rendemen" }), UI.el("dd", { text: w ? Engine.fmtNum(w.rendemenPct, 2) + " %" : "-" }),
        UI.el("dt", { text: "Signer" }), UI.el("dd", { text: r.signer || "-" }),
        UI.el("dt", { text: "Released at" }), UI.el("dd", { class: "mono", text: r.releasedAt || "-" }),
        UI.el("dt", { text: "QA copy" }), UI.el("dd", { text: r.qaCopy || "-" }),
        UI.el("dt", { text: "QC copy" }), UI.el("dd", { text: r.qcCopy || "-" }),
        UI.el("dt", { text: "Note" }), UI.el("dd", { text: r.note || "-" })
      ]),
      actions: [{ label: "Print", onClick: function () { UI.closeModal(); printRelease(r.releaseNo); } }]
    });
  }

  /* ---------------- print views ---------------- */
  function printClearance(no) {
    var c = Store.get().lineClearances.filter(function (x) { return x.clearanceNo === no; })[0];
    if (!c) { UI.toast("No clearance " + no, "err"); return; }
    var rows = (c.checklist || []).map(function (x, i) {
      return "<tr><td class='c'>" + (i + 1) + "</td><td>" + Engine.esc(x.item) + "</td>" +
        "<td class='c'>" + (x.ok ? "&#10003;" : "&mdash;") + "</td><td>" + Engine.esc(x.note || "") + "</td></tr>";
    }).join("");
    var h = "<table class='lines'><tr><th style='width:6%'>No</th><th>Checklist item</th>" +
      "<th style='width:10%'>OK</th><th style='width:30%'>Remark</th></tr>" + rows + "</table>";
    UI.printHTML(UI.docShell("LINE CLEARANCE (" + c.clearanceType + ")", [
      ["Clearance No", c.clearanceNo], ["Work order", c.woRef || c.woId || "-"],
      ["Campaign", c.campaignNo || "-"], ["WO type", c.woType],
      ["Status", c.status], ["QC signer", c.qcSigner || "-"], ["QC time", c.qcTime || "-"]
    ], h, ["Dibuat oleh (Produksi)", "Diperiksa oleh (QA)", "Disetujui oleh (QA Manager)"], c.note ? "Note: " + Engine.esc(c.note) : ""));
  }
  function printIpc(no) {
    var r = Store.get().ipcRecords.filter(function (x) { return x.ipcNo === no; })[0];
    if (!r) { UI.toast("No IPC " + no, "err"); return; }
    var rows = (r.checks || []).map(function (c, i) {
      return "<tr><td class='c'>" + (i + 1) + "</td><td>" + Engine.esc(c.param) + "</td>" +
        "<td class='r'>" + Engine.fmtNum(c.value) + "</td><td class='c'>" + Engine.esc(c.unit || "") + "</td>" +
        "<td class='r'>" + (c.min === "" ? "-" : Engine.fmtNum(c.min)) + "</td><td class='r'>" + (c.max === "" ? "-" : Engine.fmtNum(c.max)) + "</td>" +
        "<td class='c'>" + (c.pass === false ? "FAIL" : "PASS") + "</td></tr>";
    }).join("");
    var h = "<table class='lines'><tr><th style='width:6%'>No</th><th>Parameter</th><th style='width:12%'>Value</th>" +
      "<th style='width:10%'>Unit</th><th style='width:12%'>Min</th><th style='width:12%'>Max</th><th style='width:12%'>Result</th></tr>" + rows + "</table>";
    UI.printHTML(UI.docShell("IN-PROCESS CONTROL (" + r.ipcType + ")", [
      ["IPC No", r.ipcNo], ["Work order", r.woRef || r.woId || "-"],
      ["Campaign", r.campaignNo || "-"], ["Result", r.result],
      ["Inspector", r.inspector || "-"], ["Recorded", r.recordedAt || "-"]
    ], h, ["Diukur oleh (QC)", "Diperiksa oleh (QA)", "Disetujui oleh (QA Manager)"], r.note ? "Note: " + Engine.esc(r.note) : ""));
  }
  function printRelease(no) {
    var r = Store.get().releases.filter(function (x) { return x.releaseNo === no; })[0];
    if (!r) { UI.toast("No release " + no, "err"); return; }
    var w = r.woPackId ? Store.packWoById(r.woPackId) : null;
    var f = Store.fgById(r.fgId);
    var h = "<table class='lines'><tr><th>Finish Good</th><th style='width:18%'>Batch / lot</th>" +
      "<th style='width:14%'>Actual yield</th><th style='width:14%'>Rendemen</th><th style='width:16%'>Disposition</th></tr>" +
      "<tr><td>" + Engine.esc(f ? f.kodeFG + " - " + f.deskripsi : (r.fgId || "-")) + "</td>" +
      "<td class='c'>" + Engine.esc(r.batchLot || "-") + "</td>" +
      "<td class='r'>" + (w ? Engine.fmtNum(w.actualYield, 0) + " " + Engine.esc(w.outputUnit) : "-") + "</td>" +
      "<td class='r'>" + (w ? Engine.fmtNum(w.rendemenPct, 2) + " %" : "-") + "</td>" +
      "<td class='c'><b>" + Engine.esc(r.disposition) + "</b></td></tr></table>";
    UI.printHTML(UI.docShell("RELEASE CERTIFICATE (FR-QC-06)", [
      ["Release No", r.releaseNo], ["Campaign", r.campaignNo || "-"],
      ["Pack WO", w ? w.woNo : (r.woPackId || "-")], ["Signer", r.signer || "-"],
      ["Released at", r.releasedAt || "-"], ["QA copy", r.qaCopy || "-"], ["QC copy", r.qcCopy || "-"]
    ], h, ["Diperiksa oleh (QC)", "Disetujui oleh (QA)", "Diketahui oleh (Regulatory)"],
      (r.note ? "Note: " + Engine.esc(r.note) + " " : "") + "Only an APPROVED release may proceed to finished-goods receipt."));
  }
  return { list: list, printClearance: printClearance, printIpc: printIpc, printRelease: printRelease };
})();
