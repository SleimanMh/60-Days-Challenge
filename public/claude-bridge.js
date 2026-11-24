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
    ownerEmails: ["rtrader2002@gmail.com", "sleimenmhanna@gmail.com"],
    /* The coach's first name, as athletes see it in the page's messages. */
    coachName: "Raji",
    /* Shown on the sign-in gate. */
    title: "60 Days Challenge",
    blurb: "Sign in to join the challenge. Your coach approves new athletes."
  };

  if (CONFIG.coachName) window.CHALLENGE_COACH = CONFIG.coachName;

  var SDK = "https://www.gstatic.com/firebasejs/10.12.2/";

  /* ------------------------------------------------------------------- GATE UI */
  /* The first screen every athlete sees: the poster, blurred and drifting,
     behind a glass card. States: "signin", "wait", "denied", "ok".           */
  var gateEl = null;
  var GATE_CSS =
    '#cb-gate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;overflow:auto;' +
      'background:#0b0b0c;color:#f2efe7;font-family:"Barlow","Helvetica Neue",Arial,sans-serif;transition:opacity .45s ease}' +
    '#cb-gate::before{content:"";position:fixed;inset:-60px;background:url(poster.jpg) center 30%/cover;' +
      'filter:blur(20px) saturate(125%) brightness(.4);animation:cbDrift 26s ease-in-out infinite alternate}' +
    '#cb-gate::after{content:"";position:fixed;inset:0;background:radial-gradient(75% 60% at 50% 38%,rgba(11,11,12,.15),rgba(11,11,12,.92))}' +
    '#cb-gate .cb-card{position:relative;z-index:1;width:100%;max-width:420px;padding:30px 28px 24px;display:grid;gap:14px;text-align:center;' +
      'background:rgba(21,21,23,.7);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid rgba(246,185,18,.22);' +
      'border-radius:18px;box-shadow:0 40px 90px -30px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.05);' +
      'animation:cbIn .7s cubic-bezier(.2,.8,.2,1) both}' +
    '#cb-gate .cb-logo{width:104px;margin:0 auto}' +
    '#cb-gate .cb-hero{line-height:.9;margin:-2px 0 4px}' +
    '#cb-gate .cb-60,#cb-gate .cb-days{font-family:"Permanent Marker","Barlow Condensed",cursive;font-size:64px;display:inline-block;' +
      'animation:cbBrush .7s cubic-bezier(.34,1.56,.64,1) both}' +
    '#cb-gate .cb-60{color:#f6b912;animation-delay:.15s}' +
    '#cb-gate .cb-days{margin-left:.12em;animation-delay:.27s}' +
    '#cb-gate .cb-chal{display:inline-block;margin-top:8px;font-family:"Barlow Condensed","Arial Narrow",Arial,sans-serif;font-style:italic;' +
      'font-weight:800;text-transform:uppercase;font-size:28px;color:#0b0b0c;background:#f6b912;padding:2px 18px 0 12px;' +
      'transform:skew(-8deg);clip-path:polygon(1% 8%,100% 0,98% 92%,0 100%);animation:cbSlash .55s cubic-bezier(.2,.8,.2,1) .42s both}' +
    '#cb-gate h2{margin:0;font-family:"Barlow Condensed","Arial Narrow",Arial,sans-serif;font-weight:800;text-transform:uppercase;' +
      'letter-spacing:.06em;font-size:28px;line-height:1.05}' +
    '#cb-gate .cb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
    '#cb-gate p{margin:0;color:#9b978d;font-size:14.5px;line-height:1.5}' +
    '#cb-gate p b{color:#f2efe7;font-weight:600}' +
    '#cb-gate button{border:0;cursor:pointer;border-radius:12px;padding:14px 20px;display:inline-flex;align-items:center;justify-content:center;gap:12px;' +
      'font-family:"Barlow Condensed","Arial Narrow",Arial,sans-serif;font-weight:800;font-size:17px;letter-spacing:.1em;' +
      'text-transform:uppercase;background:#f6b912;color:#0b0b0c;transition:transform .15s ease,filter .15s ease,box-shadow .25s ease;' +
      'box-shadow:0 14px 30px -14px rgba(246,185,18,.7)}' +
    '#cb-gate button:hover{filter:brightness(1.07);transform:translateY(-1px)}' +
    '#cb-gate button:active{transform:translateY(1px) scale(.98)}' +
    '#cb-gate button[disabled]{opacity:.55;cursor:progress;transform:none}' +
    '#cb-gate .cb-g{width:24px;height:24px;border-radius:50%;background:#fff;display:grid;place-items:center;flex:none}' +
    '#cb-gate .cb-g svg{width:15px;height:15px}' +
    '#cb-gate .cb-ghost{background:transparent;color:#f2efe7;box-shadow:inset 0 0 0 1px #3a3a40}' +
    '#cb-gate .cb-link{background:none;box-shadow:none;color:#9b978d;font-size:13px;letter-spacing:.04em;text-transform:none;' +
      'font-family:inherit;font-weight:500;padding:4px;text-decoration:underline;justify-self:center}' +
    '#cb-gate .cb-err{color:#ff6b61;font-size:13.5px}' +
    '#cb-gate .cb-fine{font-size:12px;color:#6f6c66}' +
    '#cb-gate .cb-radar{position:relative;width:132px;height:132px;margin:0 auto 2px;display:grid;place-items:center}' +
    '#cb-gate .cb-radar .cb-logo{position:relative;z-index:1;width:92px}' +
    '#cb-gate .cb-radar span{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(246,185,18,.6);' +
      'animation:cbPing 2.7s cubic-bezier(.2,.8,.2,1) infinite}' +
    '#cb-gate .cb-radar span:nth-child(2){animation-delay:.9s}' +
    '#cb-gate .cb-radar span:nth-child(3){animation-delay:1.8s}' +
    '#cb-gate .cb-live{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-size:12.5px;letter-spacing:.08em;' +
      'text-transform:uppercase;color:#86b36f}' +
    '#cb-gate .cb-live::before{content:"";width:7px;height:7px;border-radius:50%;background:#86b36f;animation:cbDot 2s ease-out infinite}' +
    '#cb-gate .cb-ok{width:92px;height:92px;margin:6px auto 4px;border-radius:50%;background:#86b36f;display:grid;place-items:center;' +
      'box-shadow:0 0 0 10px rgba(134,179,111,.15),0 20px 50px -10px rgba(134,179,111,.6);animation:cbPop .6s cubic-bezier(.34,1.56,.64,1) both}' +
    '#cb-gate .cb-ok path{stroke-dasharray:40;stroke-dashoffset:40;animation:cbDraw .5s ease-out .3s forwards}' +
    '#cb-gate.cb-out{opacity:0;pointer-events:none}' +
    '#cb-gate.cb-out .cb-card{transform:translateY(-14px) scale(.97);transition:transform .45s ease}' +
    '@keyframes cbIn{from{opacity:0;transform:translateY(22px) scale(.97)}}' +
    '@keyframes cbBrush{from{opacity:0;transform:translateY(-22px) rotate(-7deg) scale(1.15)}}' +
    '@keyframes cbSlash{from{opacity:0;clip-path:polygon(0 0,0 0,0 100%,0 100%)}}' +
    '@keyframes cbDrift{from{transform:scale(1.06) translate(-1.5%,-1%)}to{transform:scale(1.14) translate(1.5%,1.2%)}}' +
    '@keyframes cbPing{from{transform:scale(.5);opacity:1}to{transform:scale(1.25);opacity:0}}' +
    '@keyframes cbDot{0%{box-shadow:0 0 0 0 rgba(134,179,111,.7)}80%,100%{box-shadow:0 0 0 8px rgba(134,179,111,0)}}' +
    '@keyframes cbPop{from{transform:scale(0)}}' +
    '@keyframes cbDraw{to{stroke-dashoffset:0}}' +
    '@media (max-width:380px){#cb-gate .cb-60,#cb-gate .cb-days{font-size:54px}#cb-gate .cb-card{padding:26px 20px 20px}}' +
    '@media (prefers-reduced-motion:reduce){#cb-gate *,#cb-gate::before{animation:none!important;transition:none!important}' +
      '#cb-gate .cb-ok path{stroke-dashoffset:0}}';

  var GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.6z"/>' +
    '<path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/>' +
    '<path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';

  function gate(parts, state) {
    if (!gateEl) {
      gateEl = document.createElement("div");
      gateEl.id = "cb-gate";
      gateEl.setAttribute("role", "dialog");
      gateEl.setAttribute("aria-modal", "true");
      gateEl.innerHTML = "<style>" + GATE_CSS + "</style><div class=\"cb-card\"></div>";
      document.body.appendChild(gateEl);
    }
    gateEl.setAttribute("data-state", state || "plain");
    var card = gateEl.querySelector(".cb-card");
    card.textContent = "";
    /* restart the card's entrance for each new state */
    card.style.animation = "none"; void card.offsetWidth; card.style.animation = "";
    parts.forEach(function (n) { card.appendChild(n); });
    return card;
  }

  /* Fade the gate away and tell the page, so it can raise its own curtain. */
  function closeGate() {
    if (!gateEl) return;
    var g = gateEl; gateEl = null;
    g.classList.add("cb-out");
    try { window.dispatchEvent(new Event("cb-open")); } catch (e) { /* old browser */ }
    setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 480);
  }

  function logo() {
    var i = document.createElement("img");
    i.src = "eagle.png"; i.alt = ""; i.className = "cb-logo";
    i.onerror = function () { i.remove(); };
    return i;
  }
  function brushTitle() {
    var h = node("div", null, "cb-hero");
    h.setAttribute("aria-hidden", "true");
    h.innerHTML = '<span class="cb-60">60</span><span class="cb-days">Days</span><br><span class="cb-chal">Challenge</span>';
    return h;
  }
  function radar() {
    var r = node("div", null, "cb-radar");
    r.innerHTML = "<span></span><span></span><span></span>";
    r.appendChild(logo());
    return r;
  }
  function coach() { return CONFIG.coachName || "your coach"; }

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
    var btn = node("button");
    btn.type = "button";
    btn.innerHTML = '<span class="cb-g">' + GOOGLE_G + '</span><span>Sign in with Google</span>';
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
      logo(),
      node("h2", CONFIG.title, "cb-sr"),
      brushTitle(),
      node("p", CONFIG.blurb),
      btn,
      err,
      node("p", "Your name and email are only shown to " + coach() + ".", "cb-fine")
    ], "signin");
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
    var parts = [];
    if (denied) {
      parts.push(logo(), node("h2", "Not on this challenge"),
        node("p", "You're not on the squad right now. If that's a mistake, talk to " + coach() + "."));
    } else {
      var p = node("p");
      p.appendChild(document.createTextNode("Your request is with "));
      p.appendChild(node("b", coach()));
      p.appendChild(document.createTextNode(". Keep this page open — it lets you in by itself the moment you're approved."));
      parts.push(radar(), node("h2", "Access requested"), p, node("div", "Waiting for approval", "cb-live"));
    }
    if (me.email) parts.push(node("p", "Signed in as " + me.email, "cb-fine"));

    if (!denied) {
      var again = node("button", "Check again", "cb-ghost");
      again.type = "button";
      again.onclick = function () { location.reload(); };
      parts.push(again);
      /* Live: the moment the coach approves, celebrate, then let them in. */
      try {
        var let_in = false;
        store.onSnapshot(store.doc(FS, "members/" + me.uid), function (s) {
          if (let_in || !s.exists() || s.data().status !== "approved") return;
          let_in = true;
          welcome();
        }, function () {});
      } catch (e) { /* ignore */ }
    }

    var out = node("button", "Sign out", "cb-link");
    out.type = "button";
    out.onclick = function () { auth.signOut(A).then(function () { location.reload(); }); };
    parts.push(out);
    gate(parts, denied ? "denied" : "wait");
  }

  function welcome() {
    var ok = node("div", null, "cb-ok");
    ok.innerHTML = '<svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" ' +
      'stroke="#0b0b0c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    gate([ok, node("h2", "You're in."), node("p", "Welcome to the squad. Loading your board…")], "ok");
    try { if (navigator.vibrate) navigator.vibrate([14, 50, 22]); } catch (e) { /* ignore */ }
    setTimeout(function () { location.reload(); }, 1500);
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
          /* merge into an existing record: changes only the fields given */
          update: function (body) {
            return store.updateDoc(ref, body).catch(function (e) { throw translate(e); });
          },
          get: function () {
            return store.getDoc(ref).then(function (s) {
              return { id: s.id, exists: s.exists(), data: function () { return s.data(); } };
            });
          }
        };
      },
      /* several writes as one: all land, or none do, in one round trip */
      batch: function (ops) {
        var bt = store.writeBatch(FS);
        ops.forEach(function (o) {
          var ref = store.doc(FS, o.path);
          if (o.op === "update") bt.update(ref, o.data);
          else if (o.op === "delete") bt.delete(ref);
          else bt.set(ref, o.data);
        });
        return bt.commit().catch(function (e) { throw translate(e); });
      },
      collection: function (name) {
        function listen(q) {
          return function (cb, errcb) {
            return store.onSnapshot(q, { includeMetadataChanges: true }, cb, function (e) {
              if (errcb) errcb(e && e.code === "permission-denied" ? { code: "revoked" } : e);
            });
          };
        }
        var ref = store.collection(FS, name);
        return {
          onSnapshot: listen(ref),
          /* e.g. an athlete's own proofs: the rules refuse the whole collection */
          where: function (field, op, value) {
            return { onSnapshot: listen(store.query(ref, store.where(field, op, value))) };
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
        "and proof photos are deleted.\n\nYou can let them back in later, but " +
        "they would start again from day 1.")) return;
      btn.disabled = true;
      /* their proof photos go too: nobody should keep them once they've left */
      store.getDocs(store.query(store.collection(FS, "proofs"), store.where("uid", "==", uid)))
        .then(function (snap) {
          return Promise.all(snap.docs.map(function (d) {
            return Promise.all([store.deleteDoc(store.doc(FS, "proofImages/" + d.id)),
                                store.deleteDoc(store.doc(FS, "proofs/" + d.id))]);
          }));
        }).catch(function () { /* nothing to clear */ })
        .then(function () { return store.deleteDoc(store.doc(FS, "progress/" + uid)); })
        .catch(function () { /* may not exist */ })
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
      /* Tell the page who's on the challenge: some approved athletes have no
         progress record yet, and the coach's check-in list needs them too.  */
      try {
        window.dispatchEvent(new CustomEvent("cb-members", { detail: active.map(function (e) {
          return { id: e.id, name: e.m.name || "" }; }) }));
      } catch (err) { /* old browser */ }
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
