/* ============================================================
   UI - DOM helpers, tables, modals, toasts, print documents
   ============================================================ */
window.UI = (function () {

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (k === "value") n.value = v;
      else if (v === true) n.setAttribute(k, "");
      else n.setAttribute(k, v);
    });
    (Array.isArray(kids) ? kids : (kids ? [kids] : [])).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  /* cols: [{label, cls, render(row)->node|string}] */
  function table(cols, rows, opts) {
    opts = opts || {};
    var t = el("table", { class: "tbl" });
    var thead = el("thead");
    var hr = el("tr");
    cols.forEach(function (c) { hr.appendChild(el("th", { class: c.cls || "", text: c.label })); });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = el("tbody");
    if (!rows.length) {
      var tr0 = el("tr");
      tr0.appendChild(el("td", { colspan: String(cols.length), class: "empty", text: opts.emptyText || "No data yet." }));
      tb.appendChild(tr0);
    }
    rows.forEach(function (r) {
      var tr = el("tr", opts.onRowClick ? { class: "clickable", onclick: function () { opts.onRowClick(r); } } : null);
      cols.forEach(function (c) {
        var v = c.render ? c.render(r) : r[c.key];
        var td = el("td", { class: c.cls || "" });
        if (v instanceof Node) td.appendChild(v);
        else td.innerHTML = v === undefined || v === null ? "" : String(v);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return el("div", { class: "table-wrap" }, [t]);
  }

  function pill(status) {
    return el("span", { class: "pill " + Engine.statusClass(status), text: status || "(empty)" });
  }
  function tag(text) { return el("span", { class: "tag", text: text }); }

  function card(title, actionsNode, bodyNode, opts) {
    opts = opts || {};
    var head = el("div", { class: "card-head" }, [
      el("h3", { text: title }),
      opts.hint ? el("span", { class: "hint", text: opts.hint }) : null,
      el("div", { class: "btn-row" }, actionsNode ? (Array.isArray(actionsNode) ? actionsNode : [actionsNode]) : [])
    ]);
    var body = el("div", { class: "card-body" + (opts.tight ? " tight" : "") }, [bodyNode]);
    return el("section", { class: "card" }, [head, body]);
  }

  function pageHead(title, sub, actions) {
    return el("div", { class: "page-head" }, [
      el("div", {}, [el("h1", { text: title }), sub ? el("div", { class: "sub", text: sub }) : null]),
      el("div", { class: "page-actions" }, actions || [])
    ]);
  }

  /* ---------- form controls ---------- */
  function input(attrs) { return el("input", Object.assign({ class: "input" }, attrs)); }
  function select(options, value, attrs) {
    var s = el("select", Object.assign({ class: "input" }, attrs));
    options.forEach(function (o) {
      var val = Array.isArray(o) ? o[0] : o;
      var lab = Array.isArray(o) ? o[1] : o;
      var op = el("option", { value: val, text: lab });
      if (String(val) === String(value)) op.selected = true;
      s.appendChild(op);
    });
    return s;
  }
  /* Searchable dropdown (combobox): type to filter, click / Enter to pick.
     Behaves like a native select for callers: exposes .value and fires
     "change" + "input" on the returned wrapper when a value is chosen.
     Designed for long lists (hundreds/thousands of options). */
  function combo(options, value, placeholder) {
    var wrap = el("div", { class: "combo" });
    var box = el("input", { class: "input combo-box", type: "text", autocomplete: "off",
      placeholder: placeholder || "Type to search..." });
    var list = el("div", { class: "combo-list" });
    wrap.appendChild(box); wrap.appendChild(list);

    var opts = (options || []).map(function (o) {
      return { val: Array.isArray(o) ? o[0] : o, lab: Array.isArray(o) ? o[1] : o };
    });
    var cur = (value === undefined || value === null) ? "" : String(value);
    var hi = -1;
    var MAXROWS = 200;

    function labelOf(val) {
      for (var i = 0; i < opts.length; i++) if (String(opts[i].val) === String(val)) return opts[i].lab;
      return "";
    }
    function display() { return cur === "" ? "" : labelOf(cur); }
    function fire(type) {
      var ev;
      if (window.CustomEvent) ev = new CustomEvent(type, { bubbles: false });
      else { ev = document.createEvent("Event"); ev.initEvent(type, false, false); }
      wrap.dispatchEvent(ev);
    }
    function isOpen() { return wrap.classList.contains("open"); }
    function renderList() {
      var q = box.value.trim().toLowerCase();
      clear(list);
      var shown = 0;
      for (var i = 0; i < opts.length && shown < MAXROWS; i++) {
        var o = opts[i];
        if (q && String(o.lab).toLowerCase().indexOf(q) < 0 && String(o.val).toLowerCase().indexOf(q) < 0) continue;
        (function (o) {
          var row = el("div", {
            class: "combo-opt" + (String(o.val) === cur ? " sel" : ""),
            text: o.lab, "data-val": String(o.val)
          });
          row.addEventListener("mousedown", function (e) { e.preventDefault(); pick(o.val); });
          list.appendChild(row);
        })(o);
        shown++;
      }
      if (!shown) list.appendChild(el("div", { class: "combo-opt empty", text: "No match" }));
      hi = -1;
    }
    function open() { renderList(); wrap.classList.add("open"); }
    function close() { wrap.classList.remove("open"); hi = -1; }
    function pick(val) {
      cur = String(val);
      box.value = display();
      close();
      fire("change"); fire("input");
    }
    function highlight(delta) {
      var rows = list.querySelectorAll(".combo-opt:not(.empty)");
      if (!rows.length) return;
      hi = (hi + delta + rows.length) % rows.length;
      for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("hi", i === hi);
      if (rows[hi]) rows[hi].scrollIntoView({ block: "nearest" });
    }
    box.addEventListener("focus", open);
    box.addEventListener("input", open);
    box.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!isOpen()) open();
        highlight(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        if (!isOpen()) return;
        e.preventDefault();
        var rows = list.querySelectorAll(".combo-opt:not(.empty)");
        if (rows.length) pick(rows[hi >= 0 ? hi : 0].getAttribute("data-val"));
      } else if (e.key === "Escape") {
        close(); box.value = display();
      }
    });
    box.addEventListener("blur", function () {
      setTimeout(function () { close(); box.value = display(); }, 120);
    });

    Object.defineProperty(wrap, "value", {
      get: function () { return cur; },
      set: function (v) { cur = (v === undefined || v === null) ? "" : String(v); box.value = display(); }
    });
    box.value = display();
    return wrap;
  }
  function field(label, node, hint) {
    return el("label", { class: "field" }, [
      el("span", { text: label }),
      node,
      hint ? el("span", { class: "hint", text: hint }) : null
    ]);
  }
  function checkRow(label, checked, onChange) {
    var cb = el("input", { type: "checkbox" });
    cb.checked = !!checked;
    if (onChange) cb.addEventListener("change", function () { onChange(cb.checked); });
    return el("div", { class: "check-row" }, [cb, el("span", { text: label })]);
  }
  function btn(label, onClick, cls) {
    return el("button", { class: "btn " + (cls || ""), type: "button", onclick: onClick, text: label });
  }

  /* ---------- modal ---------- */
  var modalOpen = null;
  function modal(opts) {
    closeModal();
    var body = el("div", { class: "modal-body" }, [opts.body]);
    var foot = el("div", { class: "modal-foot" }, (opts.actions || []).map(function (a) {
      return btn(a.label, a.onClick, a.cls);
    }).concat([btn("Close", closeModal, "")]));
    var box = el("div", { class: "modal" + (opts.wide ? " wide" : "") }, [
      el("div", { class: "modal-head" }, [el("h3", { text: opts.title }), el("button", { class: "modal-x", onclick: closeModal, html: "&times;" })]),
      body, foot
    ]);
    var ov = el("div", { class: "modal-overlay", onclick: function (e) { if (e.target === ov) closeModal(); } }, [box]);
    document.getElementById("modal-root").appendChild(ov);
    modalOpen = ov;
    return body;
  }
  function closeModal() {
    if (modalOpen) { modalOpen.remove(); modalOpen = null; }
  }

  function confirmDialog(message, onYes, yesLabel) {
    modal({
      title: "Please confirm",
      body: el("p", { style: "margin:0;font-size:13.5px", text: message }),
      actions: [{
        label: yesLabel || "Yes, continue", cls: "btn-danger",
        onClick: function () { closeModal(); onYes(); }
      }]
    });
  }

  /* ---------- toast ---------- */
  function toast(msg, type) {
    var t = el("div", { class: "toast " + (type || ""), text: msg });
    document.getElementById("toast-root").appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Copied: " + text, "ok"); },
        function () { toast("Copy failed", "err"); });
    } else toast("Clipboard not available", "err");
  }

  function readFile(file, cb) {
    var fr = new FileReader();
    fr.onload = function () { cb(fr.result); };
    fr.readAsText(file);
  }

  /* ============================================================
     PRINT DOCUMENTS (FR-PD style, mirrors client form layout)
     ============================================================ */
  function docShell(title, infoPairs, tableHTML, signLabels, noteHTML) {
    var db = Store.get();
    var infoRows = "";
    var half = Math.ceil(infoPairs.length / 2);
    for (var i = 0; i < half; i++) {
      var l = infoPairs[i] || ["", ""];
      var r = infoPairs[i + half] || ["", ""];
      infoRows += "<tr><td class='lbl'>" + Engine.esc(l[0]) + "</td><td>: " + Engine.esc(l[1]) + "</td>" +
        "<td class='lbl' style='width:80px'>" + Engine.esc(r[0]) + "</td><td>: " + Engine.esc(r[1]) + "</td></tr>";
    }
    var signs = (signLabels || ["Dibuat oleh", "Diperiksa oleh", "Disetujui oleh"]).map(function (s) {
      return "<div class='sign-cell'><div>" + Engine.esc(s) + "</div><div class='sign-space'></div><div class='sign-line'>( &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; )</div></div>";
    }).join("");
    return "<div class='doc'>" +
      "<table class='doc-head'><tr>" +
      "<td class='logo-cell' rowspan='2'><img src='assets/img/logo.png' alt='PT Astoria Prima' style='height:44px;width:auto'></td>" +
      "<td class='doc-co'>" + Engine.esc(db.meta.company) + "</td>" +
      "<td style='width:12%'><b>No Dokumen</b></td><td style='width:10%'><b>Revisi</b></td><td style='width:14%'><b>Mulai Berlaku</b></td><td style='width:12%'><b>Halaman</b></td>" +
      "</tr><tr>" +
      "<td class='doc-title'>" + Engine.esc(title) + "</td>" +
      "<td style='text-align:center'>FR-PD-</td><td style='text-align:center'>0</td><td style='text-align:center'>" + Engine.todayISO() + "</td><td style='text-align:center'>1 dari 1</td>" +
      "</tr></table>" +
      "<table class='info' style='margin-top:8px'>" + infoRows + "</table>" +
      tableHTML +
      "<div class='sign-block'>" + signs + "</div>" +
      (noteHTML ? "<div class='doc-note'>" + noteHTML + "</div>" : "") +
      "<div class='doc-foot'><span>" + Engine.esc(db.meta.company) + " - generated " + Engine.nowWIB() + " WIB by " + Engine.esc(db.meta.user.name) + "</span><span>Controlled document</span></div>" +
      "</div>";
  }

  function printHTML(html) {
    document.getElementById("print-area").innerHTML = html;
    setTimeout(function () { window.print(); }, 60);
  }

  return {
    el: el, clear: clear, table: table, pill: pill, tag: tag, card: card, pageHead: pageHead,
    input: input, select: select, combo: combo, field: field, checkRow: checkRow, btn: btn,
    modal: modal, closeModal: closeModal, confirmDialog: confirmDialog,
    toast: toast, copyText: copyText, readFile: readFile,
    docShell: docShell, printHTML: printHTML
  };
})();
