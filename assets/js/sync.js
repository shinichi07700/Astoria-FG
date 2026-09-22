/* ============================================================
   SYNC - Supabase bridge.
   Supabase is the system of record; the app keeps a fast local
   working copy (localStorage). On boot we hydrate from the
   cloud, every local change is marked dirty and pushed back
   (debounced). Offline changes stay queued and flush when the
   connection returns.

   Tables are described once in the TABLES registry below; hydrate
   and flush are generic over it, so adding an entity is a one-line
   registry entry plus row mappers. Tables introduced by a later
   migration (v > 1) may be absent on the cloud: they are tolerated
   (kept local-only, marks stay queued) until the migration runs.
   ============================================================ */
window.Sync = (function () {
  var PKEY = "astoria_sync_pending";
  var pending = {};          // "table:key" -> { table, key, op: "upsert"|"delete" }
  var auditQueue = 0;        // number of audit rows not yet pushed
  var replaceAll = false;    // full-replace push (after backup import / reset)
  var status = "local";      // local | login | syncing | cloud | offline
  var timer = null;
  var listeners = [];
  var profile = null;
  var localRowsBefore = 0;   // local rows present before first cloud hydrate
  var lastCloudEmpty = false;
  var localSnapshot = null;  // deep copy of local store taken before hydrate
  var missing = {};          // cloud tables absent until a migration is run

  function enabled() {
    return !!(window.ASTORIA_SUPABASE && window.ASTORIA_SUPABASE.url && window.ASTORIA_SUPABASE.anonKey);
  }
  function getStatus() { return status; }
  function onChange(fn) { listeners.push(fn); }
  function setStatus(s) {
    status = s;
    listeners.forEach(function (fn) { fn(s); });
  }
  function pendingCount() { return Object.keys(pending).length + auditQueue + (replaceAll ? 1 : 0); }
  function missingTables() { return Object.keys(missing); }
  /* Migration 002 adds m_customer/m_formula/m_packaging/m_mixer AND the
     materials.moq/lead_days + boms.formula_id/packaging_id columns in one
     shot. Until it runs those columns are absent, so the write-side row
     mappers must omit them (PostgREST rejects unknown columns on upsert).
     Presence of m_formula is the proxy for "002 applied". */
  function has002() { return !missing["m_formula"]; }

  /* Migration 007 adds m_supplier plus the materials / t_purchase_req /
     t_purchase_order supplier_id FK. Until it runs those columns are absent,
     so the write-side row mappers must omit them. Presence of m_supplier
     (a table only 007 creates) is the proxy for "007 applied". */
  function has007() { return !missing["m_supplier"]; }

  /* ---------- dirty tracking ---------- */
  function loadPending() {
    try {
      var raw = JSON.parse(localStorage.getItem(PKEY) || "{}");
      pending = raw.marks || {};
      auditQueue = raw.audit || 0;
      replaceAll = !!raw.replaceAll;
    } catch (e) { pending = {}; auditQueue = 0; replaceAll = false; }
  }
  function savePending() {
    localStorage.setItem(PKEY, JSON.stringify({ marks: pending, audit: auditQueue, replaceAll: replaceAll }));
  }
  function mark(table, key, op) {
    if (!enabled()) return;
    pending[table + ":" + key] = { table: table, key: key, op: op || "upsert" };
    savePending();
    flushSoon();
  }
  function markAudit() { if (!enabled()) return; auditQueue++; savePending(); flushSoon(); }
  function markAll() { if (!enabled()) return; replaceAll = true; savePending(); flushSoon(); }

  /* ---------- row mappers (camelCase <-> snake_case) ---------- */
  function fgRow(f) {
    return {
      id: f.id, ffs: f.ffs, fps: f.fps, deskripsi: f.deskripsi || "",
      kode_na: f.kodeNA || "", tgl_expire: f.tglExpire || "", discontinue: !!f.discontinue,
      kode_fg: f.kodeFG || "", status: f.status || "",
      diubah_oleh: f.diubahOleh || "", waktu_update: f.waktuUpdate || ""
    };
  }
  function fgFrom(r) {
    return {
      id: r.id, ffs: r.ffs, fps: r.fps, deskripsi: r.deskripsi,
      kodeNA: r.kode_na, tglExpire: r.tgl_expire, discontinue: !!r.discontinue,
      diubahOleh: r.diubah_oleh, waktuUpdate: r.waktu_update,
      kodeFG: r.kode_fg, status: r.status
    };
  }
  function matRow(m) {
    var row = {
      code: m.code, name: m.name, category: m.category, unit: m.unit,
      stock_qty: Number(m.stockQty) || 0, stocked: m.stocked !== false, supplier: m.supplier || ""
    };
    if (has002()) { row.moq = Number(m.moq) || 0; row.lead_days = Number(m.leadDays) || 0; }
    if (has007()) { row.supplier_id = m.supplierId || null; }
    return row;
  }
  function matFrom(r) {
    return {
      code: r.code, name: r.name, category: r.category, unit: r.unit,
      stockQty: Number(r.stock_qty) || 0, stocked: !!r.stocked, supplier: r.supplier,
      supplierId: r.supplier_id || "",
      moq: Number(r.moq) || 0, leadDays: Number(r.lead_days) || 0
    };
  }
  function custRow(c) {
    return {
      id: c.id, name: c.name || "", address: c.address || "", pic: c.pic || "",
      contact: c.contact || "", terms: c.terms || ""
    };
  }
  function custFrom(r) {
    return {
      id: r.id, name: r.name, address: r.address, pic: r.pic, contact: r.contact, terms: r.terms
    };
  }
  function supRow(s) {
    return {
      id: s.id, name: s.name || "", address: s.address || "", pic: s.pic || "",
      contact: s.contact || "", terms: s.terms || ""
    };
  }
  function supFrom(r) {
    return {
      id: r.id, name: r.name, address: r.address, pic: r.pic, contact: r.contact, terms: r.terms
    };
  }
  function formulaRow(f) {
    return {
      id: f.id, kategori: f.kategori || "", customer_id: f.customerId || null,
      urutan: Number(f.urutan) || 0, bj: Number(f.bj) || 1,
      ph_min: f.phMin == null ? null : Number(f.phMin), ph_max: f.phMax == null ? null : Number(f.phMax),
      viscosity: f.viscosity || "",
      stab_tk: f.stabTk || "-", stab_tkul: f.stabTkul || "-", stab_t50: f.stabT50 || "-", stab_tm: f.stabTm || "-",
      note: f.note || ""
    };
  }
  function formulaFrom(r) {
    return {
      id: r.id, kategori: r.kategori, customerId: r.customer_id || "", urutan: Number(r.urutan) || 0,
      bj: Number(r.bj) || 1, phMin: r.ph_min == null ? "" : Number(r.ph_min), phMax: r.ph_max == null ? "" : Number(r.ph_max),
      viscosity: r.viscosity, stabTk: r.stab_tk, stabTkul: r.stab_tkul, stabT50: r.stab_t50, stabTm: r.stab_tm,
      note: r.note
    };
  }
  function packRow(p) {
    return {
      id: p.id, customer_id: p.customerId || null,
      urutan_varian: Number(p.urutanVarian) || 0, revisi: Number(p.revisi) || 0,
      fill_min: Number(p.fillMin) || 0, fill_max: Number(p.fillMax) || 0,
      shrink_tunnel_c: Number(p.shrinkTunnelC) || 0, inkjet_syntax: p.inkjetSyntax || "", note: p.note || ""
    };
  }
  function packFrom(r) {
    return {
      id: r.id, customerId: r.customer_id || "", urutanVarian: Number(r.urutan_varian) || 0,
      revisi: Number(r.revisi) || 0, fillMin: Number(r.fill_min) || 0, fillMax: Number(r.fill_max) || 0,
      shrinkTunnelC: Number(r.shrink_tunnel_c) || 0, inkjetSyntax: r.inkjet_syntax, note: r.note
    };
  }
  function mixerRow(m) {
    return {
      id: m.id, name: m.name || "", vessel: m.vessel || "",
      capacity_kg: Number(m.capacityKg) || 0, active: m.active !== false
    };
  }
  function mixerFrom(r) {
    return {
      id: r.id, name: r.name, vessel: r.vessel, capacityKg: Number(r.capacity_kg) || 0, active: !!r.active
    };
  }
  function bomRow(b) {
    var row = {
      id: b.id, no_bom: b.noBom, fg_id: b.fgId, revision: Number(b.revision) || 0,
      mulai_berlaku: b.mulaiBerlaku || "", customer: b.customer || "", no_customer: b.noCustomer || "",
      bulk_code: b.bulkCode || "", batch_size: b.batchSize || "",
      batch_yield: Number(b.batchYield) || 0, status: b.status || ""
    };
    if (has002()) { row.formula_id = b.formulaId || null; row.packaging_id = b.packagingId || null; row.customer_id = b.customerId || null; }
    return row;
  }
  function bomFrom(r) {
    return {
      id: r.id, noBom: r.no_bom, fgId: r.fg_id, revision: r.revision,
      mulaiBerlaku: r.mulai_berlaku, customer: r.customer, noCustomer: r.no_customer,
      bulkCode: r.bulk_code, batchSize: r.batch_size, batchYield: Number(r.batch_yield) || 0,
      status: r.status, formulaId: r.formula_id || "", packagingId: r.packaging_id || "", customerId: r.customer_id || "", items: []
    };
  }
  function bomLineRows(b) {
    var withPct = has002();
    return (b.items || []).map(function (it, i) {
      var row = {
        bom_id: b.id, sort: i, section: it.section, material_code: it.materialCode,
        qty_per_unit: Number(it.qtyPerUnit) || 0, qty_per_batch: Number(it.qtyPerBatch) || 0,
        unit: it.unit || "", supported_by: it.supportedBy || "",
        loss_pct: Number(it.lossPct) || 0, note: it.note || ""
      };
      if (withPct) row.pct = Number(it.pct) || 0;
      return row;
    });
  }
  function simRow(s) { return { id: s.id, no_sim: s.noSim, payload: s }; }
  function simFrom(r) { return r.payload; }
  function reqRow(r) { return { id: r.id, type: r.type, no_doc: r.noDoc, payload: r }; }
  function reqFrom(r) { return r.payload; }
  /* ---- Phase 2 transaction tables (migration 003, v:3) ---- */
  function soRow(s) {
    return {
      id: s.id, no_so: s.noSo || "", customer_id: s.customerId || null, fg_id: s.fgId || null,
      kode_barang: s.kodeBarang || "", netto_per_unit: Number(s.nettoPerUnit) || 0,
      order_qty: Number(s.orderQty) || 0, delivery_date: s.deliveryDate || null,
      status: s.status || "Draft", note: s.note || "", created_by: s.createdBy || ""
    };
  }
  function soFrom(r) {
    return {
      id: r.id, noSo: r.no_so || "", customerId: r.customer_id || "", fgId: r.fg_id || "",
      kodeBarang: r.kode_barang || "", nettoPerUnit: Number(r.netto_per_unit) || 0,
      orderQty: Number(r.order_qty) || 0, deliveryDate: r.delivery_date || "",
      status: r.status || "Draft", note: r.note || "", createdBy: r.created_by || ""
    };
  }
  function prRow(p) {
    var row = {
      id: p.id, req_no: p.reqNo || "", so_id: p.soId || null, fg_id: p.fgId || null,
      material_code: p.materialCode || "", material_name: p.materialName || "",
      qty: Number(p.qty) || 0, net_qty: Number(p.netQty) || 0, unit: p.unit || "",
      moq: Number(p.moq) || 0, supplier: p.supplier || "",
      required_by: p.requiredBy || null, status: p.status || "Open"
    };
    if (has007()) row.supplier_id = p.supplierId || null;
    return row;
  }
  function prFrom(r) {
    return {
      id: r.id, reqNo: r.req_no || "", soId: r.so_id || "", fgId: r.fg_id || "",
      materialCode: r.material_code || "", materialName: r.material_name || "",
      qty: Number(r.qty) || 0, netQty: Number(r.net_qty) || 0, unit: r.unit || "",
      moq: Number(r.moq) || 0, supplier: r.supplier || "", supplierId: r.supplier_id || "",
      requiredBy: r.required_by || "", status: r.status || "Open"
    };
  }
  function coRow(c) {
    return {
      id: c.id, call_off_no: c.callOffNo || "", so_id: c.soId || null, fg_id: c.fgId || null,
      customer_id: c.customerId || null, material_code: c.materialCode || "",
      material_name: c.materialName || "", qty: Number(c.qty) || 0, unit: c.unit || "",
      required_by: c.requiredBy || null, status: c.status || "Open"
    };
  }
  function coFrom(r) {
    return {
      id: r.id, callOffNo: r.call_off_no || "", soId: r.so_id || "", fgId: r.fg_id || "",
      customerId: r.customer_id || "", materialCode: r.material_code || "",
      materialName: r.material_name || "", qty: Number(r.qty) || 0, unit: r.unit || "",
      requiredBy: r.required_by || "", status: r.status || "Open"
    };
  }
  function woRow(w) {
    return {
      id: w.id, wo_no: w.woNo || "", campaign_no: w.campaignNo || "", so_id: w.soId || null,
      fg_id: w.fgId || null, bulk_code: w.bulkCode || "", mixer_id: w.mixerId || null,
      batch_seq: Number(w.batchSeq) || 1, planned_kg: Number(w.plannedKg) || 0,
      status: w.status || "Planned"
    };
  }
  function woFrom(r) {
    return {
      id: r.id, woNo: r.wo_no || "", campaignNo: r.campaign_no || "", soId: r.so_id || "",
      fgId: r.fg_id || "", bulkCode: r.bulk_code || "", mixerId: r.mixer_id || "",
      batchSeq: Number(r.batch_seq) || 1, plannedKg: Number(r.planned_kg) || 0,
      status: r.status || "Planned"
    };
  }
  /* ---- Phase 3 purchasing / warehouse tables (migration 004, v:4) ---- */
  function poRow(p) {
    var row = {
      id: p.id, po_no: p.poNo || "", pr_id: p.prId || null, supplier: p.supplier || "",
      material_code: p.materialCode || "", material_name: p.materialName || "",
      qty: Number(p.qty) || 0, received_qty: Number(p.receivedQty) || 0,
      unit_price: Number(p.unitPrice) || 0, unit: p.unit || "",
      lead_days: Number(p.leadDays) || 0, eta: p.eta || null,
      status: p.status || "Open", note: p.note || ""
    };
    if (has007()) row.supplier_id = p.supplierId || null;
    return row;
  }
  function poFrom(r) {
    return {
      id: r.id, poNo: r.po_no || "", prId: r.pr_id || "", supplier: r.supplier || "", supplierId: r.supplier_id || "",
      materialCode: r.material_code || "", materialName: r.material_name || "",
      qty: Number(r.qty) || 0, receivedQty: Number(r.received_qty) || 0,
      unitPrice: Number(r.unit_price) || 0, unit: r.unit || "",
      leadDays: Number(r.lead_days) || 0, eta: r.eta || "",
      status: r.status || "Open", note: r.note || ""
    };
  }
  function lotRow(l) {
    return {
      id: l.id, lot_no: l.lotNo || "", material_code: l.materialCode || "", material_name: l.materialName || "",
      po_id: l.poId || null, qty: Number(l.qty) || 0, qty_received: Number(l.qtyReceived) || 0,
      uom: l.uom || "", received_at: l.receivedAt || null,
      coa_ref: l.coaRef || "", halal_ref: l.halalRef || "", msds_ref: l.msdsRef || "",
      expiry: l.expiry || null, status: l.status || "Quarantine", note: l.note || ""
    };
  }
  function lotFrom(r) {
    return {
      id: r.id, lotNo: r.lot_no || "", materialCode: r.material_code || "", materialName: r.material_name || "",
      poId: r.po_id || "", qty: Number(r.qty) || 0, qtyReceived: Number(r.qty_received) || 0,
      uom: r.uom || "", receivedAt: r.received_at || "",
      coaRef: r.coa_ref || "", halalRef: r.halal_ref || "", msdsRef: r.msds_ref || "",
      expiry: r.expiry || "", status: r.status || "Quarantine", note: r.note || ""
    };
  }
  function txnRow(t) {
    return {
      id: t.id, txn_type: t.txnType || "ADJUST", material_code: t.materialCode || "", material_name: t.materialName || "",
      lot_id: t.lotId || null, wo_id: t.woId || null, qty: Number(t.qty) || 0, uom: t.uom || "",
      ref_type: t.refType || "", ref_id: t.refId || "", note: t.note || "", txn_at: t.txnAt || ""
    };
  }
  function txnFrom(r) {
    return {
      id: r.id, txnType: r.txn_type || "ADJUST", materialCode: r.material_code || "", materialName: r.material_name || "",
      lotId: r.lot_id || "", woId: r.wo_id || "", qty: Number(r.qty) || 0, uom: r.uom || "",
      refType: r.ref_type || "", refId: r.ref_id || "", note: r.note || "", txnAt: r.txn_at || ""
    };
  }
  function stgRow(s) {
    return {
      id: s.id, staging_no: s.stagingNo || "", doc_type: s.docType || "FR-PP-01",
      wo_id: s.woId || null, campaign_no: s.campaignNo || "", fg_id: s.fgId || null,
      material_code: s.materialCode || "", material_name: s.materialName || "",
      lot_id: s.lotId || null, lot_no: s.lotNo || "", qty: Number(s.qty) || 0, uom: s.uom || "",
      status: s.status || "Reserved", weighed_by: s.weighedBy || "", weighed_at: s.weighedAt || "", note: s.note || ""
    };
  }
  function stgFrom(r) {
    return {
      id: r.id, stagingNo: r.staging_no || "", docType: r.doc_type || "FR-PP-01",
      woId: r.wo_id || "", campaignNo: r.campaign_no || "", fgId: r.fg_id || "",
      materialCode: r.material_code || "", materialName: r.material_name || "",
      lotId: r.lot_id || "", lotNo: r.lot_no || "", qty: Number(r.qty) || 0, uom: r.uom || "",
      status: r.status || "Reserved", weighedBy: r.weighed_by || "", weighedAt: r.weighed_at || "", note: r.note || ""
    };
  }

  /* ---- Phase 4 QA gates + production execution (migration 005, v:5) ---- */
  function lcRow(c) {
    return {
      id: c.id, clearance_no: c.clearanceNo || "", clearance_type: c.clearanceType || "FR-QA-21",
      wo_type: c.woType || "Bulk", wo_id: c.woId || "", wo_ref: c.woRef || "", campaign_no: c.campaignNo || "",
      checklist: c.checklist || [], status: c.status || "Open",
      qc_signer: c.qcSigner || "", qc_time: c.qcTime || "", note: c.note || ""
    };
  }
  function lcFrom(r) {
    return {
      id: r.id, clearanceNo: r.clearance_no || "", clearanceType: r.clearance_type || "FR-QA-21",
      woType: r.wo_type || "Bulk", woId: r.wo_id || "", woRef: r.wo_ref || "", campaignNo: r.campaign_no || "",
      checklist: r.checklist || [], status: r.status || "Open",
      qcSigner: r.qc_signer || "", qcTime: r.qc_time || "", note: r.note || ""
    };
  }
  function ipcRow(p) {
    return {
      id: p.id, ipc_no: p.ipcNo || "", ipc_type: p.ipcType || "FR-QA-25",
      wo_id: p.woId || "", wo_ref: p.woRef || "", campaign_no: p.campaignNo || "", fg_id: p.fgId || null,
      checks: p.checks || [], result: p.result || "Pass", inspector: p.inspector || "",
      recorded_at: p.recordedAt || "", note: p.note || ""
    };
  }
  function ipcFrom(r) {
    return {
      id: r.id, ipcNo: r.ipc_no || "", ipcType: r.ipc_type || "FR-QA-25",
      woId: r.wo_id || "", woRef: r.wo_ref || "", campaignNo: r.campaign_no || "", fgId: r.fg_id || "",
      checks: r.checks || [], result: r.result || "Pass", inspector: r.inspector || "",
      recordedAt: r.recorded_at || "", note: r.note || ""
    };
  }
  function phaseRow(p) {
    return {
      id: p.id, wo_id: p.woId || null, phase_no: Number(p.phaseNo) || 1, phase_name: p.phaseName || "",
      material_code: p.materialCode || "", material_name: p.materialName || "",
      theoretical_kg: Number(p.theoreticalKg) || 0, actual_kg: Number(p.actualKg) || 0,
      vessel: p.vessel || "", homogenizer_hz: Number(p.homogenizerHz) || 0, temperature_c: Number(p.temperatureC) || 0,
      started_at: p.startedAt || "", ended_at: p.endedAt || "", operator: p.operator || "", note: p.note || ""
    };
  }
  function phaseFrom(r) {
    return {
      id: r.id, woId: r.wo_id || "", phaseNo: Number(r.phase_no) || 1, phaseName: r.phase_name || "",
      materialCode: r.material_code || "", materialName: r.material_name || "",
      theoreticalKg: Number(r.theoretical_kg) || 0, actualKg: Number(r.actual_kg) || 0,
      vessel: r.vessel || "", homogenizerHz: Number(r.homogenizer_hz) || 0, temperatureC: Number(r.temperature_c) || 0,
      startedAt: r.started_at || "", endedAt: r.ended_at || "", operator: r.operator || "", note: r.note || ""
    };
  }
  function btipRow(b) {
    return {
      id: b.id, transfer_no: b.transferNo || "", wo_id: b.woId || null, campaign_no: b.campaignNo || "",
      from_vessel: b.fromVessel || "", to_hopper: b.toHopper || "", bulk_code: b.bulkCode || "",
      qty: Number(b.qty) || 0, uom: b.uom || "Kg", transferred_by: b.transferredBy || "", qa_by: b.qaBy || "",
      transferred_at: b.transferredAt || "", status: b.status || "Draft", note: b.note || ""
    };
  }
  function btipFrom(r) {
    return {
      id: r.id, transferNo: r.transfer_no || "", woId: r.wo_id || "", campaignNo: r.campaign_no || "",
      fromVessel: r.from_vessel || "", toHopper: r.to_hopper || "", bulkCode: r.bulk_code || "",
      qty: Number(r.qty) || 0, uom: r.uom || "Kg", transferredBy: r.transferred_by || "", qaBy: r.qa_by || "",
      transferredAt: r.transferred_at || "", status: r.status || "Draft", note: r.note || ""
    };
  }
  function wopRow(w) {
    return {
      id: w.id, wo_no: w.woNo || "", campaign_no: w.campaignNo || "", so_id: w.soId || null,
      fg_id: w.fgId || null, bulk_wo_id: w.bulkWoId || null, bulk_code: w.bulkCode || "",
      status: w.status || "Planned", theoretical_output: Number(w.theoreticalOutput) || 0,
      rejects: Number(w.rejects) || 0, actual_yield: Number(w.actualYield) || 0, output_unit: w.outputUnit || "pcs",
      labor_hours: Number(w.laborHours) || 0, machine_hours: Number(w.machineHours) || 0,
      rendemen_pct: Number(w.rendemenPct) || 0, variance_remark: w.varianceRemark || "",
      started_at: w.startedAt || "", done_at: w.doneAt || "", note: w.note || ""
    };
  }
  function wopFrom(r) {
    return {
      id: r.id, woNo: r.wo_no || "", campaignNo: r.campaign_no || "", soId: r.so_id || "",
      fgId: r.fg_id || "", bulkWoId: r.bulk_wo_id || "", bulkCode: r.bulk_code || "",
      status: r.status || "Planned", theoreticalOutput: Number(r.theoretical_output) || 0,
      rejects: Number(r.rejects) || 0, actualYield: Number(r.actual_yield) || 0, outputUnit: r.output_unit || "pcs",
      laborHours: Number(r.labor_hours) || 0, machineHours: Number(r.machine_hours) || 0,
      rendemenPct: Number(r.rendemen_pct) || 0, varianceRemark: r.variance_remark || "",
      startedAt: r.started_at || "", doneAt: r.done_at || "", note: r.note || ""
    };
  }
  function relRow(x) {
    return {
      id: x.id, release_no: x.releaseNo || "", wo_pack_id: x.woPackId || null, fg_id: x.fgId || null,
      campaign_no: x.campaignNo || "", batch_lot: x.batchLot || "", disposition: x.disposition || "Pending",
      qa_copy: x.qaCopy || "", qc_copy: x.qcCopy || "", signer: x.signer || "", released_at: x.releasedAt || "", note: x.note || ""
    };
  }
  function relFrom(r) {
    return {
      id: r.id, releaseNo: r.release_no || "", woPackId: r.wo_pack_id || "", fgId: r.fg_id || "",
      campaignNo: r.campaign_no || "", batchLot: r.batch_lot || "", disposition: r.disposition || "Pending",
      qaCopy: r.qa_copy || "", qcCopy: r.qc_copy || "", signer: r.signer || "", releasedAt: r.released_at || "", note: r.note || ""
    };
  }

  /* ---- migration 006: FG receipt / FG ledger / delivery order / line ---- */
  function fgrRow(r) {
    return {
      id: r.id, receipt_no: r.receiptNo || "", wo_pack_id: r.woPackId || null, release_id: r.releaseId || null,
      fg_id: r.fgId || null, kode_fg: r.kodeFg || "", batch_lot: r.batchLot || "", campaign_no: r.campaignNo || "",
      qty: Number(r.qty) || 0, qty_on_hand: Number(r.qtyOnHand) || 0, uom: r.uom || "pcs",
      expiry: r.expiry || null, produced_at: r.producedAt || "", received_at: r.receivedAt || null,
      received_by: r.receivedBy || "", backflush: r.backflush || [], note: r.note || ""
    };
  }
  function fgrFrom(r) {
    return {
      id: r.id, receiptNo: r.receipt_no || "", woPackId: r.wo_pack_id || "", releaseId: r.release_id || "",
      fgId: r.fg_id || "", kodeFg: r.kode_fg || "", batchLot: r.batch_lot || "", campaignNo: r.campaign_no || "",
      qty: Number(r.qty) || 0, qtyOnHand: Number(r.qty_on_hand) || 0, uom: r.uom || "pcs",
      expiry: r.expiry || "", producedAt: r.produced_at || "", receivedAt: r.received_at || "",
      receivedBy: r.received_by || "", backflush: r.backflush || [], note: r.note || ""
    };
  }
  function fgtRow(t) {
    return {
      id: t.id, txn_type: t.txnType || "RECEIPT", fg_id: t.fgId || null, kode_fg: t.kodeFg || "",
      fg_receipt_id: t.fgReceiptId || null, do_id: t.doId || null, qty: Number(t.qty) || 0, uom: t.uom || "pcs",
      ref_type: t.refType || "", ref_id: t.refId || "", note: t.note || "", txn_at: t.txnAt || ""
    };
  }
  function fgtFrom(r) {
    return {
      id: r.id, txnType: r.txn_type || "RECEIPT", fgId: r.fg_id || "", kodeFg: r.kode_fg || "",
      fgReceiptId: r.fg_receipt_id || "", doId: r.do_id || "", qty: Number(r.qty) || 0, uom: r.uom || "pcs",
      refType: r.ref_type || "", refId: r.ref_id || "", note: r.note || "", txnAt: r.txn_at || ""
    };
  }
  function doRow(d) {
    return {
      id: d.id, sj_no: d.sjNo || "", so_id: d.soId || null, customer_id: d.customerId || null,
      customer_name: d.customerName || "", fg_id: d.fgId || null, kode_fg: d.kodeFg || "",
      vehicle: d.vehicle || "", driver: d.driver || "", status: d.status || "Open",
      delivered_at: d.deliveredAt || "", note: d.note || ""
    };
  }
  function doFrom(r) {
    return {
      id: r.id, sjNo: r.sj_no || "", soId: r.so_id || "", customerId: r.customer_id || "",
      customerName: r.customer_name || "", fgId: r.fg_id || "", kodeFg: r.kode_fg || "",
      vehicle: r.vehicle || "", driver: r.driver || "", status: r.status || "Open",
      deliveredAt: r.delivered_at || "", note: r.note || ""
    };
  }
  function dlRow(l) {
    return {
      id: l.id, do_id: l.doId || null, fg_receipt_id: l.fgReceiptId || null, batch_lot: l.batchLot || "",
      kode_fg: l.kodeFg || "", qty: Number(l.qty) || 0, uom: l.uom || "pcs", note: l.note || ""
    };
  }
  function dlFrom(r) {
    return {
      id: r.id, doId: r.do_id || "", fgReceiptId: r.fg_receipt_id || "", batchLot: r.batch_lot || "",
      kodeFg: r.kode_fg || "", qty: Number(r.qty) || 0, uom: r.uom || "pcs", note: r.note || ""
    };
  }

  /* ---------- table registry ----------
     v = migration that introduced the table (v > 1 may be absent).
     children = dependent rows re-pushed together with the parent.   */
  var TABLES = [
    /* m_supplier is FIRST because materials / t_purchase_req / t_purchase_order
       carry a supplier_id FK to it (migration 007); upserts run parents-before-
       dependents in TABLES order, and deletes run in reverse. */
    { name: "m_supplier", pk: "id", key: "id", store: "suppliers", v: 7, row: supRow, from: supFrom },
    { name: "fg_master", pk: "id", key: "id", store: "fgs", v: 1, row: fgRow, from: fgFrom },
    { name: "materials", pk: "code", key: "code", store: "materials", v: 1, row: matRow, from: matFrom },
    { name: "m_customer", pk: "id", key: "id", store: "customers", v: 2, row: custRow, from: custFrom },
    { name: "m_formula", pk: "id", key: "id", store: "formulas", v: 2, row: formulaRow, from: formulaFrom },
    { name: "m_packaging", pk: "id", key: "id", store: "packagings", v: 2, row: packRow, from: packFrom },
    { name: "m_mixer", pk: "id", key: "id", store: "mixers", v: 2, row: mixerRow, from: mixerFrom },
    { name: "boms", pk: "id", key: "id", store: "boms", v: 1, row: bomRow, from: bomFrom,
      children: [{ name: "bom_lines", fk: "bom_id", order: "bom_id,sort", flatten: bomLineRows }],
      nest: function (db, rows) {
        var byBom = {};
        (rows["bom_lines"] || []).forEach(function (l) {
          (byBom[l.bom_id] = byBom[l.bom_id] || []).push({
            section: l.section, materialCode: l.material_code,
            qtyPerUnit: Number(l.qty_per_unit) || 0, qtyPerBatch: Number(l.qty_per_batch) || 0,
            unit: l.unit, supportedBy: l.supported_by, lossPct: Number(l.loss_pct) || 0, pct: Number(l.pct) || 0, note: l.note
          });
        });
        db.boms.forEach(function (b) { b.items = byBom[b.id] || []; });
      } },
    { name: "sims", pk: "id", key: "id", store: "sims", v: 1, order: "created_at.desc", row: simRow, from: simFrom },
    { name: "requests", pk: "id", key: "id", store: "requests", v: 1, order: "created_at.desc", row: reqRow, from: reqFrom },
    /* migration 003 - parents before dependents so FK targets upsert first */
    { name: "t_sales_order", pk: "id", key: "id", store: "salesOrders", v: 3, order: "created_at.desc", row: soRow, from: soFrom },
    { name: "t_purchase_req", pk: "id", key: "id", store: "purchaseReqs", v: 3, order: "created_at.desc", row: prRow, from: prFrom },
    { name: "t_calloff", pk: "id", key: "id", store: "calloffs", v: 3, order: "created_at.desc", row: coRow, from: coFrom },
    { name: "t_work_order_bulk", pk: "id", key: "id", store: "workOrdersBulk", v: 3, order: "created_at.desc", row: woRow, from: woFrom },
    /* migration 004 - parents before dependents (PO -> lot -> txn / staging) */
    { name: "t_purchase_order", pk: "id", key: "id", store: "purchaseOrders", v: 4, order: "created_at.desc", row: poRow, from: poFrom },
    { name: "t_inventory_lot", pk: "id", key: "id", store: "inventoryLots", v: 4, order: "created_at.desc", row: lotRow, from: lotFrom },
    { name: "t_inventory_txn", pk: "id", key: "id", store: "inventoryTxns", v: 4, order: "created_at.desc", row: txnRow, from: txnFrom },
    { name: "t_staging", pk:"id", key:"id", store:"stagings", v:4, order:"created_at.desc", row:stgRow, from:stgFrom },
    /* migration 005 - QA gates + production execution (pack before release: release FK -> pack) */
    { name: "t_line_clearance", pk:"id", key:"id", store:"lineClearances", v:5, order:"created_at.desc", row:lcRow, from:lcFrom },
    { name: "t_ipc_record", pk:"id", key:"id", store:"ipcRecords", v:5, order:"created_at.desc", row:ipcRow, from:ipcFrom },
    { name: "t_wo_bulk_phase", pk:"id", key:"id", store:"woBulkPhases", v:5, order:"created_at.desc", row:phaseRow, from:phaseFrom },
    { name: "t_btip_transfer", pk:"id", key:"id", store:"btipTransfers", v:5, order:"created_at.desc", row:btipRow, from:btipFrom },
    { name: "t_work_order_pack", pk:"id", key:"id", store:"workOrdersPack", v:5, order:"created_at.desc", row:wopRow, from:wopFrom },
    { name: "t_release", pk:"id", key:"id", store:"releases", v:5, order:"created_at.desc", row:relRow, from:relFrom },
    /* migration 006 - FG warehouse & logistics (receipt -> DO -> line -> FG ledger) */
    { name: "t_fg_receipt", pk:"id", key:"id", store:"fgReceipts", v:6, order:"created_at.desc", row:fgrRow, from:fgrFrom },
    { name: "t_delivery_order", pk:"id", key:"id", store:"deliveryOrders", v:6, order:"created_at.desc", row:doRow, from:doFrom },
    { name: "t_delivery_line", pk:"id", key:"id", store:"deliveryLines", v:6, order:"created_at.desc", row:dlRow, from:dlFrom },
    { name: "t_fg_txn", pk:"id", key:"id", store:"fgTxns", v:6, order:"created_at.desc", row:fgtRow, from:fgtFrom }
  ];
  /* append-only / single-row tables stay hand-coded */
  var EXTRAS = [
    { name: "audit_log", order: "id.desc" },
    { name: "meta_kv", order: "" }
  ];
  function childTables() {
    var out = [];
    TABLES.forEach(function (t) { (t.children || []).forEach(function (c) { out.push(c); }); });
    return out;
  }
  function isMissingTable(err) {
    return !!err && (err.code === "42P01" || err.code === "PGRST205" ||
      /does not exist|schema cache/i.test(err.message || ""));
  }
  function fetchTable(spec) {
    return SB.selectAll(spec.name, "", spec.order || "").catch(function (err) {
      if (isMissingTable(err)) { missing[spec.name] = true; return []; }
      throw err;
    });
  }

  /* ---------- hydrate: cloud -> local working copy ---------- */
  function hydrate() {
    missing = {};
    var kids = childTables();
    var specs = TABLES.concat(kids).concat(EXTRAS);
    return Promise.all(specs.map(fetchTable)).then(function (res) {
      var rows = {};
      specs.forEach(function (s, i) { rows[s.name] = res[i] || []; });

      var kv = (rows.meta_kv.filter(function (k) { return k.key === "app"; })[0] || {}).value || {};
      lastCloudEmpty = !rows.fg_master.length && !rows.materials.length && !rows.boms.length &&
        !rows.sims.length && !rows.requests.length;
      var local = Store.get();
      var db = {
        meta: {
          app: "Astoria F/G Master & BOM Suite",
          version: 1,
          company: kv.company || (local.meta && local.meta.company) || "PT ASTORIA PRIMA",
          user: local.meta.user,
          seq: kv.seq || { bom: 0, mr: 0, pr: 0, sim: 0 },
          expWarnDays: kv.expWarnDays != null ? kv.expWarnDays : 90,
          /* carry the regulatory-gate baseline across hydrate so the daily
             expiry auditor can still spot Aktif -> Non Aktif flips */
          lastExpiryAudit: local.meta.lastExpiryAudit || "",
          fgStatus: local.meta.fgStatus || {}
        },
        audit: rows.audit_log.slice(0, 1000).map(function (r) {
          return { ts: r.ts, user: r.user_name, role: r.role, action: r.action, entity: r.entity, detail: r.detail };
        })
      };
      TABLES.forEach(function (t) { db[t.store] = rows[t.name].map(t.from); });
      TABLES.forEach(function (t) { if (t.nest) t.nest(db, rows); });

      /* Refresh / re-login race: the debounced push may not have run before
         this hydrate replaced the working copy, and the cloud still holds
         the pre-edit rows. Re-apply every change waiting in the push queue
         on top of the cloud copy so edits survive and the next flush sends
         the real values (instead of re-uploading stale cloud rows). */
      var dirty = {};
      Object.keys(pending).forEach(function (k) {
        var m = pending[k];
        (dirty[m.table] = dirty[m.table] || []).push(m);
      });
      TABLES.forEach(function (t) {
        (dirty[t.name] || []).forEach(function (m) {
          db[t.store] = db[t.store].filter(function (x) { return String(x[t.key]) !== String(m.key); });
          if (m.op !== "delete") {
            var lr = (local[t.store] || []).filter(function (x) { return String(x[t.key]) === String(m.key); })[0];
            if (lr) db[t.store].push(JSON.parse(JSON.stringify(lr)));
          }
        });
      });
      if (auditQueue > 0 && local.audit && local.audit.length) {
        /* keep unpushed local audit rows at the front so the flush inserts
           exactly those (slice(0, queue)) instead of duplicating cloud rows */
        db.audit = local.audit.slice(0, auditQueue).concat(db.audit);
      }
      /* Fresh (empty) cloud with local data: keep the local working copy
         intact so the migration push uploads it instead of nothing. */
      if (lastCloudEmpty && localSnapshot &&
          ((localSnapshot.fgs || []).length + (localSnapshot.materials || []).length) > 0) {
        var keep = localSnapshot;
        localSnapshot = null;
        return keep;
      }
      localSnapshot = null;
      Store.hydrate(db);
      return db;
    });
  }

  /* ---------- profile ---------- */
  function ensureProfile() {
    var me = SB.me();
    if (!me || !me.uid) return Promise.resolve(null);
    return SB.selectAll("profiles", "id=eq." + me.uid).then(function (rows) {
      if (rows.length) { profile = rows[0]; return profile; }
      profile = {
        id: me.uid,
        full_name: me.email.split("@")[0],
        role: "PPIC",
        email: me.email
      };
      return SB.upsert("profiles", [profile]).then(function () { return profile; });
    });
  }
  function getProfile() { return profile; }
  function applyProfileUser() {
    if (!profile) return;
    Store.setUser({ name: profile.full_name || profile.email, email: profile.email, role: profile.role });
  }

  /* ---------- push: local -> cloud ---------- */
  function flushSoon() {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(function () { flush(); }, 1200);
  }
  function quote(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
  function inList(ids) { return "in.(" + ids.map(quote).join(",") + ")"; }

  function flush() {
    if (!enabled() || status === "login" || status === "syncing") return Promise.resolve();
    if (!SB.me()) return Promise.resolve();
    if (!navigator.onLine) { setStatus("offline"); return Promise.resolve(); }
    if (!pendingCount()) { setStatus("cloud"); return Promise.resolve(); }
    setStatus("syncing");

    var db = Store.get();
    var marks = Object.keys(pending).map(function (k) { return pending[k]; });
    var doReplace = replaceAll;
    var queue = auditQueue;
    var chain = Promise.resolve();
    /* tables absent on the cloud keep their marks queued until the
       migration is run - never silently dropped */
    var available = TABLES.filter(function (t) { return !missing[t.name]; });

    function group(table, op) {
      return marks.filter(function (m) { return m.table === table && m.op === op; })
        .map(function (m) { return m.key; });
    }
    function recsOf(t, ids) {
      return db[t.store].filter(function (r) { return ids.indexOf(r[t.key]) >= 0; });
    }

    if (doReplace) {
      /* PostgREST refuses DELETE without a WHERE clause, and wiping an
         already-empty cloud (first-sign-in migration) is pointless. */
      if (!lastCloudEmpty) {
        available.slice().reverse().forEach(function (t) {
          (t.children || []).slice().reverse().forEach(function (c) {
            chain = chain.then(function () { return SB.remove(c.name, c.fk + "=not.is.null"); });
          });
          chain = chain.then(function () { return SB.remove(t.name, t.pk + "=not.is.null"); });
        });
        chain = chain.then(function () { return SB.remove("meta_kv", "key=not.is.null"); });
      }
      chain = chain.then(function () { return pushEverything(db, available); });
    } else {
      /* deletes first, dependents before parents */
      available.slice().reverse().forEach(function (t) {
        var ids = group(t.name, "delete");
        if (!ids.length) return;
        (t.children || []).slice().reverse().forEach(function (c) {
          chain = chain.then(function () { return SB.remove(c.name, c.fk + "=" + inList(ids)); });
        });
        chain = chain.then(function () { return SB.remove(t.name, t.pk + "=" + inList(ids)); });
      });
      /* then upserts, parents before dependents */
      available.forEach(function (t) {
        var ids = group(t.name, "upsert");
        if (!ids.length) return;
        chain = chain.then(function () { return SB.upsert(t.name, recsOf(t, ids).map(t.row)); });
        (t.children || []).forEach(function (c) {
          chain = chain
            .then(function () { return SB.remove(c.name, c.fk + "=" + inList(ids)); })
            .then(function () {
              var flat = [];
              recsOf(t, ids).forEach(function (r) { flat = flat.concat(c.flatten(r)); });
              return SB.insert(c.name, flat);
            });
        });
      });
    }

    if (queue > 0) {
      chain = chain.then(function () {
        var rows = db.audit.slice(0, queue).map(function (a) {
          return { ts: a.ts, user_name: a.user, role: a.role, action: a.action, entity: a.entity, detail: a.detail };
        }).reverse(); /* audit is newest-first locally; insert in chronological order */
        return SB.insert("audit_log", rows);
      });
    }
    chain = chain.then(function () {
      return SB.upsert("meta_kv", [{
        key: "app",
        value: { seq: db.meta.seq, expWarnDays: db.meta.expWarnDays, company: db.meta.company }
      }]);
    });

    return chain.then(function () {
      var keep = {};
      Object.keys(pending).forEach(function (k) {
        if (missing[pending[k].table]) keep[k] = pending[k];
      });
      pending = keep;
      auditQueue = 0;
      replaceAll = replaceAll && missingTables().length > 0;
      savePending();
      setStatus("cloud");
    }).catch(function (err) {
      setStatus("offline");
      if (window.console) console.warn("Sync push failed:", err && err.message);
    });
  }

  function pushEverything(db, available) {
    var chain = Promise.resolve();
    available.forEach(function (t) {
      chain = chain.then(function () { return SB.upsert(t.name, db[t.store].map(t.row)); });
      (t.children || []).forEach(function (c) {
        chain = chain.then(function () {
          var flat = [];
          db[t.store].forEach(function (r) { flat = flat.concat(c.flatten(r)); });
          return SB.insert(c.name, flat);
        });
      });
    });
    return chain;
  }

  /* ---------- lifecycle ---------- */
  function init(cb) {
    loadPending();
    if (!enabled()) { setStatus("local"); cb("local"); return; }
    SB.init(window.ASTORIA_SUPABASE.url, window.ASTORIA_SUPABASE.anonKey);
    if (!SB.restore()) { setStatus("login"); cb("login"); return; }
    localSnapshot = JSON.parse(JSON.stringify(Store.get()));
    localRowsBefore = (Store.get().fgs.length || 0) + (Store.get().materials || []).length;
    bootFromCloud(cb);
  }
  function bootFromCloud(cb) {
    ensureProfile()
      .then(function () { applyProfileUser(); return hydrate(); })
      .then(function () {
        setStatus("cloud");
        cb("cloud");
        migrateIfFreshCloud();
        flush(); /* push anything queued while offline */
      })
      .catch(function (err) {
        if (window.console) console.warn("Cloud hydrate failed:", err && err.message);
        setStatus("offline");
        cb("offline"); /* run on local cache, retry later */
      });
  }
  function login(email, password, cb, errCb) {
    localSnapshot = JSON.parse(JSON.stringify(Store.get()));
    localRowsBefore = (Store.get().fgs.length || 0) + (Store.get().materials || []).length;
    SB.signIn(email, password)
      .then(function () { return ensureProfile(); })
      .then(function () { applyProfileUser(); return hydrate(); })
      .then(function () {
        setStatus("cloud");
        cb();
        migrateIfFreshCloud();
        flush();
      })
      .catch(function (err) { errCb(err && err.message ? err.message : String(err)); });
  }
  /* First sign-in on an empty cloud: upload the local working copy
     once, so existing masters / CSV imports migrate to Supabase. */
  function migrateIfFreshCloud() {
    if (lastCloudEmpty && localRowsBefore > 0) {
      replaceAll = true;
      savePending();
    }
  }
  function signOut() { return SB.signOut(); }

  window.addEventListener("online", function () { if (enabled() && SB.me()) flush(); });

  return {
    enabled: enabled, init: init, login: login, signOut: signOut,
    getStatus: getStatus, onChange: onChange, pendingCount: pendingCount,
    mark: mark, markAudit: markAudit, markAll: markAll,
    flush: flush, flushSoon: flushSoon, hydrate: hydrate,
    getProfile: getProfile, applyProfileUser: applyProfileUser,
    missingTables: missingTables
  };
})();
