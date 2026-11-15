# Deploying the 60 Days Challenge

The page needs three things to work the way you want: somewhere to serve the
files, a way for people to sign in, and a database so everyone sees everyone
else's ticks. **Firebase gives you all three in one project, free at this
size**, and it's the only step-by-step below. Other hosts are covered at the
bottom, along with why plain GitHub Pages can't do this on its own.

End result: a link like `https://eagle-strength-60.web.app` (or your own
domain). You send it to anyone. They sign in, you get an approval request, you
tap Approve, they're in.

Budget about 20 minutes for the first deploy.

---

## 1. Create the project

1. Go to <https://console.firebase.google.com> and **Add project**.
2. Name it something like `eagle-strength-60`. Google Analytics: not needed, turn it off.
3. Note the **Project ID** it gives you (e.g. `eagle-strength-60`) — you'll need it twice.

## 2. Turn on Google sign-in

In the left sidebar: **Build → Authentication → Get started**.

1. Pick **Google** from the provider list, toggle **Enable**.
2. Pick a support email (yours), **Save**.

Google sign-in is the friendliest option — no passwords, no invite emails to
manage, and most people are already signed in to a Google account on their
phone. (Email-link sign-in also works if you'd rather; see *Variations*.)

## 3. Create the database

**Build → Firestore Database → Create database**.

1. Choose a location close to you (e.g. `europe-west1`) — this cannot be changed later.
2. Start in **production mode**. The real rules get deployed from this repo in step 5, so don't worry about the default lockdown.

## 4. Paste your config into the repo

**Project settings** (gear icon) **→ General →** scroll to **Your apps →**
click the web icon `</>` → give it a nickname → **Register app**.

Firebase shows you a `firebaseConfig` block. Copy those values into
`public/claude-bridge.js`, replacing the `PASTE_…` placeholders:

```js
var CONFIG = {
  firebase: {
    apiKey:            "AIzaSy…",
    authDomain:        "eagle-strength-60.firebaseapp.com",
    projectId:         "eagle-strength-60",
    storageBucket:     "eagle-strength-60.firebasestorage.app",
    messagingSenderId: "1234567890",
    appId:             "1:1234567890:web:abc123"
  },
  ownerEmails: ["your.google.account@gmail.com"],   // <- you, the coach
  …
};
```

> These values are **not secrets**. Every Firebase web app ships them in plain
> sight; they only identify the project. What actually protects your data is
> `firestore.rules` plus the authorised-domains list in step 6.

Then put the **same owner email** in `firestore.rules`:

```
function owners() {
  return ['your.google.account@gmail.com'];
}
```

Both places must match, or you'll be able to see the approvals panel but not
save anything. Add more emails to both lists if you want a second coach.

## 5. Deploy

Install the CLI once:

```bash
npm install -g firebase-tools
```

Then from the repo root:

```bash
firebase login
```

```bash
firebase use --add
```

```bash
firebase deploy
```

Pick your project when `firebase use --add` asks, and give it the alias
`default`. The deploy prints your live URL:

```
Hosting URL: https://eagle-strength-60.web.app
```

That's your link. It also publishes `firestore.rules`, so the database is
locked down from the first second.

## 6. Authorise the domain

**Authentication → Settings → Authorised domains.** `*.web.app` and
`*.firebaseapp.com` are there by default, so the link above already works. Add
your own domain here too if you do step 7 — sign-in fails with
`auth/unauthorized-domain` until you do.

## 7. Your own domain (optional)

**Hosting → Add custom domain**, enter e.g. `60days.yourdomain.com`, and add the
DNS records it shows you at your registrar. The certificate is issued
automatically and takes anywhere from a few minutes to a day. Then add that
domain in step 6.

## 8. Deploy from GitHub instead (optional)

`.github/workflows/deploy.yml` redeploys on every push to `main`. To arm it:

1. In the Google Cloud console for the same project: **IAM & Admin → Service
   accounts → Create service account**. Grant it **Firebase Hosting Admin**,
   **Cloud Datastore Owner** and **Firebase Rules Admin**.
2. **Keys → Add key → JSON**, download it.
3. In GitHub: **Settings → Secrets and variables → Actions**
   - **New repository secret** `FIREBASE_SERVICE_ACCOUNT` — paste the entire JSON file contents.
   - **Variables** tab → **New variable** `FIREBASE_PROJECT_ID` — your project ID.

The workflow refuses to deploy while the placeholders from step 4 are still in
the files, so a half-configured push fails loudly instead of shipping a broken
page.

---

## Running the challenge

**Inviting people.** Send the link. Nothing else. There's no invite list to
maintain.

**What they see.** A sign-in screen, then *"Access requested — your coach has
been asked to add you."* They can leave the page; it lets them in by itself the
moment you approve.

**Approving.** Open the link yourself. Because your email is in `ownerEmails`,
you get an **Access requests** panel above the squad board, with each person's
name and email and **Approve** / **Deny**. Approve, and they land on the board
on their next look.

**Assigning plans.** Below that is the existing **Admin · Assign levels** panel.
Everyone starts on Beginner; tap Advanced for whoever earns it. They switch
plans immediately.

**Removing someone.** Set them back to Denied in Firestore
(`members/<their-id>`, `status: "denied"`), or delete the document. Their
ticks stay in `progress/` until you delete that too.

## What's stored

| Collection | Holds | Who can write it |
|---|---|---|
| `members/{uid}` | join request: name, email, status | the person creates their own *pending*; only you change it |
| `names/{uid}` | display name, for labelling the board | that person only |
| `progress/{uid}` | their ticked days + start date | that person only |
| `progress/_levels` | Beginner/Advanced per athlete | you only |

Nobody can tick a day for somebody else, approve themselves, or promote
themselves — those are enforced in `firestore.rules`, server-side, not in the
page.

## Cost

The free Spark plan covers this comfortably: Firestore's free tier is 50,000
document reads and 20,000 writes a day, and a squad of ten ticking a day each
is a few hundred. Hosting's free tier is 10 GB of transfer a month; this page
is about 320 KB, nearly all of it the poster image. You do not need a card.

---

## Variations

**Email-link sign-in instead of Google.** Enable *Email link (passwordless
sign-in)* in step 2, then in `public/claude-bridge.js` swap the
`signInWithPopup` / `GoogleAuthProvider` call in `askToSignIn` for
`sendSignInLinkToEmail` + `signInWithEmailLink`. Slightly more code, no Google
account needed.

**Approving without opening Firestore.** The approvals panel is the normal way,
but you can always edit `members/<uid>.status` by hand in the Firebase console
under **Firestore Database → Data**.

## Other hosts

The page itself is three static files, so *serving* it is easy anywhere. The
part that isn't portable is sign-in plus the shared database — that's what
`claude-bridge.js` provides against Firebase.

- **Netlify / Vercel / Cloudflare Pages + Firebase.** Fine, and no code changes:
  point the host at the `public/` directory and keep using Firebase for auth and
  Firestore. You lose the single `firebase deploy` and have to add your new
  domain to Firebase's authorised domains (step 6). Pick this if you already
  live on one of those.
- **Vercel + Supabase.** A reasonable alternative stack, but it's real work:
  Supabase's realtime API doesn't match the `onSnapshot` shape the page uses, so
  `claude-bridge.js` has to be rewritten, and the rules become row-level
  security policies. Only worth it if you want Postgres for other reasons.
- **GitHub Pages alone — won't work.** Pages serves static files and nothing
  else: no accounts, no database, no way to approve anyone. Deployed there as-is
  the page opens in "Not saving" mode, every visitor sees an empty board, and
  ticks vanish on reload. You can host the files on Pages *and* use Firebase for
  auth and data (same as the Netlify note above), but Pages by itself cannot do
  the access requests you're after.
