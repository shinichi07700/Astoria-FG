global.window = global;
require("g:/My Drive/Qoder/Astoria/FG/assets/js/engine.js");
const fs = require("fs");
const SRC = "g:/My Drive/Qoder/Astoria/FG/data/master-fg-sheet.csv";
const OUT = "g:/My Drive/Qoder/Astoria/FG/data/master-fg-141.csv";
const HELD_FFS = new Set(["TO01IM02MWB", "CG01PB03ACS", "HRM01MS06HM"]);

const text = fs.readFileSync(SRC, "utf8");
const rows = Engine.parseCSV(text);
const header = rows[0];

function norm(v) {
  return String(v == null ? "" : v)
    .replace(/[\u00A0\u2007\u202F]/g, " ")   // non-breaking spaces -> space
    .replace(/[\r\n]+/g, " ")                // embedded newlines -> space
    .replace(/\s{2,}/g, " ")                 // collapse runs
    .trim();
}

const real = rows.slice(1).filter(r => String(r[3] || "").trim() !== "");
const kept = [], held = [];
real.forEach(r => {
  const ffs = String(r[3]).trim();
  if (HELD_FFS.has(ffs)) held.push(r); else kept.push(r);
});

// Build output rows: normalized header + normalized kept rows (13 cols each)
const outRows = [header.map(norm)];
kept.forEach(r => {
  const row = header.map((_, i) => norm(r[i]));
  outRows.push(row);
});
fs.writeFileSync(OUT, Engine.toCSV(outRows), "utf8");

console.log("kept rows written:", kept.length);
console.log("held rows:", held.length);
console.log("--- HELD (need real FPS Kemas codes) ---");
held.forEach(r => console.log(`  ${r[0]} | ${norm(r[1])} | FFS=${r[3]} | FPS="${r[4]}" | NA=${r[5]} | exp=${r[6]}`));
// sanity: unique ids among kept
const ids = new Set(kept.map(r => String(r[3]).trim() + "|" + String(r[4]).trim()));
console.log("kept unique ids:", ids.size, "(should equal", kept.length + ")");
console.log("sample kept[0]:", JSON.stringify(outRows[1]));
console.log("output bytes:", fs.statSync(OUT).size);
