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
    /* Raw materials (formula / bulk) - sample composition */
    mat("RM-1001", "Aqua (Demineralized Water)", "RM", "kg", 850, true, "Local supplier"),
    mat("RM-1002", "Glycerin USP", "RM", "kg", 120, true, "Local supplier"),
    mat("RM-1003", "Niacinamide PC", "RM", "kg", 25, true, "Imported"),
    mat("RM-1004", "Propylene Glycol", "RM", "kg", 60, true, "Local supplier"),
    mat("RM-1005", "Phenoxyethanol & Ethylhexylglycerin", "RM", "kg", 18, true, "Imported"),
    mat("RM-1006", "Allantoin", "RM", "kg", 6, true, "Imported"),
    mat("RM-1007", "Disodium EDTA", "RM", "kg", 4, true, "Imported"),
    mat("RM-1008", "Citric Acid Anhydrous", "RM", "kg", 3, true, "Local supplier"),
    mat("RM-1009", "Parfum / Fragrance", "RM", "kg", 2.5, true, "Imported"),

    /* Packaging (kemas) - from BOM Request 01/020/BoM/VII/2026 */
    mat("30200001", "Botol Marieskinlian Glowing Skin Toner 100 ml", "PM", "pcs", 1200, true, "Customer"),
    mat("30200002", "Cap Marieskinlian Glowing Skin Toner 100 ml", "PM", "pcs", 1200, true, "Customer"),
    mat("30200003", "Inner plug Marieskinlian Glowing Skin Toner 100 ml", "PM", "pcs", 1150, true, "Customer"),
    mat("30200004", "Sticker front Marieskinlian Glowing Skin Toner 100 ml", "PM", "pcs", 0, true, "Customer"),
    mat("30200005", "Sticker back Marieskinlian Glowing Skin Toner 100 ml", "PM", "pcs", 980, true, "Customer"),
    mat("30200006", "Satuan Marieskinlian Glowing Skin Toner 100 ml", "PM", "pcs", 1000, true, "Customer"),
    mat("20200001", "Shrink Marieskinlian Glowing Skin Toner 100 ml", "PM", "pcs", 5000, true, "Astoria"),

    /* Auxiliary */
    mat("20010004", "Mbox medium", "AX", "pcs", 420, true, "Astoria"),
    mat("20010002", "Lakban 45 cm Clear", "AX", "roll", 36, true, "Astoria")
  ];

  function fg(ffs, fps, desc, na, exp, disc, user, time) {
    return {
      id: ffs + "|" + fps,
      ffs: ffs, fps: fps, deskripsi: desc,
      kodeNA: na || "", tglExpire: exp || "",
      discontinue: !!disc,
      diubahOleh: user || "", waktuUpdate: time || "",
      kodeFG: "", status: ""
    };
  }

  var fgs = [
    fg("TO01MR03", "100200100", "Marieskinlian Glowing Skin Toner 100 ml", "NA18261201001", "2029-06-30", false, "regulatory@astoriaprima.co.id", "2026-07-15 09:12:00"),
    fg("FWS01BN01FWB", "10020100", "LOVRA Brightening Facial Wash 100ml", "NA18261203166", "2029-05-18", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:02"),
    fg("DE01RN02DC", "10020200", "LOVRA Brightening Day Cream 30 g", "NA18260105977", "2029-05-19", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:05"),
    fg("TO01LB23RM", "10040100", "LASHBOSS Quick Mascara Remover NOT FOR SALE 1.5ml", "NA101LB23RM", "", true, "regulatory@astoriaprima.co.id", "2026-09-02 15:06:40"),
    fg("TO01LB23RM", "10040200", "LASHBOSS Quick Mascara Remover 1.5ml", "NA18261201057", "2029-02-18", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:09"),
    fg("SO01LB04", "10040300", "LASHBOSS Rapunzel Serum For Lash And Brow 4.5ml", "NA18251204946", "2028-06-10", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:16"),
    fg("SH01LS11LES2", "10040400", "LASHBOSS Lash & Brow Essence Serum 5ml", "NA18261205266", "2029-08-02", false, "regulatory@astoriaprima.co.id", "2026-09-02 15:10:00"),
    fg("DE01SKL02BC", "10050100", "SKINLYFE Skin Bright Body Cream 60ml", "NA18260104990", "2029-04-25", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:32"),
    fg("DC01MT01W.NT", "10060100", "MUTIARA SKIN Day Cream Brightening 1000g", "NA18260106290", "2029-05-28", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:36"),
    fg("DC01ABC02AG", "10080100", "DR. RIFKANA BEAUTYCARE Suncare For Acne 10g", "NA18250104010", "2028-03-16", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:40"),
    fg("LC01BLO5S", "10110100", "B ERL La Belle Colorstay Lip Velvet Salsa 4g", "NA18261300890", "2029-03-16", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:36:47"),
    fg("LS03SZ01MAC.A", "10130500", "SKINDOZE Plumpfull! Hydrating Tinted Lip Balm Milkshake 4g", "NA18261300418", "2029-02-08", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:37:31"),
    fg("STCH-02", "10130800", "SKINDOZE Plumpfull! Hydrating Tinted Lip Balm Rose 4g", "NA18241302403", "2027-10-14", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:37:59"),
    fg("LT01SS07T02.3", "10160100", "SEVEN SHEPHERD Everlasting Jelly Tint Rosse 4g", "NA18261300341", "2029-01-31", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:38:34"),
    fg("FB01NS02T", "10170500", "BBYU BELOVED BY YOU Pearl Filter Satin Cushion N01 Oat 12g", "NA18260300561", "2029-05-27", false, "regulatory@astoriaprima.co.id", "2026-09-02 14:39:16"),
    fg("GC01VP01", "10190100", "ASTORIA Glow Vitamin C Serum 20 ml", "", "", false, "rnd.formula@astoriaprima.co.id", "2026-09-10 08:20:11")
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
    fgId: "TO01MR03|100200100",
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
      bomItem("FORMULA", "RM-1001", 0.09, 90, "kg", "Astoria", 0),
      bomItem("FORMULA", "RM-1002", 0.005, 5, "kg", "Astoria", 0),
      bomItem("FORMULA", "RM-1003", 0.002, 2, "kg", "Astoria", 0),
      bomItem("FORMULA", "RM-1004", 0.003, 3, "kg", "Astoria", 0),
      bomItem("FORMULA", "RM-1005", 0.0008, 0.8, "kg", "Astoria", 0),
      bomItem("FORMULA", "RM-1006", 0.0002, 0.2, "kg", "Astoria", 0),
      bomItem("FORMULA", "RM-1007", 0.00005, 0.05, "kg", "Astoria", 0),
      bomItem("FORMULA", "RM-1008", 0.00002, 0.02, "kg", "Astoria", 0),
      bomItem("FORMULA", "RM-1009", 0.0003, 0.3, "kg", "Astoria", 5),
      /* B. Kemas (packaging) components - per piece */
      bomItem("KEMAS", "30200001", 1, 1000, "pcs", "Customer", 0),
      bomItem("KEMAS", "30200002", 1, 1000, "pcs", "Customer", 0),
      bomItem("KEMAS", "30200003", 1, 1000, "pcs", "Customer", 0),
      bomItem("KEMAS", "30200004", 1, 1000, "pcs", "Customer", 3),
      bomItem("KEMAS", "30200005", 1, 1000, "pcs", "Customer", 3),
      bomItem("KEMAS", "30200006", 1, 1000, "pcs", "Customer", 0),
      bomItem("KEMAS", "20200001", 1, 1000, "pcs", "Astoria", 0),
      bomItem("KEMAS", "20010004", 1 / 60, 1000 / 60, "pcs", "Astoria", 0, "1 mbox per 60 pcs"),
      bomItem("KEMAS", "20010002", 0.002, 2, "roll", "Astoria", 0, "1 roll per 500 pcs")
    ]
  }];

  /* Mixer catalogue (PPIC lot sizing) - mirrors the migration 002 seed. */
  var mixers = [
    { id: "MX-HIMIX1000", name: "Himix 1,000 kg", vessel: "Himix", capacityKg: 1000, active: true },
    { id: "MX-DJK500", name: "Double jacket kettle 500 kg", vessel: "Double jacket kettle", capacityKg: 500, active: true },
    { id: "MX-DJK200", name: "Double jacket kettle 200 kg", vessel: "Double jacket kettle", capacityKg: 200, active: true }
  ];

  function build() {
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
        detail: "TO01MR03-100200100 (Marieskinlian Glowing Skin Toner 100 ml)"
      }]
    }));
  }

  return { build: build };
})();
