/* ============================================================
   VIEWS - Master Formula parts: Product Specification, Test
   Result, Machine Setup. Each is keyed by Formula Code (the doc
   "Kode", never the FFS document number) and edited as a tab
   inside the Master Formula wide modal, with its own inline PDF
   import. Records stay Draft until the approval chain lands;
   edit rights follow Master Formula (RND Formula).

   The parts are the single editing source for QC data. On save
   they write a cache back to the core formula (pH range,
   viscosity, stability lamps) so the Master Formula list, BOM,
   QA and netting keep reading those fields without change. BJ
   stays core-editable (netting) and is NOT written back here.
   ============================================================ */
window.ViewsFormulaSub = (function () {

  var KINDS = {
    lab: { title: "Product Specification", store: "formulaLab", cfg: "lab", map: "mapToLabDraft",
      save: "saveFormulaLab", del: "deleteFormulaLab", byId: "formulaLabById", entity: "Formula Product Specification" },
    stab: { title: "Test Result", store: "formulaStab", cfg: "stab", map: "mapToStabDraft",
      save: "saveFormulaStab", del: "deleteFormulaStab", byId: "formulaStabById", entity: "Formula Test Result" },
    machine: { title: "Machine Setup", store: "formulaMachine", cfg: "machine", map: "mapToMachineDraft",
      save: "saveFormulaMachine", del: "deleteFormulaMachine", byId: "formulaMachineById", entity: "Formula Machine Setup" }
  };
  var STAB_OPTS = [["-", "-"], ["Running", "Running"], ["Pass", "Pass"], ["Fail", "Fail"]];
  var CONDS = ["TK", "TKUL", "T50", "TM"];
  /* Machine parameter channels (FFS tab 6). Units are fixed per channel;
     the set value is free text so ranges ("75–80") survive the import. */
  var CHANNELS = [
    ["suhu", "Temperature", "\u00b0C"],
    ["homogenizer", "Homogenizer speed", "rpm"],
    ["disperser", "Disperser speed", "rpm"],
    ["mixer", "Mixer speed", "Hz"],
    ["scraper", "Scraper speed", "Hz"],
    ["time", "Duration", "min"]
  ];
  var TIME_TYPES = ["Stirring", "Mixing", "Cooling"];
  var TT_LEGACY = { "Pengadukan": "Stirring", "Pendinginan": "Cooling" };

  function formulaOf(id) { return Store.formulaById(id); }
  function mixerOf(id) { return (Store.get().mixers || []).filter(function (m) { return m.id === id; })[0]; }
  function stamp(d) {
    d.updated = Engine.todayISO();
    d.by = (Store.get().meta.user || {}).name || "User";
    return d;
  }
  /* Pull the first one or two numbers out of a spec band ("5.0 – 7.0",
     "5-6", "5,0-6,0"). Feeds the pH cache only, so values are unsigned -
     a hyphen is a range separator, never a minus - and a comma is a decimal
     point, never a thousands grouping. */
  function parseRange(s) {
    var m = String(s == null ? "" : s).replace(/,/g, ".").match(/\d+(\.\d+)?/g);
    if (!m) return null;
    return [Number(m[0]), m.length > 1 ? Number(m[1]) : Number(m[0])];
  }

  /* latest observation per condition = the roll-up lamp */
  function stabRollup(rec) {
    var out = { TK: "-", TKUL: "-", T50: "-", TM: "-" }, best = {};
    (rec.obs || []).forEach(function (o) {
      if (CONDS.indexOf(o.cond) < 0) return;
      var b = best[o.cond];
      if (!b || (o.week || 0) >= (b.week || 0)) best[o.cond] = o;
    });
    CONDS.forEach(function (c) { if (best[c]) out[c] = best[c].status || "-"; });
    return out;
  }

  /* Write-back QC cache: keep the core formula's pH / viscosity / stability
     lamps in step with the submodule that now owns them. Downstream readers
     (master list, BOM, QA, netting) still read the core fields. */
  function syncCoreCache(kind, d) {
    var f = formulaOf(d.id);
    if (!f) return;
    var changed = false;
    if (kind === "lab") {
      (d.specs || []).forEach(function (s) {
        var p = String(s.parameter || "").toLowerCase();
        if (/\bph\b/.test(p)) {
          var r = parseRange(s.std);
          if (r) { f.phMin = r[0]; f.phMax = r[1]; changed = true; }
        } else if (/viskos|viscos/.test(p)) {
          f.viscosity = s.std || ""; changed = true;
        }
      });
    } else if (kind === "stab") {
      var ru = stabRollup(d);
      f.stabTk = ru.TK; f.stabTkul = ru.TKUL; f.stabT50 = ru.T50; f.stabTm = ru.TM;
      changed = true;
    }
    if (changed) Store.saveFormula(f, false, f.id);
  }

  function newParamSet() {
    return { mixerId: "", batchLabel: "", suhu: "", homogenizer: "", disperser: "", mixer: "", scraper: "", time: "", timeType: "Stirring" };
  }
  function newStep() {
    return { materials: [], instruction: "", vessel: "", ccp: false, ccpNote: "", outputLabel: "", params: [newParamSet()] };
  }
  function defaults(kind) {
    if (kind === "lab") return { id: "", specs: [], expiry: "", sprRef: "", storageTemp: "", note: "", status: "Draft" };
    if (kind === "stab") return { id: "", startDate: "", protocol: "", weeksTotal: 12, weeksObserved: 0, obs: [], panelRef: "", microRef: "", compatRef: "", stabRef: "", note: "", status: "Draft" };
    return { id: "", mixerId: "", mixerName: "", vessel: "", equipment: [], phases: [], vacuum: "", note: "", status: "Draft" };
  }

  /* ---------------- Product Specification (FFS tab 7) ---------------- */
  function buildSpec(body, d) {
    if (!d.specs) d.specs = [];
    var iExpiry = UI.input({ value: d.expiry || "", placeholder: "e.g. 24 months" });
    var iSpr = UI.input({ value: d.sprRef || "", placeholder: "SPR / certificate reference" });
    var iStore = UI.input({ value: d.storageTemp || "", placeholder: "e.g. 15–25 °C, avoid direct sunlight" });
    body.appendChild(UI.el("div", { class: "form-grid" }, [
      UI.field("Expiry / shelf life", iExpiry),
      UI.field("SPR / lab reference", iSpr),
      UI.field("Storage condition", iStore)
    ]));

    var specWrap = UI.el("div");
    function drawSpecs() {
      UI.clear(specWrap);
      var tbl = UI.el("table", { class: "editor", style: "width:100%;font-size:12.5px" });
      tbl.appendChild(UI.el("thead", {}, [UI.el("tr", {}, [
        UI.el("th", { text: "Parameter", style: "width:30%" }),
        UI.el("th", { text: "Standard / spec", style: "width:34%" }),
        UI.el("th", { text: "Method / instrument" }),
        UI.el("th", { style: "width:36px" })
      ])]));
      var tb = UI.el("tbody");
      d.specs.forEach(function (s, idx) {
        var iP = UI.input({ value: s.parameter || "", placeholder: "e.g. pH, Viscosity, Appearance", style: "width:100%" });
        iP.addEventListener("input", function () { s.parameter = iP.value; });
        var iS = UI.input({ value: s.std || "", placeholder: "e.g. 5.0 – 7.0", style: "width:100%" });
        iS.addEventListener("input", function () { s.std = iS.value; });
        var iM = UI.input({ value: s.method || "", placeholder: "e.g. pH meter @ 25 °C", style: "width:100%" });
        iM.addEventListener("input", function () { s.method = iM.value; });
        tb.appendChild(UI.el("tr", {}, [
          UI.el("td", {}, [iP]), UI.el("td", {}, [iS]), UI.el("td", {}, [iM]),
          UI.el("td", {}, [UI.btn("×", function () { d.specs.splice(idx, 1); drawSpecs(); }, "btn-danger btn-sm")])
        ]));
      });
      if (!d.specs.length) tb.appendChild(UI.el("tr", {}, [UI.el("td", { colspan: "4", class: "empty", text: "No specification parameters yet." })]));
      tbl.appendChild(tb);
      specWrap.appendChild(tbl);
      specWrap.appendChild(UI.el("div", { style: "margin-top:6px" }, [
        UI.btn("+ Add parameter", function () { d.specs.push({ parameter: "", std: "", method: "" }); drawSpecs(); }, "btn-sm")
      ]));
    }
    drawSpecs();
    body.appendChild(UI.el("fieldset", {}, [UI.el("legend", { text: "Specification parameters" }), specWrap]));
    body.appendChild(UI.el("p", { class: "hint", style: "margin:6px 0 0",
      text: "pH and viscosity specs here feed the Master Formula list, BOM and QA automatically." }));

    return function () {
      d.expiry = iExpiry.value.trim();
      d.sprRef = iSpr.value.trim();
      d.storageTemp = iStore.value.trim();
    };
  }

  /* ---------------- Test Result (FFS tab 2) ---------------- */
  function buildTest(body, d) {
    var iPanel = UI.input({ value: d.panelRef || "", placeholder: "Panel / sensory report ref" });
    var iStab = UI.input({ value: d.stabRef || "", placeholder: "Stability report ref" });
    var iMicro = UI.input({ value: d.microRef || "", placeholder: "Microbiology report ref" });
    var iCompat = UI.input({ value: d.compatRef || "", placeholder: "Compatibility report ref" });
    var iStart = UI.input({ type: "date", value: d.startDate || "" });
    var iProto = UI.input({ value: d.protocol || "", placeholder: "e.g. 12 weeks, 4 conditions" });
    var iWt = UI.input({ type: "number", step: "1", min: "0", value: String(d.weeksTotal || 0) });
    var iWo = UI.input({ type: "number", step: "1", min: "0", value: String(d.weeksObserved || 0) });
    body.appendChild(UI.el("div", { class: "form-grid" }, [
      UI.field("Panel / sensory ref", iPanel),
      UI.field("Stability ref", iStab),
      UI.field("Microbiology ref", iMicro),
      UI.field("Compatibility ref", iCompat),
      UI.field("Start date", iStart), UI.field("Protocol", iProto),
      UI.field("Weeks total", iWt), UI.field("Weeks observed", iWo)
    ]));
    if (!d.obs) d.obs = [];
    var obsWrap = UI.el("div");
    function drawObs() {
      UI.clear(obsWrap);
      var tbl = UI.el("table", { class: "editor", style: "width:100%;font-size:12.5px" });
      tbl.appendChild(UI.el("thead", {}, [UI.el("tr", {}, [
        UI.el("th", { text: "Condition", style: "width:90px" }), UI.el("th", { text: "Status", style: "width:110px" }),
        UI.el("th", { text: "Week", style: "width:70px" }), UI.el("th", { text: "Observation" }), UI.el("th", { style: "width:36px" })
      ])]));
      var tb = UI.el("tbody");
      d.obs.forEach(function (o, idx) {
        var selC = UI.select(CONDS.map(function (c) { return [c, c]; }), o.cond || "TK");
        selC.addEventListener("change", function () { o.cond = selC.value; });
        var selS = UI.select(STAB_OPTS, o.status || "-");
        selS.addEventListener("change", function () { o.status = selS.value; });
        var iW = UI.input({ type: "number", step: "1", min: "0", value: String(o.week || 0), style: "width:60px" });
        iW.addEventListener("input", function () { o.week = Number(iW.value) || 0; });
        var iN = UI.input({ value: o.note || "", style: "width:100%" });
        iN.addEventListener("input", function () { o.note = iN.value; });
        tb.appendChild(UI.el("tr", {}, [
          UI.el("td", {}, [selC]), UI.el("td", {}, [selS]), UI.el("td", {}, [iW]), UI.el("td", {}, [iN]),
          UI.el("td", {}, [UI.btn("×", function () { d.obs.splice(idx, 1); drawObs(); }, "btn-danger btn-sm")])
        ]));
      });
      if (!d.obs.length) tb.appendChild(UI.el("tr", {}, [UI.el("td", { colspan: "5", class: "empty", text: "No observations yet." })]));
      tbl.appendChild(tb);
      obsWrap.appendChild(tbl);
      obsWrap.appendChild(UI.el("div", { style: "margin-top:6px" }, [
        UI.btn("+ Add observation", function () { d.obs.push({ cond: "TK", status: "-", week: d.weeksObserved || 0, note: "" }); drawObs(); }, "btn-sm")
      ]));
    }
    drawObs();
    body.appendChild(UI.el("fieldset", {}, [UI.el("legend", { text: "Stability observations per cycle" }), obsWrap]));
    body.appendChild(UI.el("p", { class: "hint", style: "margin:6px 0 0",
      text: "The latest observation per condition (TK / TKUL / T50 / TM) feeds the Master Formula stability lamps." }));
    return function () {
      d.panelRef = iPanel.value.trim(); d.stabRef = iStab.value.trim();
      d.microRef = iMicro.value.trim(); d.compatRef = iCompat.value.trim();
      d.startDate = iStart.value; d.protocol = iProto.value.trim();
      d.weeksTotal = Number(iWt.value) || 0; d.weeksObserved = Number(iWo.value) || 0;
    };
  }

  /* ---------------- Machine Setup (FFS tab 4 + tab 6 → BMR) ----------------
     Nested Tahap (phase) → step → machine param-set. One formula can run on
     several machines / batch sizes, so each param-set is keyed by a mixer
     dropdown. The work instruction here is the protap the BMR re-prints. */
  function buildMachine(body, d) {
    var mixers = Store.get().mixers || [];
    var mixOpts = [["", "(select machine)"]].concat(mixers.map(function (m) {
      return [m.id, m.id + " — " + (m.name || "") + (m.capacityKg ? " (" + Engine.fmtNum(m.capacityKg) + " kg)" : "")];
    }));

    var iVac = UI.input({ value: d.vacuum || "", placeholder: "e.g. -0.6 bar during homogenizing" });
    body.appendChild(UI.el("div", { class: "form-grid" }, [UI.field("Vacuum", iVac)]));

    /* Equipment list (FFS tab 4) */
    if (!d.equipment) d.equipment = [];
    var eqWrap = UI.el("div");
    function drawEq() {
      UI.clear(eqWrap);
      d.equipment.forEach(function (eq, idx) {
        var row = UI.el("div", { class: "btn-row", style: "margin:0 0 4px;align-items:center" });
        var iE = UI.input({ value: eq || "", placeholder: "e.g. Homogenizer, Heater, Vacuum pump", style: "flex:1" });
        iE.addEventListener("input", function () { d.equipment[idx] = iE.value; });
        row.appendChild(iE);
        row.appendChild(UI.btn("×", function () { d.equipment.splice(idx, 1); drawEq(); }, "btn-danger btn-sm"));
        eqWrap.appendChild(row);
      });
      if (!d.equipment.length) eqWrap.appendChild(UI.el("p", { class: "hint", style: "margin:0 0 4px", text: "No equipment listed yet." }));
      eqWrap.appendChild(UI.el("div", {}, [UI.btn("+ Add equipment", function () { d.equipment.push(""); drawEq(); }, "btn-sm")]));
    }
    drawEq();
    body.appendChild(UI.el("fieldset", {}, [UI.el("legend", { text: "Equipment used (FFS tab 4)" }), eqWrap]));

    /* Nested phases → steps → param-sets */
    if (!d.phases) d.phases = [];
    var phWrap = UI.el("div");
    function drawPhases() {
      UI.clear(phWrap);
      d.phases.forEach(function (p, pi) {
        if (!p.steps) p.steps = [];
        var phaseBox = UI.el("div", { class: "sub-phase" });
        var head = UI.el("div", { class: "sub-ph-head" });
        var iName = UI.input({ value: p.name || "", placeholder: "Phase name, e.g. Phase I — Oil Phase", style: "flex:1;font-weight:600" });
        iName.addEventListener("input", function () { p.name = iName.value; });
        head.appendChild(iName);
        head.appendChild(UI.btn("× phase", function () { d.phases.splice(pi, 1); drawPhases(); }, "btn-danger btn-sm"));
        phaseBox.appendChild(head);

        p.steps.forEach(function (st, si) {
          if (!st.params || !st.params.length) st.params = [newParamSet()];
          if (!st.materials) st.materials = [];
          var stepBox = UI.el("div", { class: "sub-step" });
          stepBox.appendChild(UI.el("div", { class: "sub-sec", style: "margin:0 0 6px", text: "Step " + (pi + 1) + "." + (si + 1) }));

          var iMat = UI.input({ value: (st.materials || []).join(", "), placeholder: "Materials (comma-separated codes / names)", style: "width:100%" });
          iMat.addEventListener("input", function () {
            st.materials = iMat.value.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
          });
          var iInstr = UI.el("textarea", { class: "input", rows: "2", style: "width:100%", placeholder: "Work instruction (protap) for this step" });
          iInstr.value = st.instruction || "";
          iInstr.addEventListener("input", function () { st.instruction = iInstr.value; });
          var iVessel = UI.input({ value: st.vessel || "", placeholder: "Vessel, e.g. Main tank / Phase A kettle" });
          iVessel.addEventListener("input", function () { st.vessel = iVessel.value; });
          var iOut = UI.input({ value: st.outputLabel || "", placeholder: "Output label, e.g. Bulk A" });
          iOut.addEventListener("input", function () { st.outputLabel = iOut.value; });
          var iCcpNote = UI.input({ value: st.ccpNote || "", placeholder: "Critical limit / CCP note (if CCP)", style: "width:100%" });
          iCcpNote.addEventListener("input", function () { st.ccpNote = iCcpNote.value; });

          var fMat = UI.field("Materials (codes / names)", iMat); fMat.classList.add("span-2");
          stepBox.appendChild(UI.el("div", { class: "form-grid" }, [
            fMat, UI.field("Vessel", iVessel), UI.field("Output label", iOut)
          ]));
          stepBox.appendChild(UI.field("Work instruction (protap)", iInstr));
          stepBox.appendChild(UI.checkRow("Critical control point (CCP)", st.ccp, function (v) { st.ccp = v; }));
          stepBox.appendChild(UI.field("CCP note / critical limit", iCcpNote));

          /* param-sets: one per machine / batch size */
          var psWrap = UI.el("div");
          function drawParams() {
            UI.clear(psWrap);
            st.params.forEach(function (ps, mi) {
              var psBox = UI.el("div", { class: "sub-param" });
              var psHead = UI.el("div", { class: "sub-ps-head" });
              var iMixSel = UI.select(mixOpts, ps.mixerId || "");
              var iBatch = UI.input({ value: ps.batchLabel || "", placeholder: "Batch size, e.g. 100 kg", style: "max-width:170px" });
              iBatch.addEventListener("input", function () { ps.batchLabel = iBatch.value; });
              var pillV = UI.el("span", { class: "pill" });
              function updVesselPill() {
                var m = mixerOf(ps.mixerId);
                pillV.textContent = m && m.vessel ? m.vessel : "";
                pillV.style.display = pillV.textContent ? "" : "none";
              }
              iMixSel.addEventListener("change", function () { ps.mixerId = iMixSel.value; updVesselPill(); });
              psHead.appendChild(iMixSel);
              psHead.appendChild(iBatch);
              psHead.appendChild(pillV);
              psHead.appendChild(UI.btn("× machine", function () { st.params.splice(mi, 1); drawParams(); }, "btn-danger btn-sm"));
              psBox.appendChild(psHead);
              updVesselPill();

              var tbl = UI.el("table", { class: "editor", style: "width:100%;font-size:12px" });
              tbl.appendChild(UI.el("thead", {}, [UI.el("tr", {}, [
                UI.el("th", { text: "Parameter" }), UI.el("th", { text: "Set value", style: "width:46%" }), UI.el("th", { text: "Unit", style: "width:70px" })
              ])]));
              var tb = UI.el("tbody");
              CHANNELS.forEach(function (ch) {
                var key = ch[0], label = ch[1], unit = ch[2];
                var iV = UI.input({ value: ps[key] || "", placeholder: "e.g. 75–80", style: "width:100%" });
                iV.addEventListener("input", function () { ps[key] = iV.value; });
                tb.appendChild(UI.el("tr", {}, [
                  UI.el("td", { text: label }), UI.el("td", {}, [iV]), UI.el("td", { text: unit, class: "mono" })
                ]));
              });
              ps.timeType = TT_LEGACY[ps.timeType] || ps.timeType || "Stirring";
              var iTt = UI.select(TIME_TYPES.map(function (t) { return [t, t]; }), ps.timeType);
              iTt.addEventListener("change", function () { ps.timeType = iTt.value; });
              tb.appendChild(UI.el("tr", {}, [
                UI.el("td", { text: "Time type" }), UI.el("td", {}, [iTt]), UI.el("td", { text: "—" })
              ]));
              tbl.appendChild(tb);
              psBox.appendChild(tbl);
              psWrap.appendChild(psBox);
            });
            if (!st.params.length) psWrap.appendChild(UI.el("p", { class: "hint", style: "margin:0", text: "No machine parameter set yet." }));
            psWrap.appendChild(UI.el("div", { style: "margin-top:4px" }, [
              UI.btn("+ Add machine", function () { st.params.push(newParamSet()); drawParams(); }, "btn-sm")
            ]));
          }
          drawParams();
          stepBox.appendChild(UI.el("fieldset", {}, [UI.el("legend", { text: "Machine parameters (per batch size)" }), psWrap]));
          stepBox.appendChild(UI.el("div", { style: "margin-top:6px;text-align:right" }, [
            UI.btn("× step", function () { p.steps.splice(si, 1); drawPhases(); }, "btn-danger btn-sm")
          ]));
          phaseBox.appendChild(stepBox);
        });

        phaseBox.appendChild(UI.el("div", { style: "padding:8px 9px" }, [
          UI.btn("+ Add step", function () { p.steps.push(newStep()); drawPhases(); }, "btn-sm")
        ]));
        phWrap.appendChild(phaseBox);
      });
      if (!d.phases.length) phWrap.appendChild(UI.el("p", { class: "hint", style: "margin:0", text: "No work-instruction phases yet." }));
      phWrap.appendChild(UI.el("div", { style: "margin-top:6px" }, [
        UI.btn("+ Add phase", function () { d.phases.push({ name: "", steps: [newStep()] }); drawPhases(); }, "btn-sm")
      ]));
    }
    drawPhases();
    body.appendChild(UI.el("fieldset", {}, [UI.el("legend", { text: "Work instruction phases (FFS tab 6 → BMR)" }), phWrap]));

    return function () { d.vacuum = iVac.value.trim(); };
  }

  /* ---------------- unified wide-modal support ----------------
     panel() builds a submodule body (no Formula Code picker - the code
     is fixed by the selected formula) and returns a collector, so the
     Master Formula wide modal can host it as a tab. parseImport() maps a
     PDF without opening a modal (a nested modal would close the editor). */
  function panel(kind, d, opts) {
    opts = opts || {};
    var body = UI.el("div", { class: "wm-panel" });
    if (opts.importInfo) {
      var banner = [UI.el("div", {}, ["Imported from " + opts.importInfo.fileName + " — check every value before saving."])];
      if (opts.importInfo.warnings && opts.importInfo.warnings.length) {
        banner.push(UI.el("ul", {}, opts.importInfo.warnings.map(function (w) { return UI.el("li", {}, [w]); })));
      }
      body.appendChild(UI.el("div", { class: "import-banner" }, banner));
    }
    var extra = kind === "lab" ? buildSpec(body, d) : kind === "stab" ? buildTest(body, d) : buildMachine(body, d);
    var iNote = UI.el("textarea", { class: "input", rows: "2", style: "width:100%" });
    iNote.value = d.note || "";
    body.appendChild(UI.field("Note", iNote));
    return { body: body, collect: function () { d.note = iNote.value.trim(); extra(); } };
  }
  function parseImport(kind, file, onDone, onErr) {
    var K = KINDS[kind], cfg = Store.ocrConfig(K.cfg);
    OCRImport.parsePdf(file, cfg).then(function (payload) {
      var res = OCRImport[K.map](payload, Store.get());
      onDone(res, (payload.document && payload.document.fileName) || file.name);
    }, function (err) { onErr(err); });
  }
  function hasContent(kind, d) {
    if (!d) return false;
    if (kind === "lab") return (d.specs || []).length > 0 || !!(d.expiry || d.sprRef || d.storageTemp);
    if (kind === "stab") return (d.obs || []).length > 0 || !!(d.panelRef || d.stabRef || d.microRef || d.compatRef || d.startDate || d.protocol);
    return (d.phases || []).length > 0 || (d.equipment || []).length > 0 || !!(d.vacuum || d.mixerId);
  }

  return { KINDS: KINDS, defaults: defaults, panel: panel,
    syncCoreCache: syncCoreCache, parseImport: parseImport, hasContent: hasContent, stamp: stamp };
})();