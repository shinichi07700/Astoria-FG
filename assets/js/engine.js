/* ============================================================
   ENGINE - business rules ported from the Google Apps Script
   (Kode FG generation, Status F/G evaluator, WIB timestamps,
   BOM explosion, MR/PR classification, CSV & numbering helpers)
   ============================================================ */
window.Engine = (function () {

  var ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

  /* ---------- dates (WIB / GMT+7, same as Apps Script) ---------- */
  function wibParts(d) {
    var fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false
    });
    var out = {};
    fmt.formatToParts(d || new Date()).forEach(function (p) { out[p.type] = p.value; });
    return out;
  }
  function nowWIB() {
    var p = wibParts(new Date());
    return p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute + ":" + p.second;
  }
  function todayISO() {
    var p = wibParts(new Date());
    return p.year + "-" + p.month + "-" + p.day;
  }
  function romanMonth(dateStr) {
    var d = parseDate(dateStr || todayISO());
    return ROMAN[(d || new Date()).getMonth()];
  }
  function yearOf(dateStr) {
    var d = parseDate(dateStr || todayISO());
    return (d || new Date()).getFullYear();
  }

  /* Accepts yyyy-mm-dd, yyyy/mm/dd, dd/mm/yyyy, dd-mm-yyyy or Date object */
  function parseDate(v) {
    if (!v && v !== 0) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    var s = String(v).trim();
    if (!s) return null;
    var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    var t = Date.parse(s);
    return isNaN(t) ? null : new Date(t);
  }
  function toISO(v) {
    var d = parseDate(v);
    if (!d) return "";
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mm + "-" + dd;
  }

  /* ---------- Column A: Kode Produk Finish Good = FFS + "-" + FPS ---------- */
  function kodeFG(ffs, fps) {
    ffs = (ffs || "").toString().trim();
    fps = (fps || "").toString().trim();
    if (ffs !== "" && fps !== "") return ffs + "-" + fps;
    if (ffs !== "") return ffs;
    if (fps !== "") return fps;
    return "";
  }

  /* ---------- Column C: Status F/G evaluator (exact port) ---------- */
  function evaluateStatus(ffs, fps, kodeNA, expireVal, isDiscontinued) {
    ffs = (ffs || "").toString().trim();
    fps = (fps || "").toString().trim();
    kodeNA = (kodeNA || "").toString().trim();

    if (isDiscontinued === true ||
        String(isDiscontinued).toUpperCase() === "TRUE" ||
        String(isDiscontinued).toLowerCase().indexOf("discontinue") >= 0) {
      return "Non Aktif";
    }
    if (ffs === "" && fps === "" && kodeNA === "" && !expireVal) return "";
    if (ffs === "" || fps === "") return "Non Aktif";
    if (kodeNA === "") return "Pending BPOM";

    var isExpired = false;
    var d = parseDate(expireVal);
    if (d) {
      var today = parseDate(todayISO());
      if (d < today) isExpired = true;
    }
    return isExpired ? "Non Aktif" : "Aktif";
  }

  function statusClass(status) {
    if (status === "Aktif") return "aktif";
    if (status === "Non Aktif") return "nonaktif";
    if (status === "Pending BPOM") return "pending";
    return "none";
  }

  /* ---------- number formatting ---------- */
  function fmtNum(n, dec) {
    if (n === null || n === undefined || isNaN(n)) return "";
    var d = dec === undefined ? 4 : dec;
    var r = Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
    return String(r);
  }
  function pad(n, w) { return String(n).padStart(w, "0"); }

  /* ---------- document numbering ---------- */
  function noBom(seq, noCustomer, dateStr) {
    return pad(seq, 2) + "/" + (noCustomer || "000") + "/BoM/" + romanMonth(dateStr) + "/" + yearOf(dateStr);
  }
  function noRequest(type, seq, dateStr) {
    return type + "/" + romanMonth(dateStr) + "/" + yearOf(dateStr) + "/" + pad(seq, 3);
  }

  /* ---------- BOM explosion & MR/PR classification ----------
     Rule: stocked material -> warehouse issues what is on hand (Material
     Request); the shortage must be purchased (Purchase Request).
     Non-stocked material -> fully purchased (Purchase Request).        */
  function explode(bom, orderQty, matMap) {
    var lines = (bom.items || []).map(function (it) {
      var m = matMap[it.materialCode] || { code: it.materialCode, name: "(unknown material " + it.materialCode + ")", unit: it.unit, stockQty: 0, stocked: true };
      var loss = 1 + (Number(it.lossPct) || 0) / 100;
      var perUnit = Number(it.qtyPerUnit) || 0;
      var gross = perUnit * orderQty * loss;
      var onHand = Number(m.stockQty) || 0;
      var stocked = m.stocked !== false;
      var mrQty = stocked ? Math.min(gross, onHand) : 0;
      var prQty = stocked ? Math.max(0, gross - onHand) : gross;
      return {
        section: it.section,
        materialCode: it.materialCode,
        name: m.name,
        unit: it.unit || m.unit,
        supportedBy: it.supportedBy,
        lossPct: Number(it.lossPct) || 0,
        perUnit: perUnit,
        gross: gross,
        onHand: onHand,
        stocked: stocked,
        mrQty: round4(mrQty),
        prQty: round4(prQty)
      };
    });
    return {
      lines: lines,
      mrLines: lines.filter(function (l) { return l.mrQty > 0; }),
      prLines: lines.filter(function (l) { return l.prQty > 0; })
    };
  }
  function round4(n) { return Math.round(n * 10000) / 10000; }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    var rows = [], row = [], cur = "", inQ = false;
    text = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ""; }); });
  }
  function toCSV(rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        var s = c === null || c === undefined ? "" : String(c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(",");
    }).join("\r\n");
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return {
    nowWIB: nowWIB, todayISO: todayISO, parseDate: parseDate, toISO: toISO,
    romanMonth: romanMonth, yearOf: yearOf,
    kodeFG: kodeFG, evaluateStatus: evaluateStatus, statusClass: statusClass,
    fmtNum: fmtNum, pad: pad, noBom: noBom, noRequest: noRequest,
    explode: explode, round4: round4,
    parseCSV: parseCSV, toCSV: toCSV, download: download, esc: esc
  };
})();
