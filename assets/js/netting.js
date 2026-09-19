/* ============================================================
   NETTING - pure, deterministic PPIC netting engine (D2).
   Side-effect free: every function takes plain data and returns
   plain data, so it is unit-testable under node with golden
   vectors and consumable by the PPIC page. No Store / UI / DOM
   access here on purpose.

   Maths (from the plan):
     grossBulkKg = orderQty x netto x BJ x (1 + lossFactor)
     formula line kg = grossBulkKg x pct/100 x (1 + lineLoss/100)
     packaging line  = qtyPerUnit x orderQty x (1 + scrap/100)
     available       = customer-supplied ? 0 : max(0, SOH - allocated)
     net             = max(0, gross - available)
     Astoria shortfall -> PR line, qty rounded UP to supplier MOQ
     Customer shortfall -> call-off, required-by = delivery - lead time
     mixer sizing      -> fewest batches over the active catalogue,
                          emitting one parent campaign work order
   ============================================================ */
window.Netting = (function () {

  function num(n) { var x = Number(n); return isFinite(x) ? x : 0; }
  function round4(n) { return Math.round(num(n) * 10000) / 10000; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* ---------- date helpers (UTC-noon anchored, TZ-safe & pure) ---------- */
  function parseISO(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s == null ? "" : s).trim());
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
  }
  function fmtISO(d) {
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  /* add n days (n may be negative) to an ISO date; "" in -> "" out */
  function addDays(iso, n) {
    var d = parseISO(iso);
    if (!d) return "";
    d.setUTCDate(d.getUTCDate() + (num(n) | 0));
    return fmtISO(d);
  }

  /* ---------- MOQ rounding ---------- */
  /* Round a net requirement UP to a whole multiple of the supplier MOQ.
     moq <= 0 means "no pack constraint" -> return the net as-is. An epsilon
     keeps exact multiples (e.g. 50 / 25) from rounding up an extra step. */
  function roundUpToMoq(net, moq) {
    net = num(net); moq = num(moq);
    if (net <= 0) return 0;
    if (moq <= 0) return round4(net);
    return round4(Math.ceil(net / moq - 1e-9) * moq);
  }

  function isCustomer(supportedBy) {
    return String(supportedBy || "").trim().toLowerCase() === "customer";
  }

  /* ---------- bulk requirement ---------- */
  function grossBulkKg(orderQty, nettoPerUnit, bj, lossFactor) {
    var b = num(bj); if (b <= 0) b = 1;             /* BJ is a density multiplier; 0/absent -> neutral */
    return round4(num(orderQty) * num(nettoPerUnit) * b * (1 + num(lossFactor)));
  }

  /* ---------- formula explosion (100% ratio basis, scaled to bulk kg) ---------- */
  function explodeFormula(grossKg, lines) {
    return (lines || []).map(function (l) {
      var pct = num(l.pct);
      var base = num(grossKg) * pct / 100;
      var gross = round4(base * (1 + num(l.lossPct) / 100));
      var customer = isCustomer(l.supportedBy);
      var soh = num(l.soh), allocated = num(l.allocated);
      var available = customer ? 0 : Math.max(0, soh - allocated);
      return {
        section: "FORMULA", materialCode: l.materialCode, name: l.name || "", unit: l.unit || "kg",
        pct: pct, gross: gross, soh: soh, allocated: allocated, available: round4(available),
        net: round4(Math.max(0, gross - available)),
        supportedBy: l.supportedBy || "Astoria", customer: customer,
        moq: num(l.moq), leadDays: num(l.leadDays)
      };
    });
  }

  /* ---------- packaging explosion (per unit x qty x (1 + scrap)) ---------- */
  function explodePackaging(orderQty, lines) {
    return (lines || []).map(function (l) {
      var perUnit = num(l.qtyPerUnit);
      var scrap = num(l.scrapPct != null ? l.scrapPct : l.lossPct);
      var gross = round4(perUnit * num(orderQty) * (1 + scrap / 100));
      var customer = isCustomer(l.supportedBy);
      var soh = num(l.soh), allocated = num(l.allocated);
      var available = customer ? 0 : Math.max(0, soh - allocated);
      return {
        section: "KEMAS", materialCode: l.materialCode, name: l.name || "", unit: l.unit || "pcs",
        qtyPerUnit: perUnit, scrapPct: scrap, gross: gross, soh: soh, allocated: allocated,
        available: round4(available), net: round4(Math.max(0, gross - available)),
        supportedBy: l.supportedBy || "Astoria", customer: customer,
        moq: num(l.moq), leadDays: num(l.leadDays)
      };
    });
  }

  /* ---------- shortfall routing: PR (Astoria) vs call-off (Customer) ---------- */
  function routeShortfall(lines, deliveryDate) {
    var pr = [], calloff = [];
    (lines || []).forEach(function (l) {
      if (num(l.net) <= 0) return;
      var requiredBy = addDays(deliveryDate, -num(l.leadDays));
      if (l.customer) {
        calloff.push({
          materialCode: l.materialCode, name: l.name, unit: l.unit,
          qty: round4(l.net), requiredBy: requiredBy
        });
      } else {
        pr.push({
          materialCode: l.materialCode, name: l.name, unit: l.unit,
          net: round4(l.net), moq: num(l.moq),
          orderQty: roundUpToMoq(l.net, l.moq), requiredBy: requiredBy
        });
      }
    });
    return { prLines: pr, calloffLines: calloff };
  }

  /* ---------- mixer sizing: fewest batches, right-sized last batch ---------- */
  function sizeMixers(totalKg, mixers) {
    totalKg = round4(totalKg);
    var active = (mixers || []).filter(function (m) { return m && m.active !== false && num(m.capacityKg) > 0; });
    if (!active.length || totalKg <= 0) return { totalKg: totalKg, batches: [], batchCount: 0 };
    var byCapDesc = active.slice().sort(function (a, b) { return num(b.capacityKg) - num(a.capacityKg); });
    var byCapAsc = active.slice().sort(function (a, b) { return num(a.capacityKg) - num(b.capacityKg); });
    var largest = byCapDesc[0], cap = num(largest.capacityKg);
    var full = Math.floor(totalKg / cap + 1e-9);
    var remainder = round4(totalKg - full * cap);
    function batch(m, kg) {
      return { mixerId: m.id, mixerName: m.name || m.vessel || m.id, vessel: m.vessel || "", capacityKg: num(m.capacityKg), plannedKg: round4(kg) };
    }
    var batches = [];
    for (var i = 0; i < full; i++) batches.push(batch(largest, cap));
    if (remainder > 0) {
      /* smallest vessel that still holds the remainder, else the largest */
      var fit = null;
      for (var j = 0; j < byCapAsc.length; j++) { if (num(byCapAsc[j].capacityKg) >= remainder - 1e-9) { fit = byCapAsc[j]; break; } }
      batches.push(batch(fit || largest, remainder));
    }
    return { totalKg: totalKg, batches: batches, batchCount: batches.length };
  }

  /* ---------- top-level plan ----------
     input = {
       orderQty, nettoPerUnit, bj, lossFactor, deliveryDate,
       formulaLines:[{materialCode,name,unit,pct,lossPct,supportedBy,soh,allocated,moq,leadDays}],
       packagingLines:[{materialCode,name,unit,qtyPerUnit,scrapPct|lossPct,supportedBy,soh,allocated,moq,leadDays}],
       mixers:[{id,name,vessel,capacityKg,active}]
     } */
  function plan(inp) {
    inp = inp || {};
    var bulk = grossBulkKg(inp.orderQty, inp.nettoPerUnit, inp.bj, inp.lossFactor);
    var formula = explodeFormula(bulk, inp.formulaLines);
    var packaging = explodePackaging(inp.orderQty, inp.packagingLines);
    var routed = routeShortfall(formula.concat(packaging), inp.deliveryDate);
    var campaign = sizeMixers(bulk, inp.mixers);
    return {
      grossBulkKg: bulk,
      formula: formula,
      packaging: packaging,
      prLines: routed.prLines,
      calloffLines: routed.calloffLines,
      campaign: campaign
    };
  }

  var api = {
    num: num, round4: round4, parseISO: parseISO, fmtISO: fmtISO, addDays: addDays,
    roundUpToMoq: roundUpToMoq, isCustomer: isCustomer,
    grossBulkKg: grossBulkKg, explodeFormula: explodeFormula, explodePackaging: explodePackaging,
    routeShortfall: routeShortfall, sizeMixers: sizeMixers, plan: plan
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
