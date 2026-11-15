/* ===========================================================================
   claude-bridge.js  —  only needed if you host this page YOURSELF.

   index.html was written for the claude.ai artifact runtime: it asks the page
   host for two things, window.claude.use("user") and window.claude.use("db").
   On claude.ai those exist and this file does nothing at all.

   Anywhere else (Firebase Hosting, Netlify, Vercel, GitHub Pages...) nothing
   provides them, so the page would open in "Not saving" mode. This file fills
   that gap with Firebase Auth + Firestore, and adds the join flow:

     sign in with Google  ->  access request created  ->  owner approves
                          ->  athlete appears on the squad board

   Fill in CONFIG below. See DEPLOY.md.
   =========================================================================== */
(function () {
  "use strict";

  /* The coach's first name, used in the page's own messages ("Ask X to
     approve you"). Set in CONFIG below; read by index.html, which runs after
     this file. Published before anything else can return early.             */
  window.CHALLENGE_COACH = "Raji";

  /* Running on claude.ai? The host already provides everything. Stand down. */
  if (window.claude && typeof window.claude.use === "function") return;

  /* ------------------------------------------------------------------ CONFIG */
  var CONFIG = {
    /* Firebase console -> Project settings -> Your apps -> Web app -> Config */
    firebase : {
    apiKey: "AIzaSyDQT0Jv4F1i7ls2Ux7ia_HYB31giptVm0Y",
    authDomain: "eagle-strength-60.firebaseapp.com",
    projectId: "eagle-strength-60",
    storageBucket: "eagle-strength-60.firebasestorage.app",
    messagingSenderId: "174482536731",
    appId: "1:174482536731:web:d1773de2e149115345fbbe",
    measurementId: "G-HECX49K697"
  },
    /* Who may approve athletes and assign levels: the coach's Google account,
       and anyone else you trust to run the challenge. Must match the owners()
       list in firestore.rules exactly. */
    ownerEmails: ["rtrader2002@gmail.com"],
    /* The coach's first name, as athletes see it in the page's messages. */
    coachName: "Raji",
    /* Shown on the sign-in gate. */
    title: "60 Days Challenge",
    blurb: "Sign in to join the challenge. Your coach approves new athletes."
  };

  if (CONFIG.coachName) window.CHALLENGE_COACH = CONFIG.coachName;

  var SDK = "https://www.gstatic.com/firebasejs/10.12.2/";

  /* ------------------------------------------------------------------- GATE UI */
  var gateEl = null;

  function gate(parts) {
    if (!gateEl) {
      gateEl = document.createElement("div");
      gateEl.id = "cb-gate";
      gateEl.innerHTML =
        '<style>' +
        '#cb-gate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;' +
        'padding:24px;background:#0b0b0c;color:#f2efe7;' +
        'font-family:"Barlow","Helvetica Neue",Arial,sans-serif;overflow:auto}' +
        '#cb-gate .cb-card{width:100%;max-width:420px;background:#151517;border:1px solid #2b2b2f;' +
        'border-radius:14px;padding:28px;display:grid;gap:14px;text-align:center}' +
        '#cb-gate img{width:120px;margin:0 auto}' +
        '#cb-gate h2{margin:0;font-family:"Barlow Condensed","Arial Narrow",Arial,sans-serif;' +
        'font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:26px;line-height:1.05}' +
        '#cb-gate p{margin:0;color:#9b978d;font-size:14.5px;line-height:1.5}' +
        '#cb-gate button{border:0;cursor:pointer;border-radius:10px;padding:13px 20px;' +
        'font-family:"Barlow Condensed","Arial Narrow",Arial,sans-serif;font-weight:800;font-size:17px;' +
        'letter-spacing:.1em;text-transform:uppercase;background:#f6b912;color:#0b0b0c}' +
        '#cb-gate button:hover{filter:brightness(1.08)}' +
        '#cb-gate button[disabled]{opacity:.5;cursor:not-allowed}' +
        '#cb-gate .cb-link{background:none;color:#9b978d;font-size:13px;letter-spacing:.04em;' +
        'text-transform:none;font-family:inherit;font-weight:500;padding:4px;text-decoration:underline}' +
        '#cb-gate .cb-err{color:#e3261c;font-size:13.5px}' +
        '</style><div class="cb-card"></div>';
      document.body.appendChild(gateEl);
    }
    var card = gateEl.querySelector(".cb-card");
    card.textContent = "";
    var logo = document.createElement("img");
    logo.src = "eagle.png"; logo.alt = "";
    logo.onerror = function () { logo.remove(); };
    card.appendChild(logo);
    parts.forEach(function (n) { card.appendChild(n); });
    return card;
  }

  function closeGate() { if (gateEl) { gateEl.remove(); gateEl = null; } }

  function node(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  /* --------------------------------------------------------------- BOOTSTRAP */
  var booted = null;

  window.claude = {
    use: function (name) {
      if (!booted) booted = start().catch(function (e) {
        console.error("[claude-bridge]", e);
        return null;
      });
      return booted.then(function (ctx) {
        if (!ctx) return null;
        return name === "user" ? ctx.user : name === "db" ? ctx.db : null;
      });
    }
  };

  function configured() {
    var c = CONFIG.firebase;
    return !!c.projectId && c.projectId.indexOf("PASTE") !== 0;
  }

  async function start() {
    if (!configured()) {
      /* Nothing wired up yet: the page shows its own "Not saving" notice. */
      console.warn("[claude-bridge] Firebase CONFIG not filled in — see DEPLOY.md");
      return null;
    }

    var app = await import(SDK + "firebase-app.js");
    var auth = await import(SDK + "firebase-auth.js");
    var store = await import(SDK + "firebase-firestore.js");

    var fbApp = app.initializeApp(CONFIG.firebase);
    var A = auth.getAuth(fbApp);
    var FS = store.getFirestore(fbApp);
    A.useDeviceLanguage();

    var me = await currentUser(auth, A);           /* sign-in gate */
    if (!me) return null;

    var member = await ensureMember(store, FS, me); /* access request */
    var owner = isOwnerEmail(me.email);

    /* An owner whose record was filed before they were listed in ownerEmails
       is still marked pending. Put that right rather than making them approve
       themselves. The rules let an owner update any member record.           */
    if (owner && member && member.status !== "approved") {
      try {
        await store.updateDoc(store.doc(FS, "members/" + me.uid), { status: "approved" });
        member.status = "approved";
      } catch (e) { console.warn("[claude-bridge] could not self-approve", e); }
    }

    if (!owner && (!member || member.status !== "approved")) {
      waitingRoom(auth, A, store, FS, me, member);
      return null;                                  /* page stays read-only */
    }

    closeGate();
    signOutCorner(auth, A, me);
    if (owner) approvals(store, FS, me);

    return {
      user: userApi(store, FS, me, owner),
      db: dbApi(store, FS)
    };
  }

  function isOwnerEmail(email) {
    return !!email && CONFIG.ownerEmails.some(function (o) {
      return o.trim().toLowerCase() === String(email).trim().toLowerCase();
    });
  }

  /* -------------------------------------------------------------- SIGN-IN */
  function currentUser(auth, A) {
    return new Promise(function (resolve) {
      var done = false;
      auth.onAuthStateChanged(A, function (u) {
        if (u) { done = true; resolve(u); return; }
        if (done) return;
        askToSignIn(auth, A, resolve);
      });
    });
  }

  function askToSignIn(auth, A, resolve) {
    var btn = node("button", "Sign in with Google");
    var err = node("p", "", "cb-err");
    err.hidden = true;
    btn.onclick = function () {
      btn.disabled = true;
      err.hidden = true;
      var provider = new auth.GoogleAuthProvider();
      auth.signInWithPopup(A, provider).then(function (res) {
        resolve(res.user);
      }, function (e) {
        btn.disabled = false;
        if (e && e.code === "auth/popup-closed-by-user") return;
        err.textContent = e && e.code === "auth/unauthorized-domain"
          ? "This web address isn't authorised in Firebase Authentication yet."
          : "Couldn't sign in. " + ((e && e.message) || "");
        err.hidden = false;
      });
    };
    gate([
      node("h2", CONFIG.title),
      node("p", CONFIG.blurb),
      btn,
      err
    ]);
  }

  /* ------------------------------------------------- ACCESS REQUEST / MEMBER */
  async function ensureMember(store, FS, me) {
    var ref = store.doc(FS, "members/" + me.uid);
    var snap = null;
    try { snap = await store.getDoc(ref); } catch (e) { /* rules may hide it */ }

    if (!snap || !snap.exists()) {
      try {
        await store.setDoc(ref, {
          name: me.displayName || (me.email || "").split("@")[0] || "Athlete",
          email: me.email || "",
          status: isOwnerEmail(me.email) ? "approved" : "pending",
          requestedAt: Date.now()
        });
      } catch (e) { console.warn("[claude-bridge] request not written", e); }
      try { snap = await store.getDoc(ref); } catch (e) { /* ignore */ }
    }

    /* Public display name, so the squad board can label the dots. */
    try {
      await store.setDoc(store.doc(FS, "names/" + me.uid), {
        name: me.displayName || (me.email || "").split("@")[0] || "Athlete"
      });
    } catch (e) { /* not fatal */ }

    return snap && snap.exists() ? snap.data() : null;
  }

  function waitingRoom(auth, A, store, FS, me, member) {
    var denied = member && member.status === "denied";
    var parts = [
      node("h2", denied ? "Not on this challenge" : "Access requested"),
      node("p", denied
        ? "Your request wasn't approved. Talk to your coach if that's a mistake."
        : "Your coach has been asked to add you. You'll be on the board as soon as "
          + "they approve you — reopen this link then.")
    ];
    if (me.email) parts.push(node("p", "Signed in as " + me.email));

    if (!denied) {
      var again = node("button", "Check again");
      again.onclick = function () { location.reload(); };
      parts.push(again);
      /* Live: the moment the coach approves, let them straight in. */
      try {
        store.onSnapshot(store.doc(FS, "members/" + me.uid), function (s) {
          if (s.exists() && s.data().status === "approved") location.reload();
        }, function () {});
      } catch (e) { /* ignore */ }
    }

    var out = node("button", "Sign out", "cb-link");
    out.onclick = function () { auth.signOut(A).then(function () { location.reload(); }); };
    parts.push(out);
    gate(parts);
  }

  /* ------------------------------------------------------- window.claude.user */
  function userApi(store, FS, me, owner) {
    var cache = {};
    return {
      id: function () { return Promise.resolve(me.uid); },
      me: function () { return Promise.resolve({ id: me.uid, name: me.displayName || "" }); },
      isOwner: function () { return Promise.resolve(owner); },
      canEdit: function () { return Promise.resolve(true); },
      can: function (what) {
        return Promise.resolve(what === "data.write" ? true : null);
      },
      profiles: function (ids) {
        var want = (ids || []).filter(function (id) { return !(id in cache); });
        return Promise.all(want.map(function (id) {
          return store.getDoc(store.doc(FS, "names/" + id)).then(function (s) {
            cache[id] = { name: (s.exists() && s.data().name) || "" };
          }, function () { cache[id] = { name: "" }; });
        })).then(function () {
          var out = {};
          (ids || []).forEach(function (id) { out[id] = cache[id] || { name: "" }; });
          return out;
        });
      }
    };
  }

  /* --------------------------------------------------------- window.claude.db */
  /* The page speaks a small Firestore-shaped dialect: doc().set() and
     collection().onSnapshot(). Error codes are translated to the ones it
     already knows, so its own "View only" / "Not saved" states still work. */
  function dbApi(store, FS) {
    function translate(e) {
      var code = e && e.code;
      if (code === "permission-denied") return { code: "invalid_argument", message: String(code) };
      return e;
    }
    return {
      doc: function (path) {
        var ref = store.doc(FS, path);
        return {
          set: function (body) {
            return store.setDoc(ref, body).catch(function (e) { throw translate(e); });
          },
          get: function () {
            return store.getDoc(ref).then(function (s) {
              return { id: s.id, exists: s.exists(), data: function () { return s.data(); } };
            });
          }
        };
      },
      collection: function (name) {
        var ref = store.collection(FS, name);
        return {
          onSnapshot: function (cb, errcb) {
            return store.onSnapshot(ref, { includeMetadataChanges: true }, cb, function (e) {
              if (errcb) errcb(e && e.code === "permission-denied" ? { code: "revoked" } : e);
            });
          }
        };
      }
    };
  }

  /* ----------------------------------------------------- OWNER: squad admin */
  /* Three groups: who is waiting, who is in, and who has been taken off.
     Only an owner ever sees this - use("db") never resolves for anyone else. */
  function approvals(store, FS, me) {
    var host = document.createElement("section");
    host.className = "sec";
    host.innerHTML = '<div class="admin" id="cb-approvals"></div>';
    var anchor = document.getElementById("admin-sec");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor);
    else document.querySelector(".wrap").appendChild(host);
    var box = host.querySelector("#cb-approvals");

    function fail(btn, e) {
      btn.disabled = false;
      alert("Couldn't save that: " + ((e && e.message) || e) + "\n\nCheck your connection and try again.");
    }
    function setStatus(uid, status, btn) {
      btn.disabled = true;
      store.updateDoc(store.doc(FS, "members/" + uid), { status: status })
        .catch(function (e) { fail(btn, e); });
    }
    /* Taking someone off clears their ticks too, so they don't keep sitting on
       the squad board. Everyone can read progress, so hiding it is not enough. */
    function removeAthlete(uid, name, btn) {
      if (!window.confirm(
        "Take " + name + " off the challenge?\n\n" +
        "They lose access and come off the squad board, and their ticked days " +
        "are cleared.\n\nYou can let them back in later, but they would start " +
        "again from day 1.")) return;
      btn.disabled = true;
      store.deleteDoc(store.doc(FS, "progress/" + uid)).catch(function () { /* may not exist */ })
        .then(function () {
          return store.updateDoc(store.doc(FS, "members/" + uid), { status: "denied" });
        })
        .catch(function (e) { fail(btn, e); });
    }

    function row(id, m, actions) {
      var r = node("div", null, "arow");
      var who = node("div", null, "who");
      who.appendChild(node("div", (m.name || "?").trim().charAt(0).toUpperCase() || "?", "av"));
      var nm = node("div", (m.name || "Athlete") + (id === me.uid ? " (you)" : ""));
      nm.appendChild(node("small", m.email || ""));
      who.appendChild(nm);
      r.appendChild(who);
      if (actions.length) {
        var tabs = node("div", null, "tabs");
        actions.forEach(function (a) {
          var b = node("button", a[0], a[1]);
          b.type = "button";
          b.onclick = function () { a[2](b); };
          tabs.appendChild(b);
        });
        r.appendChild(tabs);
      }
      return r;
    }

    store.onSnapshot(store.collection(FS, "members"), function (snap) {
      var waiting = [], active = [], off = [];
      snap.forEach(function (d) {
        var m = d.data() || {}, e = { id: d.id, m: m };
        if (m.status === "pending") waiting.push(e);
        else if (m.status === "approved") active.push(e);
        else off.push(e);
      });
      var byName = function (a, b) { return (a.m.name || "").localeCompare(b.m.name || ""); };
      waiting.sort(function (a, b) { return (a.m.requestedAt || 0) - (b.m.requestedAt || 0); });
      active.sort(byName); off.sort(byName);

      box.textContent = "";
      var h = node("h3", "Squad admin");
      h.appendChild(node("span", waiting.length
        ? String(waiting.length) + (waiting.length === 1 ? " waiting" : " waiting")
        : "None waiting", "lvl " + (waiting.length ? "adv" : "none")));
      box.appendChild(h);
      box.appendChild(node("p", waiting.length
        ? "Approve an athlete and they join the squad board immediately."
        : "Anyone who opens the link and signs in shows up here first."));

      if (waiting.length) {
        box.appendChild(node("div", "Access requests \u00b7 " + waiting.length, "group-h"));
        waiting.forEach(function (e) {
          box.appendChild(row(e.id, e.m, [
            ["Approve", "beg", function (b) { setStatus(e.id, "approved", b); }],
            ["Deny", "adv", function (b) { setStatus(e.id, "denied", b); }]
          ]));
        });
      }

      if (active.length) {
        box.appendChild(node("div", "On the challenge \u00b7 " + active.length, "group-h"));
        active.forEach(function (e) {
          /* No button on your own row: an owner removing themselves would lock
             the panel away from them.                                        */
          box.appendChild(row(e.id, e.m, e.id === me.uid ? [] : [
            ["Take off", "adv", function (b) { removeAthlete(e.id, e.m.name || "this athlete", b); }]
          ]));
        });
      }

      if (off.length) {
        box.appendChild(node("div", "Not on the challenge \u00b7 " + off.length, "group-h"));
        off.forEach(function (e) {
          box.appendChild(row(e.id, e.m, [
            ["Let back in", "beg", function (b) { setStatus(e.id, "approved", b); }]
          ]));
        });
      }
    }, function (e) { console.warn("[claude-bridge] members listen failed", e); });
  }

  /* ------------------------------------------------------------- sign out */
  function signOutCorner(auth, A, me) {
    var bar = document.querySelector("header.top");
    if (!bar) return;
    var b = node("button", "Sign out");
    b.type = "button";
    b.title = me.email || "";
    b.style.cssText = "background:none;border:1px solid #2b2b2f;color:#9b978d;border-radius:999px;" +
      "padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap";
    b.onclick = function () { auth.signOut(A).then(function () { location.reload(); }); };
    bar.appendChild(b);
  }
})();
