/* ============================================================
   SEED DATA - sample master data taken from client screenshots
   (Master F/G list + Bill of Material Request 01/020/BoM/VII/2026)
   ============================================================ */
window.Seed = (function () {

  function mat(code, name, category, unit, stockQty, stocked, supplier) {
    return {
      code: code, name: name, category: category, unit: unit,
      stockQty: stockQty, stocked: stocked !== false, supplier: supplier || ""
    };
  }

  var materials = [
    /* Raw materials (formula / bulk) - sample composition.
       RM-INT = locally sourced, RM-EXT = imported. */
    mat("RM-1001", "Aqua (Demineralized Water)", "RM-INT", "gr", 850, true, "Local supplier"),
    mat("RM-1002", "Glycerin USP", "RM-INT", "gr", 120, true, "Local supplier"),
    mat("RM-1003", "Niacinamide PC", "RM-EXT", "gr", 25, true, "Imported"),
    mat("RM-1004", "Propylene Glycol", "RM-INT", "gr", 60, true, "Local supplier"),
    mat("RM-1005", "Phenoxyethanol & Ethylhexylglycerin", "RM-EXT", "gr", 18, true, "Imported"),
    mat("RM-1006", "Allantoin", "RM-EXT", "gr", 6, true, "Imported"),
    mat("RM-1007", "Disodium EDTA", "RM-EXT", "gr", 4, true, "Imported"),
    mat("RM-1008", "Citric Acid Anhydrous", "RM-INT", "gr", 3, true, "Local supplier"),
    mat("RM-1009", "Parfum / Fragrance", "RM-EXT", "gr", 2.5, true, "Imported"),

    /* Packaging (kemas) - from BOM Request 01/020/BoM/VII/2026 */
    mat("30200001", "Botol Marieskinlian Glowing Skin Toner 100 ml", "PKG-INT", "pcs", 1200, true, "Customer"),
    mat("30200002", "Cap Marieskinlian Glowing Skin Toner 100 ml", "PKG-INT", "pcs", 1200, true, "Customer"),
    mat("30200003", "Inner plug Marieskinlian Glowing Skin Toner 100 ml", "PKG-INT", "pcs", 1150, true, "Customer"),
    mat("30200004", "Sticker front Marieskinlian Glowing Skin Toner 100 ml", "PKG-INT", "pcs", 0, true, "Customer"),
    mat("30200005", "Sticker back Marieskinlian Glowing Skin Toner 100 ml", "PKG-INT", "pcs", 980, true, "Customer"),
    mat("30200006", "Satuan Marieskinlian Glowing Skin Toner 100 ml", "PKG-INT", "pcs", 1000, true, "Customer"),
    mat("20200001", "Shrink Marieskinlian Glowing Skin Toner 100 ml", "PKG-INT", "pcs", 5000, true, "Astoria"),

    /* Packing consumables (still packaging-side, so they show in the BOM
       Kemas pool). QA/QC auxiliary items use the separate AUX-QA category. */
    mat("20010004", "Mbox medium", "PKG-INT", "pcs", 420, true, "Astoria"),
    mat("20010002", "Lakban 45 cm Clear", "PKG-INT", "pcs", 36, true, "Astoria")
  ];

  /* Segment-driven F/G builder: the 13-char code IS the id. The old FFS-FPS
     pair is kept as ffs/fps mirrors + a legacyCode alias so downstream lookups
     and the nightly expiry audit keep working unchanged. */
  function fg(brand, app, form, seq, size, rev, netto, oldFfs, oldFps, desc, na, exp, disc, user, time) {
    var code = brand + app + form + String(seq).padStart(3, "0") + size + String(rev).padStart(2, "0");
    return {
      id: code, ffs: oldFfs, fps: oldFps, deskripsi: desc,
      brandId: brand, formulaId: oldFfs, packagingId: oldFps,
      app: app, form: form, seq: seq, sizeLetter: size, nettoMl: netto, rev: rev,
      legacyCode: oldFfs + "-" + oldFps,
      kodeNA: na || "", tglExpire: exp || "", discontinue: !!disc,
      diubahOleh: user || "", waktuUpdate: time || "", kodeFG: code, status: ""
    };
  }

  var fgs = [
    fg("MSL", "SK", "LQ", 1, "A", 1, 100, "TO01MR03", "100200100", "Marieskinlian Glowing Skin Toner 100 ml", "NA18261201001", "2029-06-30", false, "regulatory@astoriaprima.co.id", "2026-07-15 09:12:00"),
    fg("LVR", "CL", "LQ", 1, "A", 1, 100, "FWS01BN01FWB", "10020100", "LOVRA Brightening Facial Wash 100ml", "NA18261203166", "2029-05-18", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:02"),
    fg("LVR", "SK", "CR", 1, "A", 1, 30, "DE01RN02DC", "10020200", "LOVRA Brightening Day Cream 30 g", "NA18260105977", "2029-05-19", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:05"),
    fg("LBS", "CL", "LQ", 1, "A", 1, 1.5, "TO01LB23RM", "10040100", "LASHBOSS Quick Mascara Remover NOT FOR SALE 1.5ml", "NA101LB23RM", "", true, "regulatory@astoriaprima.co.id", "2026-09-02 15:06:40"),
    fg("LBS", "CL", "LQ", 1, "A", 2, 1.5, "TO01LB23RM", "10040200", "LASHBOSS Quick Mascara Remover 1.5ml", "NA18261201057", "2029-02-18", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:09"),
    fg("LBS", "SK", "LQ", 1, "A", 1, 4.5, "SO01LB04", "10040300", "LASHBOSS Rapunzel Serum For Lash And Brow 4.5ml", "NA18251204946", "2028-06-10", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:16"),
    fg("LBS", "SK", "LQ", 2, "A", 1, 5, "SH01LS11LES2", "10040400", "LASHBOSS Lash & Brow Essence Serum 5ml", "NA18261205266", "2029-08-02", false, "regulatory@astoriaprima.co.id", "2026-09-02 15:10:00"),
    fg("SKL", "BD", "CR", 1, "A", 1, 60, "DE01SKL02BC", "10050100", "SKINLYFE Skin Bright Body Cream 60ml", "NA18260104990", "2029-04-25", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:32"),
    fg("MTR", "SK", "CR", 1, "A", 1, 1000, "DC01MT01W.NT", "10060100", "MUTIARA SKIN Day Cream Brightening 1000g", "NA18260106290", "2029-05-28", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:36"),
    fg("DRB", "SN", "CR", 1, "A", 1, 10, "DC01ABC02AG", "10080100", "DR. RIFKANA BEAUTYCARE Suncare For Acne 10g", "NA18250104010", "2028-03-16", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:40"),
    fg("BRL", "LP", "LS", 1, "A", 1, 4, "LC01BLO5S", "10110100", "B ERL La Belle Colorstay Lip Velvet Salsa 4g", "NA18261300890", "2029-03-16", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:47"),
    fg("SKD", "LP", "LS", 1, "A", 1, 4, "LS03SZ01MAC.A", "10130500", "SKINDOZE Plumpfull! Hydrating Tinted Lip Balm Milkshake 4g", "NA18261300418", "2029-02-08", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:37:31"),
    fg("SKD", "LP", "LS", 2, "A", 1, 4, "STCH-02", "10130800", "SKINDOZE Plumpfull! Hydrating Tinted Lip Balm Rose 4g", "NA18241302403", "2027-10-14", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:37:59"),
    fg("SVS", "LP", "SS", 1, "A", 1, 4, "LT01SS07T02.3", "10160100", "SEVEN SHEPHERD Everlasting Jelly Tint Rosse 4g", "NA18261300341", "2029-01-31", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:38:34"),
    fg("BBY", "FC", "CP", 1, "A", 1, 12, "FB01NS02T", "10170500", "BBYU BELOVED BY YOU Pearl Filter Satin Cushion N01 Oat 12g", "NA18260300561", "2029-05-27", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:39:16"),
    fg("AST", "SK", "LQ", 1, "A", 1, 20, "GC01VP01", "10190100", "ASTORIA Glow Vitamin C Serum 20 ml", "", "", false, "rnd.formula@astoriaprima.co.id", "2026-09-10 08:20:11")
  ];

  function bomItem(section, code, qtyPerUnit, qtyPerBatch, unit, supportedBy, lossPct, note) {
    return {
      section: section, materialCode: code,
      qtyPerUnit: qtyPerUnit, qtyPerBatch: qtyPerBatch,
      unit: unit, supportedBy: supportedBy, lossPct: lossPct || 0, note: note || ""
    };
  }

  var boms = [{
    id: "BOM-0001",
    noBom: "01/020/BoM/VII/2026",
    fgId: "MSLSKLQ001A01",
    revision: 0,
    mulaiBerlaku: "2026-07-15",
    customer: "Marieskinlian",
    noCustomer: "020",
    bulkCode: "TO01MR03TWB",
    batchSize: "100 L",
    batchYield: 1000,
    status: "Approved",
    items: [
      /* A. Formula (bulk) raw materials - per batch of 1000 pcs */
      bomItem("FORMULA", "RM-1001", 0.09, 90, "gr", "Astoria", 0),
      bomItem("FORMULA", "RM-1002", 0.005, 5, "gr", "Astoria", 0),
      bomItem("FORMULA", "RM-1003", 0.002, 2, "gr", "Astoria", 0),
      bomItem("FORMULA", "RM-1004", 0.003, 3, "gr", "Astoria", 0),
      bomItem("FORMULA", "RM-1005", 0.0008, 0.8, "gr", "Astoria", 0),
      bomItem("FORMULA", "RM-1006", 0.0002, 0.2, "gr", "Astoria", 0),
      bomItem("FORMULA", "RM-1007", 0.00005, 0.05, "gr", "Astoria", 0),
      bomItem("FORMULA", "RM-1008", 0.00002, 0.02, "gr", "Astoria", 0),
      bomItem("FORMULA", "RM-1009", 0.0003, 0.3, "gr", "Astoria", 5),
      /* B. Kemas (packaging) components - per piece */
      bomItem("KEMAS", "30200001", 1, 1000, "pcs", "Customer", 0),
      bomItem("KEMAS", "30200002", 1, 1000, "pcs", "Customer", 0),
      bomItem("KEMAS", "30200003", 1, 1000, "pcs", "Customer", 0),
      bomItem("KEMAS", "30200004", 1, 1000, "pcs", "Customer", 3),
      bomItem("KEMAS", "30200005", 1, 1000, "pcs", "Customer", 3),
      bomItem("KEMAS", "30200006", 1, 1000, "pcs", "Customer", 0),
      bomItem("KEMAS", "20200001", 1, 1000, "pcs", "Astoria", 0),
      bomItem("KEMAS", "20010004", 1 / 60, 1000 / 60, "pcs", "Astoria", 0, "1 mbox per 60 pcs"),
      bomItem("KEMAS", "20010002", 0.002, 2, "pcs", "Astoria", 0, "1 roll per 500 pcs")
    ]
  }];

  /* Mixer catalogue (PPIC lot sizing) - mirrors the migration 002 seed. */
  var mixers = [
    { id: "MX-HIMIX1000", name: "Himix 1,000 kg", vessel: "Himix", capacityKg: 1000, active: true },
    { id: "MX-DJK500", name: "Double jacket kettle 500 kg", vessel: "Double jacket kettle", capacityKg: 500, active: true },
    { id: "MX-DJK200", name: "Double jacket kettle 200 kg", vessel: "Double jacket kettle", capacityKg: 200, active: true }
  ];

  /* Brand + application full names for the derived master sample. The app
     names are the inverse of Engine.APP_MAP, written literally so the seed
     stays self-contained. */
  var BRAND_NAME = {
    MSL: "Marieskinlian", LVR: "LOVRA", LBS: "LASHBOSS", SKL: "SKINLYFE",
    MTR: "MUTIARA", DRB: "DR. RIFKANA", BRL: "B ERL", SKD: "SKINDOZE",
    SVS: "SEVEN SHEPHERD", BBY: "BBYU", AST: "ASTORIA"
  };
  var APP_NAME = {
    EY: "Eye Makeup", FC: "Face Makeup", LP: "Lip Makeup", SK: "Skincare",
    CL: "Cleansers & Makeup Removers", SN: "Sun Care", BD: "Body Care", HC: "Hair Care"
  };

  function build() {
    /* Derive one customer + brand per brand code, one formula per distinct
       FFS and one FPS per distinct FPS code straight from the F/G sample, so
       the masters and the SKUs never drift apart. */
    var customers = [], brands = [], formulas = [], packagings = [];
    var seenBrand = {}, seenFormula = {}, seenPack = {};
    fgs.forEach(function (f) {
      var cid = "CUST-" + f.brandId;
      if (!seenBrand[f.brandId]) {
        seenBrand[f.brandId] = true;
        var nm = BRAND_NAME[f.brandId] || f.brandId;
        customers.push({ id: cid, name: nm, address: "", pic: "", contact: "", terms: "Net 30" });
        brands.push({ id: f.brandId, name: nm, customerId: cid });
      }
      if (!seenFormula[f.ffs]) {
        seenFormula[f.ffs] = true;
        formulas.push({ id: f.ffs, kategori: APP_NAME[f.app] || "", dosageForm: f.form, customerId: cid, bj: 1, productName: f.deskripsi, lines: [] });
      }
      if (!seenPack[f.fps]) {
        seenPack[f.fps] = true;
        packagings.push({ id: f.fps, volumeMl: f.nettoMl, revisi: f.rev, customerId: cid, productName: f.deskripsi, lines: [] });
      }
    });
    return JSON.parse(JSON.stringify({
      meta: {
        app: "Astoria F/G Master & BOM Suite",
        version: 1,
        company: "PT ASTORIA PRIMA",
        user: { name: "PPIC Demo", email: "ppic@astoriaprima.co.id", role: "PPIC" },
        seq: { bom: 1, mr: 0, pr: 0, sim: 0 },
        expWarnDays: 90
      },
      materials: materials,
      customers: customers,
      brands: brands,
      formulas: formulas,
      packagings: packagings,
      fgs: fgs,
      boms: boms,
      /* Mixer catalogue mirrors the migration 002 seed so the PPIC lot plan
         sizes identically offline and in the cloud. */
      mixers: mixers,
      sims: [],
      requests: [],
      audit: [{
        ts: "2026-07-15 09:12:00",
        user: "regulatory@astoriaprima.co.id", role: "Regulatory",
        action: "CREATE", entity: "Master F/G",
        detail: "MSLSKLQ001A01 (Marieskinlian Glowing Skin Toner 100 ml)"
      }]
    }));
  }

  return { build: build };
})();
