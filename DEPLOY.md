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
  ownerEmails: ["coach@gmail.com"],   // <- whoever approves athletes
  coachName: "Raji",                  // <- their first name, shown to athletes
  …
};
```

`ownerEmails` is **the Google account of whoever runs the challenge** — not
necessarily you. See *[If a friend is the coach](#if-a-friend-is-the-coach)*
below. `coachName` is only cosmetic: it's the name athletes see in
*"Ask Raji to approve you"* and on the admin panel badge.

> These values are **not secrets**. Every Firebase web app ships them in plain
> sight; they only identify the project. What actually protects your data is
> `firestore.rules` plus the authorised-domains list in step 6.

Then put the **same owner email(s)** in `firestore.rules`:

```
function owners() {
  return ['coach@gmail.com'];
}
```

Both lists must match exactly. If an email is in `claude-bridge.js` but not in
`firestore.rules`, that person sees the approvals panel but every approval
fails to save — the rules are the real authority, the panel is just the button.

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

> ⚠️ **Use plain `firebase deploy` after changing who the owner is.**
> `firebase deploy --only hosting` publishes the page but *not* the rules, and
> the owner lives in both files. Deploy one without the other and the page lets
> the coach in while the server refuses everything they do - a "View only"
> badge and nothing saved. To publish both explicitly:
> `firebase deploy --only hosting,firestore:rules`

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

## If a friend is the coach

Deploying and running the challenge are two separate jobs, and they don't have
to be the same person.

**You, deploying.** You own the Firebase project, you paste the config, you run
`firebase deploy`. You need a Google account for the Firebase console. Your
email does **not** have to be in `ownerEmails`.

**Your friend, coaching.** They need a Google account and nothing else — no
Firebase console, no GitHub, no install. Put *their* Google address in the two
lists in step 4 and their name in `coachName`. When they open the link and sign
in, they're recognised as owner, approved automatically without asking anyone,
and they get both panels: **Access requests** and **Admin · Assign levels**.

So, concretely:

```js
ownerEmails: ["raji@gmail.com"],   // your friend
coachName: "Raji",
```

```
function owners() {
  return ['raji@gmail.com'];
}
```

**Worth listing yourself too.** Anyone in both lists gets the same powers, so:

```js
ownerEmails: ["raji@gmail.com", "sleimenmhanna@gmail.com"],
```

```
function owners() {
  return ['raji@gmail.com', 'sleimenmhanna@gmail.com'];
}
```

That way you can confirm the approvals panel actually works without waiting on
them, and nobody is locked out if your friend loses access to their account.
There's no hierarchy — a second owner can approve, assign levels, and edit the
lists the same as the first.

**Make sure it's the right address.** It has to be the account they really sign
in with. A Gmail address and a Google Workspace address for the same person are
different accounts here, and an address that was never a Google account can't
sign in at all. If they sign in and *don't* see the approvals panel, that
mismatch is almost always why — check the email they're signed in as against
the two lists.

**Changing coach later** means editing both lists and redeploying:

```bash
firebase deploy --only hosting,firestore:rules
```

Approved athletes and their progress are untouched by that.

---

## Running the challenge

**Inviting people.** Send the link. Nothing else. There's no invite list to
maintain.

**What they see.** A sign-in screen, then *"Access requested — your coach has
been asked to add you."* They can leave the page; it lets them in by itself the
moment you approve.

**Approving.** The coach opens the link. Because their email is in
`ownerEmails`, they get a **Squad admin** panel above the board, with each
person's name and email under one of three headings:

| Heading | Who | Buttons |
|---|---|---|
| Access requests | signed in, waiting | **Approve** / **Deny** |
| On the challenge | approved athletes | **Take off** |
| Not on the challenge | denied or taken off | **Let back in** |

Approve, and they land on the board on their next look - no reload needed if
they're sitting on the waiting screen.

**Proof photos: how a day gets done.** Athletes can't tick their own days.
They tap today and send a photo of the workout, with an optional note. The coach sees it under **Proof to review** and taps
**Approve**, which marks the day done for them, or **Reject** with a reason
they'll see. They can then send another photo. Future days stay locked for
athletes. The coach ticks his own days directly, with no photo.

Photos are shrunk on the phone before sending (to about 1280 px, usually
150-400 KB) and stored in Firestore next to the rest of the data. Only the
athlete who sent a photo and the coach can see it. When the coach takes
someone off the challenge, their photos are deleted too.

Storage: Firestore's free tier holds 1 GB. Ten athletes sending a photo every
day for 60 days is roughly 600 photos, around 150-250 MB, so it fits with room
to spare. Firebase's separate file-storage service was deliberately not used:
new projects need a billing account for it.

**Today only, double days, three strikes.**

- **Proof can only be sent on the day itself.** Past days and future days are
  locked for athletes. The same goes for admins' own days. Another admin can
  fix a past day for them.
- **A missed day doubles the next one.** A day is missed once it ends without
  being approved. A proof sent on time and still waiting for review does not
  count, but a rejected one does. The next day's workout shows "×2": double
  the distance, the reps, the dragon flags and the core times, or a double
  hike.
- **Three missed days and you're off the challenge.** The athlete's own page
  says so at once. The removal itself (status "out", their record and photos
  deleted) happens the next time either admin opens the site. Admins are
  never removed automatically. The athlete sees "Off the challenge", and an
  admin can still **Let back in** from Squad admin.
- **These rules are never retroactive.** They start the day after an admin
  first opens the version that has them. That date is saved once, as
  `rulesFrom` in `progress/_levels`. Days before it never count as missed.
- **"Today" follows the challenge's time zone,** Lebanon (`Asia/Beirut`), and
  the real date rather than the phone's clock. The rules accept a day at
  UTC+2 or UTC+3, because they can't follow daylight saving, so the server
  gives a one-hour margin around midnight. The page itself is exact. If the
  squad moves elsewhere, change `CONFIG.timeZone` in `public/claude-bridge.js`
  and `tzMin()` and `tzMax()` in `firestore.rules`.
- **There's no midnight job.** The free plan has no server running on a
  schedule, which would need Cloud Functions and a billing account. So the
  rules are kept by whoever looks: the athlete's own page and the admins'
  pages.

**Ticking or unticking anyone's day.** In **Admin · Athletes**, **Days** opens
that athlete's 60 days. Tap any day, past, today or ahead, to mark it done or
not done. Ticking a day that has a photo waiting also approves the photo.
Unticking an approved day withdraws its approval.

**Days open by the real date, not the phone's.** Day 1 is the start date, and
each later day opens at midnight. The page takes the date from your web
server, so setting a phone to next month unlocks nothing; it even tells the
athlete their phone's date is off. The database rules check again with
Google's clock, allowing 14 hours for time zones. That applies to the coach's
own days too: as a player, he can't tick his own future days. He can still
tick or untick any day for anyone else.

**Start dates.** An athlete sets their own start date once, when they begin.
After that, only the coach can change it. Otherwise "today" could be slid
forward to unlock days early.

**Who hasn't checked in today.** The coach's **Today's check-in** panel
lists everyone whose day hasn't been ticked yet. It shows which day each
person is on and that day's workout, with whoever has missed the most days
first. Below that are who's done today, and anyone not counted: no start date
yet, starting later, or finished. **Copy reminder for the group** puts a
ready-made message on the clipboard to paste into your group chat. "Today"
follows each athlete's own start date, and the list rolls over at midnight.

**Start dates.** In **Admin · Athletes**, the coach can set or move anyone's
start date. Only the date changes; their ticked days keep their numbers. This
works even for someone approved who hasn't opened the page yet: the date is
waiting for them when they first sign in.

**Assigning plans.** Below that is the **Admin · Assign levels** panel, same
owners only. Everyone starts on Beginner; tap Advanced for whoever earns it. They switch
plans immediately.

**Taking someone off.** Someone who stops training sits on the squad board at
3 / 60 forever. **Take off** next to their name, under *On the challenge*, asks
you to confirm and then:

- sets their status to denied, so they lose access on their next visit and see
  *"Not on this challenge"*
- deletes their `progress/` record, so they come off everyone's board

Their ticked days are cleared by that second step. It has to be: every athlete
can read the whole `progress` collection, so there is no way to hide a record
from the board while leaving it in the database.

They move to **Not on the challenge**, where **Let back in** restores access -
but they start again from day 1, since the ticks are gone. If someone is only
pausing, leave them alone rather than taking them off.

The coach's own row has no button; an owner who removed themselves would lock
the panel away from everyone.

## What's stored

| Collection | Holds | Who can write it |
|---|---|---|
| `members/{uid}` | join request: name, email, status (pending / approved / denied) | the person creates their own *pending*; only an owner changes it |
| `names/{uid}` | display name, for labelling the board | that person only |
| `progress/{uid}` | their approved days + start date | the owner marks days; the athlete only sets their start date, once |
| `proofs/{uid_day}` | a proof's status, note, and the coach's reason | the athlete sends it as *pending*; only the owner approves or rejects |
| `proofImages/{uid_day}` | the photo | the athlete who sent it; readable only by them and the owner |
| `progress/_levels` | Beginner/Advanced per athlete | you only |

Nobody can mark their own day done, approve their own photo, tick a day for
somebody else, see a teammate's photo, approve themselves or promote
themselves. All of that is enforced in `firestore.rules`, on Firebase's
servers, not in the page. A modified page can't get around it.

**Testing the rules.** `tests/rules.test.js` checks all of that (84 cases, including today-only and the date checks)
against Google's real Firestore emulator. Re-run it after any edit to
`firestore.rules` (it needs Java):

```bash
npm install
```

```bash
npm run test:rules
```

The GitHub workflow runs it before every deploy and refuses to deploy if it
fails.

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
