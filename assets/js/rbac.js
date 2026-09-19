/* ============================================================
   RBAC - roles, field-level rights and the document state
   machine, expressed as data. The UI enforces this today
   (buttons, locked fields, mandatory sign-offs); the same
   config later generates the server-side RLS policies so the
   client and the database can never drift apart.
   ============================================================ */
window.RBAC = (function () {

  var ROLES = ["Admin", "RND Formula", "RND Kemas", "Regulatory", "Marketing",
    "PPIC", "Purchasing", "Warehouse", "Production", "QA", "Finance"];

  /* Master F/G write access: Admin plus the three master-data owners.
     Marketing (SO), Finance (copy codes), PPIC and QA (BMR / picking)
     consume the list read-only. */
  var FG_EDITOR_ROLES = ["Admin", "RND Formula", "RND Kemas", "Regulatory"];
  /* Field ownership inside the F/G editor - who may input/edit which column:
     Admin         -> everything
     RND Formula   -> FFS code + Deskripsi + Discontinue
     RND Kemas     -> FPS code + Deskripsi + Discontinue
     Regulatory    -> FFS code + Deskripsi + Kode NA + Tgl Expire NA + Discontinue */
  var FG_FIELD_RIGHTS = {
    "Admin":       { ffs: true, fps: true, desc: true, na: true, exp: true, disc: true },
    "RND Formula": { ffs: true, fps: false, desc: true, na: false, exp: false, disc: true },
    "RND Kemas":   { ffs: false, fps: true, desc: true, na: false, exp: false, disc: true },
    "Regulatory":  { ffs: true, fps: false, desc: true, na: true, exp: true, disc: true }
  };
  /* Settings & Data (backups, reset, role management) is Admin-only once a
     cloud session exists; offline there are no accounts at all. */
  var SETTINGS_ADMIN_ONLY_IN_CLOUD = true;

  /* Ownership of the pipeline masters introduced by migration 002 */
  var MASTER_EDITORS = {
    customers: ["Marketing"],
    formulas: ["RND Formula"],
    packagings: ["RND Kemas"],
    mixers: ["PPIC", "Production"]
  };

  /* Sales Orders (FR-MK-03) are created / edited by Marketing; the status
     transitions (Confirm = Marketing, Close = PPIC) live in STATES below.
     The PPIC netting run (writes PR / call-off / campaign WO) is a PPIC
     action. Admin may do both. */
  var SO_EDITORS = ["Marketing"];
  var PPIC_PLANNERS = ["PPIC"];

  /* ---------- state machine ----------
     statuses      : the only legal values of the document status
     transitions   : allowed hops with the roles that may sign them off
     lockAfter     : field groups frozen once a status is reached       */
  var STATES = {
    salesOrder: {
      statuses: ["Draft", "Confirmed", "Closed"],
      transitions: [
        { from: "Draft", to: "Confirmed", roles: ["Marketing"] },
        { from: "Confirmed", to: "Closed", roles: ["PPIC"] }
      ],
      lockAfter: { Confirmed: ["commercial"] }
    },
    purchaseReq: {
      statuses: ["Open", "Ordered", "Cancelled"],
      transitions: [
        { from: "Open", to: "Ordered", roles: ["Purchasing"] },
        { from: "Open", to: "Cancelled", roles: ["PPIC", "Purchasing"] }
      ]
    },
    purchaseOrder: {
      statuses: ["Open", "Partial", "Closed", "Cancelled"],
      transitions: [
        { from: "Open", to: "Partial", roles: ["Purchasing", "Warehouse"] },
        { from: "Open", to: "Closed", roles: ["Purchasing", "Warehouse"] },
        { from: "Partial", to: "Closed", roles: ["Purchasing", "Warehouse"] },
        { from: "Open", to: "Cancelled", roles: ["Purchasing"] }
      ]
    },
    lot: {
      statuses: ["Quarantine", "Released", "Rejected"],
      transitions: [
        { from: "Quarantine", to: "Released", roles: ["QA"] },
        { from: "Quarantine", to: "Rejected", roles: ["QA"] }
      ]
    },
    workOrderBulk: {
      statuses: ["Planned", "Released", "InProgress", "Done", "Void"],
      transitions: [
        { from: "Planned", to: "Released", roles: ["PPIC"] },
        { from: "Released", to: "InProgress", roles: ["Production"] },
        { from: "InProgress", to: "Done", roles: ["Production", "QA"] },
        { from: "Planned", to: "Void", roles: ["PPIC"] }
      ]
    },
    workOrderPack: {
      statuses: ["Planned", "Released", "InProgress", "Done", "Void"],
      transitions: [
        { from: "Planned", to: "Released", roles: ["PPIC"] },
        { from: "Released", to: "InProgress", roles: ["Production"] },
        { from: "InProgress", to: "Done", roles: ["Production", "QA"] },
        { from: "Planned", to: "Void", roles: ["PPIC"] }
      ]
    },
    lineClearance: {
      statuses: ["Open", "Passed", "Failed"],
      transitions: [
        { from: "Open", to: "Passed", roles: ["QA"] },
        { from: "Open", to: "Failed", roles: ["QA"] }
      ]
    },
    release: {
      statuses: ["Pending", "Approved", "Rejected", "Hold"],
      transitions: [
        { from: "Pending", to: "Approved", roles: ["QA"] },
        { from: "Pending", to: "Rejected", roles: ["QA"] },
        { from: "Pending", to: "Hold", roles: ["QA"] },
        { from: "Hold", to: "Approved", roles: ["QA"] },
        { from: "Hold", to: "Rejected", roles: ["QA"] }
      ]
    },
    deliveryOrder: {
      statuses: ["Open", "Closed"],
      transitions: [
        { from: "Open", to: "Closed", roles: ["Warehouse"] }
      ]
    }
  };

  /* ---------- helpers ---------- */
  function role() {
    return ((window.Store && Store.get().meta.user) || {}).role || "";
  }
  function isAdmin() { return role() === "Admin"; }
  function canEditFG() { return FG_EDITOR_ROLES.indexOf(role()) >= 0; }
  /* null when the role has no F/G edit rights at all */
  function fgRights() { return FG_FIELD_RIGHTS[role()] || null; }
  function canEditMaster(which) {
    if (isAdmin()) return true;
    var list = MASTER_EDITORS[which] || [];
    return list.indexOf(role()) >= 0;
  }
  function canEditSO() { return isAdmin() || SO_EDITORS.indexOf(role()) >= 0; }
  function canPlan() { return isAdmin() || PPIC_PLANNERS.indexOf(role()) >= 0; }
  function canTransition(entity, from, to) {
    var e = STATES[entity];
    if (!e) return false;
    var t = (e.transitions || []).filter(function (x) { return x.from === from && x.to === to; })[0];
    if (!t) return false;
    return isAdmin() || t.roles.indexOf(role()) >= 0;
  }
  function transitionsFrom(entity, from) {
    var e = STATES[entity];
    if (!e) return [];
    return (e.transitions || []).filter(function (x) { return x.from === from; })
      .filter(function (x) { return isAdmin() || x.roles.indexOf(role()) >= 0; });
  }
  function lockedGroups(entity, status) {
    var e = STATES[entity];
    return (e && e.lockAfter && e.lockAfter[status]) || [];
  }

  return {
    ROLES: ROLES, FG_EDITOR_ROLES: FG_EDITOR_ROLES, FG_FIELD_RIGHTS: FG_FIELD_RIGHTS,
    MASTER_EDITORS: MASTER_EDITORS, SO_EDITORS: SO_EDITORS, PPIC_PLANNERS: PPIC_PLANNERS, STATES: STATES,
    SETTINGS_ADMIN_ONLY_IN_CLOUD: SETTINGS_ADMIN_ONLY_IN_CLOUD,
    role: role, isAdmin: isAdmin, canEditFG: canEditFG, fgRights: fgRights,
    canEditMaster: canEditMaster, canEditSO: canEditSO, canPlan: canPlan, canTransition: canTransition,
    transitionsFrom: transitionsFrom, lockedGroups: lockedGroups
  };
})();
