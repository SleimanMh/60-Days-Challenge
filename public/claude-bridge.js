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

  /* Running on claude.ai? The host already provides everything. Stand down. */
  if (window.claude && typeof window.claude.use === "function") return;

  /* ------------------------------------------------------------------ CONFIG */
  var CONFIG = {
    /* Firebase console -> Project settings -> Your apps -> Web app -> Config */
    firebase: {
      apiKey:            "PASTE_API_KEY",
      authDomain:        "PASTE_PROJECT.firebaseapp.com",
      projectId:         "PASTE_PROJECT_ID",
      storageBucket:     "PASTE_PROJECT.firebasestorage.app",
      messagingSenderId: "PASTE_SENDER_ID",
      appId:             "PASTE_APP_ID"
    },
    /* Who may approve athletes and assign levels. Must match firestore.rules. */
    ownerEmails: ["you@example.com"],
    /* Shown on the sign-in gate. */
    title: "60 Days Challenge",
    blurb: "Sign in to join the challenge. Your coach approves new athletes."
  };

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

    if (!owner && (!member || member.status !== "approved")) {
      waitingRoom(auth, A, store, FS, me, member);
      return null;                                  /* page stays read-only */
    }

    closeGate();
    signOutCorner(auth, A, me);
    if (owner) approvals(store, FS);

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

  /* ----------------------------------------------------- OWNER: approvals UI */
  function approvals(store, FS) {
    var host = document.createElement("section");
    host.className = "sec";
    host.innerHTML = '<div class="admin" id="cb-approvals"></div>';
    var anchor = document.getElementById("admin-sec");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor);
    else document.querySelector(".wrap").appendChild(host);

    var box = host.querySelector("#cb-approvals");

    store.onSnapshot(store.collection(FS, "members"), function (snap) {
      var pending = [];
      snap.forEach(function (d) {
        var m = d.data() || {};
        if (m.status === "pending") pending.push({ id: d.id, m: m });
      });

      box.textContent = "";
      var h = node("h3", "Access requests");
      h.appendChild(node("span", pending.length ? String(pending.length) + " waiting" : "None waiting", "lvl " + (pending.length ? "adv" : "none")));
      box.appendChild(h);
      box.appendChild(node("p", pending.length
        ? "Approve an athlete and they join the squad board immediately."
        : "Anyone who opens the link and signs in shows up here first."));

      pending.forEach(function (p) {
        var row = node("div", null, "arow");
        var who = node("div", null, "who");
        who.appendChild(node("div", (p.m.name || "?").charAt(0).toUpperCase(), "av"));
        var nm = node("div", p.m.name || "Athlete");
        nm.appendChild(node("small", p.m.email || ""));
        who.appendChild(nm);
        row.appendChild(who);

        var tabs = node("div", null, "tabs");
        ["approved", "denied"].forEach(function (status) {
          var b = node("button", status === "approved" ? "Approve" : "Deny", status === "approved" ? "beg" : "adv");
          b.type = "button";
          b.onclick = function () {
            b.disabled = true;
            store.updateDoc(store.doc(FS, "members/" + p.id), { status: status })
              .catch(function (e) { b.disabled = false; alert("Couldn't save: " + ((e && e.message) || e)); });
          };
          tabs.appendChild(b);
        });
        row.appendChild(tabs);
        box.appendChild(row);
      });
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
