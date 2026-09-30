/* ============================================================
   VIEWS-USERS - Master User roster (Admin only) + own account
   Both read the cloud directly: staff accounts live in Supabase
   Auth (auth.users) and this app has one row per account in
   public.profiles (id, full_name, role, email, updated_at).
   Nothing here is mirrored into the local Store on purpose - a
   roster of people is not working data, and a stale copy would
   be the one thing an Admin must never act on.
   ============================================================ */
window.ViewsUsers = (function () {

  function myUid() { return (window.SB && SB.me() && SB.me().uid) || ""; }
  function myEmail() { return (window.SB && SB.me() && SB.me().email) || ""; }

  function when(iso) {
    if (!iso) return "-";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* ---------- Master User page ---------- */
  function staff(root) {
    var cloud = window.Sync && Sync.enabled();
    if (!cloud || !myUid()) {
      root.appendChild(UI.pageHead("Master User", "Staff accounts and roles.", []));
      root.appendChild(UI.card("Cloud account required", null, UI.el("p", {
        class: "muted", text: "Local mode has no staff accounts - roles here belong to this browser only. " +
          "Sign in to the Supabase cloud to see and manage the company roster."
      })));
      return;
    }
    /* Nav and the router both hide this page for non-Admins; the check is
       repeated here because the view is reachable by App.go() from code. */
    if (RBAC.role() !== "Admin") {
      root.appendChild(UI.pageHead("Master User", "This page is only available to the Admin role.", []));
      root.appendChild(UI.card("Restricted", null,
        UI.el("p", { class: "muted", text: "Ask an Admin to change your role or staff details." })));
      return;
    }

    var body = UI.el("div");
    var reload = UI.btn("Reload roster", function () { load(); });
    root.appendChild(UI.pageHead("Master User",
      "Every signed-in staff account, with the role that decides what they can edit. " +
      "Changes are written to Supabase immediately and apply to that person on their next sync.", [reload]));

    root.appendChild(UI.card("What this page can and cannot do", null, UI.el("div", {
      class: "kv"
    }, [
      UI.el("div", { text: "Rename / re-role" }), UI.el("div", { text: "Yes - saved to profiles, audited below." }),
      UI.el("div", { text: "Create an account" }), UI.el("div", { text: "No - run supabase\\create-user.ps1, or Authentication > Add user in the Dashboard." }),
      UI.el("div", { text: "Reset someone's password" }), UI.el("div", { text: "No - each person changes their own (name chip, or 'Forgot your password?' on the sign-in screen)." }),
      UI.el("div", { text: "Revoke access" }), UI.el("div", {
        text: "Not from a browser - delete the account in the Dashboard. Deleting only the profile row does NOT sign anyone out."
      })
    ])));

    var card = UI.el("section", { class: "card" }, [
      UI.el("div", { class: "card-head" }, [
        UI.el("h3", { text: "Staff accounts" }),
        UI.el("span", { class: "hint", text: "Read from profiles; empty means the account exists but has never signed in." })
      ]),
      UI.el("div", { class: "card-body tight" }, [body])
    ]);
    root.appendChild(card);

    var rows0 = [];
    /* emp_id and pw_temp arrive with migration 014. Sending a column the cloud
       does not have fails the whole PATCH, so probe once per open (hasColumn
       reads the PostgREST schema cache, not a hydrated row, so it is correct on
       an empty table) and drop the column from the form when it is missing. */
    var hasEmp = false;
    function load() {
      UI.clear(body);
      body.appendChild(UI.el("p", { class: "muted", text: "Loading staff accounts..." }));
      Promise.all([
        SB.selectAll("profiles", null, "email.asc"),
        SB.hasColumn("profiles", "emp_id").catch(function () { return false; })
      ]).then(function (res) {
        rows0 = res[0] || [];
        hasEmp = !!res[1];
        UI.clear(body);
        draw(rows0);
      }).catch(function (e) {
        UI.clear(body);
        body.appendChild(UI.el("p", {
          class: "login-err",
          text: "Could not read staff accounts: " + (e && e.message ? e.message : e) +
            " - run supabase/schema.sql and migration 008 for this project if it is new."
        }));
      });
    }

    function draw(rows) {
      var ed = {};
      var opts = RBAC.ROLES.map(function (r) { return [r, r]; });
      var me = myUid();
      rows.forEach(function (r) {
        var iName = UI.input({ value: r.full_name || "", placeholder: "Full name" });
        var iEmp = UI.input({ value: r.emp_id || "", placeholder: "Staff no." });
        /* profiles.role is NOT NULL DEFAULT 'PPIC', so a stored role is always
           one of the options - the fallback keeps a hand-edited row honest. */
        var iRole = UI.select(opts, r.role || "PPIC");
        var save = UI.btn("Save", function () { commit(r, iName, iEmp, iRole, save); }, "btn-primary btn-sm");
        ed[r.id] = { name: iName, emp: iEmp, role: iRole, save: save };
      });

      function cell(row) { return ed[row.id] || {}; }
      var adminCount = rows.filter(function (r) { return r.role === "Admin"; }).length;

      body.appendChild(UI.table([
        { label: "Email", cls: "mono", render: function (r) { return r.email || "(no email on profile)"; } },
        { label: "Name", render: function (r) { return cell(r).name; } },
        hasEmp ? { label: "Emp ID", cls: "mono", render: function (r) { return cell(r).emp; } } : null,
        { label: "Role", render: function (r) { return cell(r).role; } },
        { label: "Last change", cls: "mono", render: function (r) { return when(r.updated_at); } },
        {
          label: "Save", render: function (r) {
            return UI.el("div", { class: "btn-row" }, [
              r.id === me ? UI.tag("you") : null,
              adminCount === 1 && r.role === "Admin" ? UI.tag("last Admin") : null,
              r.pw_temp ? UI.tag("temp password") : null,
              cell(r).save
            ]);
          }
        }
      ].filter(function (c) { return !!c; }), rows, {
        emptyText: "No profiles rows yet. The first one appears after an account signs in once - " +
          "or run supabase\\create-user.ps1 to create accounts with their roles."
      }));
    }

    function commit(row, iName, iEmp, iRole, btnNode) {
      var name = iName.value.trim();
      var emp = hasEmp ? iEmp.value.trim() : (row.emp_id || "");
      var role = iRole.value;
      if (!name) { UI.toast("Name cannot be empty", "err"); return; }
      if (!role) { UI.toast("Pick a role", "err"); return; }
      /* The Admin who locks out the last Admin locks themselves out of every
         Admin-only page, including this one, with no way back but the
         Dashboard. Refuse the request rather than warn about it. */
      if (row.role === "Admin" && role !== "Admin" &&
          !rows0.some(function (r) { return r.id !== row.id && r.role === "Admin"; })) {
        UI.toast("This is the only Admin account - promote another person to Admin first", "err");
        return;
      }
      if (name === (row.full_name || "") && role === row.role && emp === (row.emp_id || "")) {
        UI.toast("Nothing changed for " + (row.email || row.id), "");
        return;
      }
      btnNode.disabled = true;
      btnNode.textContent = "Saving...";
      var changes = { full_name: name, role: role, updated_at: new Date().toISOString() };
      if (hasEmp) changes.emp_id = emp;
      /* updated_at has no trigger on profiles, so the writer stamps it. */
      SB.patch("profiles", "id=eq." + encodeURIComponent(row.id), changes).then(function (out) {
        if (!out || !out.length) throw new Error("no row matched that id - nothing was changed");
        var isMe = row.id === myUid();
        Store.audit("UPDATE", "Master User",
          (row.email || row.id) + ": " + (row.full_name || "-") + " (" + (row.role || "-") + ")" +
          (emp === (row.emp_id || "") ? "" : ", emp " + (row.emp_id || "-") + " -> " + (emp || "-")) +
          " -> " + name + " (" + role + ")");
        if (isMe) {
          /* Editing yourself: refresh every copy of the identity the UI reads,
             before save() so localStorage keeps the same name/role. */
          var pr = Sync.getProfile();
          if (pr) { pr.full_name = name; pr.role = role; }
          Store.setUser({ name: name, email: row.email || myEmail(), role: role });
        }
        Store.save();
        if (isMe) {
          App.updateUserChip();
          /* Re-draw the nav too: if this row's role turned out to be something
             other than what this browser claimed, the Admin-only entries must
             disappear immediately rather than at the next route change. */
          App.renderNav();
        }
        UI.toast("Saved " + (row.email || name), "ok");
        /* Only changing my OWN role can invalidate this page (an Admin
           demoting themselves loses the route), so that one case re-runs the
           router; a name edit must reload the roster in place. */
        if (isMe && role !== row.role) App.refresh(); else load();
      }).catch(function (e) {
        btnNode.disabled = false;
        btnNode.textContent = "Save";
        UI.toast("Save failed: " + (e && e.message ? e.message : e), "err");
      });
    }

    load();
  }

  /* ---------- Own password ---------- */
  /* One form, three entry points: the optional "My account" box opened from the
     name chip, the blocking must-change screen shown while pw_temp is set, and
     the same screen reached from a "forgot password" email link (recovery).
     o = { label, hint, recovery, clearTemp, also, onDone } */
  function passwordPanel(o) {
    var email = myEmail();
    var recovery = !!o.recovery;
    var iOld = recovery ? null : UI.input({ type: "password", placeholder: "Current password", autocomplete: "current-password" });
    var iNew = UI.input({ type: "password", placeholder: "New password (at least 8 characters)", autocomplete: "new-password" });
    var iRep = UI.input({ type: "password", placeholder: "Repeat the new password", autocomplete: "new-password" });
    var err = UI.el("div", { class: "login-err", text: "" });
    var label = o.label || "Update password";
    var go = UI.btn(label, submit, "btn-primary");
    function submit() {
      err.textContent = "";
      if (iNew.value.length < 8) { err.textContent = "The new password must be at least 8 characters."; return; }
      if (iNew.value !== iRep.value) { err.textContent = "The two new passwords do not match."; return; }
      if (!recovery && iNew.value === iOld.value) { err.textContent = "The new password must differ from the current one."; return; }
      go.disabled = true; go.textContent = "Updating...";
      /* Re-authenticate first: GoTrue refuses a password change on a stale
         session, and signing in again also proves the current password is the
         one the user typed before anything is written. In recovery mode the
         emailed link already authenticated this session, so skip straight to
         the update. */
      var auth = recovery ? Promise.resolve() : SB.signIn(email, iOld.value);
      auth.then(function () {
        return SB.updateUser({ password: iNew.value });
      }).then(function () {
        /* The one-time password an Admin handed out is temporary until its
           owner replaces it, so clear the flag on our own row - 008 allows it
           (id = auth.uid()). A failure here is not fatal: the prompt just
           returns at the next sign-in. Recovery never set pw_temp, so it skips
           this. */
        return o.clearTemp ? clearTempFlag() : null;
      }).then(function () {
        iNew.value = iRep.value = "";
        if (iOld) iOld.value = "";
        o.onDone();
      }).catch(function (e) {
        go.disabled = false; go.textContent = label;
        err.textContent = "Not changed: " + (!recovery && /invalid login|password/i.test((e && e.message) || "")
          ? "the current password is wrong" : (e && e.message) || e);
      });
    }
    function clearTempFlag() {
      return SB.patch("profiles", "id=eq." + myUid(),
        { pw_temp: false, updated_at: new Date().toISOString() }).catch(function () { return null; });
    }
    return UI.el("div", {}, [
      o.hint ? UI.el("p", { class: "muted", style: "margin:0 0 10px;font-size:12.8px", text: o.hint }) : null,
      recovery ? null : UI.field("Current password", iOld),
      UI.field("New password", iNew),
      UI.field("Repeat new password", iRep),
      err,
      UI.el("div", { class: "btn-row" }, [go, o.also || null])
    ]);
  }

  /* Blocking gate: rendered instead of the app in two cases - the account is
     still on a one-time password an Admin handed out (pw_temp), or the user
     just arrived from a "forgot password" email link (recovery). Either way the
     only way forward is to choose a private password; the only way out is to
     cancel / sign out. */
  function forcePassword(root, opts) {
    opts = opts || {};
    var recovery = !!opts.recovery;
    var u = Store.get().meta.user || {};
    root.appendChild(UI.pageHead(recovery ? "Choose a new password" : "Set your own password",
      (u.name || "This account") + "  (" + (u.role || "-") + ")  -  " + (myEmail() || ""), []));
    root.appendChild(UI.card(recovery ? "Reset your password" : "Temporary password in use", null, UI.el("div", {}, [
      UI.el("p", { style: "margin:0 0 12px;font-size:13px;line-height:1.6",
        text: recovery
          ? "You opened a password-reset link from your email, so you are signed in and ready to choose a " +
            "new password. Nothing else is available until you set one."
          : "An Admin reset this account and handed out a one-time password. Somebody else typed it and " +
            "it may be in their notes, so it is not truly yours until you replace it. " +
            "Choose a private password to continue - the rest of the app stays locked until you do." }),
      passwordPanel({
        label: recovery ? "Set my new password" : "Set my password",
        recovery: recovery,
        clearTemp: !recovery,
        also: UI.btn(recovery ? "Cancel" : "Sign out", function () {
          Sync.signOut().then(function () { location.reload(); });
        }, "btn-danger"),
        onDone: function () {
          if (recovery) {
            SB.clearRecovery();
            UI.toast("Password updated - you are signed in", "ok");
          } else {
            var pr = Sync.getProfile();
            if (pr) pr.pw_temp = false;
            UI.toast("Password updated - use it the next time you sign in", "ok");
          }
          App.refresh();
        }
      })
    ])));
  }

  /* ---------- Own account ---------- */
  /* Opened from the top-right name chip for every signed-in role: rotating
     your own password is self-service, assigning one to somebody else is not
     (shared passwords are how the test accounts all ended up identical). */
  function accountModal() {
    var u = Store.get().meta.user || {};
    var cloud = window.Sync && Sync.enabled();
    var signedIn = !!myUid();
    var me = signedIn ? myEmail() : "";

    var rows = [
      UI.el("div", { text: "Signed in as" }), UI.el("div", { text: me || "(local mode - no account)" }),
      UI.el("div", { text: "Name" }), UI.el("div", { text: u.name || "-" }),
      UI.el("div", { text: "Role" }), UI.el("div", { text: u.role || "-" }),
      UI.el("div", { text: "Data location" }), UI.el("div", {
        text: cloud ? "Supabase cloud" : "This browser only (local mode)"
      })
    ];

    if (signedIn) {
      UI.modal({
        title: "My account",
        body: UI.el("div", {}, [UI.el("div", { class: "kv" }, rows), UI.el("hr"), passwordPanel({
          hint: "Changes only your own account. Nobody can set a password for somebody else from this app.",
          onDone: function () {
            UI.closeModal();
            UI.toast("Password updated - use it the next time you sign in", "ok");
          }
        })]),
        actions: []
      });
      return;
    }

    UI.modal({
      title: "My account",
      body: UI.el("div", {}, [
        UI.el("div", { class: "kv" }, rows),
        UI.el("p", { class: "muted", style: "margin:12px 0 0;font-size:12.8px",
          text: "Local mode has no accounts and no passwords - the name and role above are set on the " +
            "Settings & Data page and only affect this browser." })
      ]),
      actions: []
    });
  }

  return { staff: staff, accountModal: accountModal, forcePassword: forcePassword };
})();
