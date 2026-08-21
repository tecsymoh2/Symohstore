# Symoh Store — Documentation

A personal, installable, offline-capable web app for storing images, videos, and files with password-protected share links. Built as a single-page app backed by Supabase (auth, database, storage).

---

## 1. Overview

- **Login:** single fixed account — username `Symoh`, password `87dm654ls`
- **Core loop:** log in → ship a "parcel" (image / video / file, uploaded or linked) → get a share link + QR code → anyone with the link and its password can view it
- **Storage:** files live in a Supabase Storage bucket; metadata lives in a Postgres table
- **Offline:** installable as a PWA, works without a connection, queues uploads made offline
- **Theme:** a warehouse/parcel visual metaphor (kraft paper, crate brown, stamp red, tracking codes)

---

## 2. File structure

```
symoh-store/
├── index.html            All markup, styles, and app logic (single file)
├── manifest.webmanifest  PWA metadata (name, icons, colors, display mode)
├── sw.js                 Service worker (offline caching, background sync)
├── vercel.json           Deployment headers (sw.js cache-busting, manifest MIME type)
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    ├── icon-192-maskable.png
    └── icon-512-maskable.png
```

Everything except the icons lives in one HTML file for simplicity — there's no build step, bundler, or framework. It's vanilla JS.

---

## 3. Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Backend | Supabase (Postgres + Auth + Storage) |
| Client library | `@supabase/supabase-js@2` (via unpkg CDN) |
| Zip/export | `JSZip` (via cdnjs CDN) |
| QR codes | `qrcodejs` — generated entirely client-side, no external API (via cdnjs CDN) |
| Offline storage | IndexedDB (for the upload queue) |
| Fonts | Google Fonts — Oswald (headers), JetBrains Mono (codes), Work Sans (body) |

No server-side code of your own — Supabase is the entire backend, accessed directly from the browser using the public anon key. Security is enforced through Postgres Row Level Security (RLS) and two `SECURITY DEFINER` functions (see §6).

---

## 4. Supabase project

- **Project name:** `symoh-store`
- **Project ref:** `uivlfniqirbmuxjbbwis`
- **Region:** `us-east-1`
- **Dashboard:** https://supabase.com/dashboard/project/uivlfniqirbmuxjbbwis

> Note: an earlier, now-unused project (`fixlqmbkornjwqleeufe`) also exists in the same Supabase org from a prior setup — it's not connected to the site and can be safely deleted.

### 4.1 Database schema

**`public.posts`** — one row per parcel

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `share_id` | text, unique | random 10-char code, auto-generated |
| `media_type` | text | `image` \| `video` \| `file` |
| `source` | text | `upload` \| `link` |
| `media_url` | text | public storage URL or pasted link |
| `thumb_url` | text, nullable | resized JPEG thumbnail (images only) |
| `file_name` | text, nullable | original filename (upload only) |
| `file_size` | bigint, nullable | bytes (upload only) |
| `tags` | text[] | defaults to `{}` |
| `description` | text | |
| `expires_at` | timestamptz, nullable | share link stops working after this |
| `deleted_at` | timestamptz, nullable | soft-delete marker (trash) |
| `password_hash` | text, nullable | bcrypt hash via `pgcrypto`; null = legacy fallback |
| `created_by` | uuid | references `auth.users.id` |
| `created_at` | timestamptz | |

**`public.share_attempts`** — password rate-limiting log

| Column | Type |
|---|---|
| `id` | bigint identity, PK |
| `share_id` | text |
| `attempted_at` | timestamptz |

No RLS policies exist on this table — it's only ever touched by the `get_shared_post` function running as its owner, so nothing can read or write it directly.

### 4.2 Row Level Security

- `posts` has RLS enabled with one policy: **owner full access** — `auth.uid() = created_by`, applied to all operations (select/insert/update/delete). The logged-in Symoh account can only ever see and touch its own rows.
- Public visitors (anonymous) have **no direct read access** to `posts` at all — the old "anyone can read" policy was deliberately removed. All public viewing goes through the function below.

### 4.3 Database functions

**`get_shared_post(p_share_id text, p_password text) returns jsonb`**
`SECURITY DEFINER`, callable by `anon` and `authenticated`. This is the only way an outside visitor can ever see a parcel's data:
1. Purges attempt-log rows older than 15 minutes.
2. If 5+ attempts against this `share_id` in the last 15 minutes → returns `{"status":"locked","retry_after_minutes":15}`.
3. Looks up the post by `share_id` (must not be soft-deleted, must not be expired). If missing → `{"status":"not_found"}`.
4. Checks the password against `password_hash` (bcrypt via `crypt()`); rows without a hash (legacy) fall back to comparing against the literal `"Techn"`.
5. Wrong password → logs an attempt, returns `{"status":"wrong_password","attempts_left":N}`.
6. Correct password → returns `{"status":"ok","post":{...}}` (with `password_hash` stripped out of the returned object).

**`set_share_password(p_post_id uuid, p_password text) returns void`**
`SECURITY DEFINER`, callable by `authenticated` only. Hashes the given password with `crypt(p_password, gen_salt('bf'))` and stores it on the specified post — but only if `created_by = auth.uid()`, so you can only set passwords on your own parcels. Called automatically after every ship (with whatever password you typed, defaulting to `"Techn"`), and again from the Edit modal if you enter a new one.

### 4.4 Storage

- **Bucket:** `symoh-store`, public
- **Policies:** anyone can `SELECT` (read) objects in the bucket; only `authenticated` requests can `INSERT`/`UPDATE`/`DELETE`
- Files are stored under `{user_id}/{timestamp}-{index}-{filename}`; image thumbnails under `{user_id}/thumb-{timestamp}-{index}-{filename}.jpg`
- "Public" here means *unlisted*, not listed/searchable — someone would need the exact URL (which isn't exposed anywhere except through a correctly-unlocked share link) to access a file directly

### 4.5 Auth

- One user exists: `symoh@symohstore.app`, created directly via SQL (not through normal signup) with the password `87dm654ls`
- The login screen asks for "Handler ID" (`Symoh`) and "Access Code" — the client maps the username to that fixed email before calling `signInWithPassword`

---

## 5. Features

### Core
- Ship an **image, video, or file** — either upload from device (single or multiple, with drag-and-drop) or paste an external link
- YouTube links are auto-detected and embedded as a proper player (both `youtube.com/watch?v=` and `youtu.be/` formats)
- Add a **description** and **tags**
- Set a per-parcel **share password** (defaults to `Techn`, override anytime)
- Set an **expiry** (never / 1 / 7 / 30 days) — expired links stop opening for viewers and show an "EXPIRED" badge on your own dashboard

### Manifest (dashboard)
- **Search** across description, filename, tags, share code, and type
- **Filter** by type (All / Image / Video / File)
- **Sort** by newest, oldest, or type
- **Stats bar**: total parcels, storage used, last-ship date
- **Bulk select** mode for multi-delete

### Sharing
- Every parcel gets a **share/preview link** (`?item=<code>`) and a **client-generated QR code** — no external QR service is called
- Share links require the parcel's password to view, enforced **server-side** (not just in the page)
- **Rate-limited**: 5 password attempts per share link per 15 minutes, then a temporary lockout

### Media handling
- **Thumbnails**: auto-generated (client-side canvas resize) for uploaded images, used in the grid for faster loading
- **Download**: fetches the actual file as a blob and saves it to your device, rather than just opening it in a browser tab (works around browsers previewing images/PDFs/videos inline instead of downloading them)

### Data safety
- **Trash**: deletes are soft-deletes; recoverable for 30 days via the Trash panel (Restore or Delete forever), auto-purged after that
- **Undo toast**: a 6-second undo appears after every delete (single or bulk)
- **Backup / export**: JSON-only (metadata) or full ZIP (metadata + actual files)
- **Restore**: re-import a `.zip` or `.json` backup — adds parcels as new entries (does not merge/overwrite); restored links always get the password `Techn` since password hashes can't be reversed

### Offline & installable (PWA)
- Installable to your device's home screen / app list (manifest + icons + service worker)
- App shell, recent data, and previously-viewed media are cached for offline browsing
- **Uploads made while offline are queued** (IndexedDB) and shipped automatically once you're back online, with a "Pending sync" section showing queued items
- Best-effort Background Sync API registration for catching up even if the app isn't open when connectivity returns (Chromium browsers)

### Account & session
- **Auto sign-out after 1 minute of inactivity**, unless...
- **"Remember this device"** is checked at login (or toggled anytime from the topbar) — skips the auto sign-out on that browser
- **Dark mode** toggle, preference saved locally

---

## 6. Security model — summary

| Concern | How it's handled |
|---|---|
| Who can log in | One fixed account; only Anthropic/you know the password |
| Who can see your parcels in the dashboard | RLS: only rows where `created_by = auth.uid()` |
| Who can open a share link | Must know the share code **and** that parcel's password, checked server-side |
| Brute-forcing a share password | Locked out after 5 wrong attempts per 15 minutes, tracked in `share_attempts` |
| Password storage | bcrypt hashes only (`pgcrypto`), never plaintext, not even readable by you afterward |
| Raw file URLs | Public but unlisted — not exposed unless a share link is correctly unlocked |
| Session timeout | 1-minute inactivity auto-logout by default, opt-out per device |

**Known limitation:** the Supabase anon key is embedded in the page source (this is normal and expected for Supabase apps — it's what RLS is designed to make safe). Anyone could theoretically call `get_shared_post` directly with a share code and password guesses, but the same rate-limiting applies regardless of how the call is made, since it's enforced in the database function itself.

---

## 7. Deployment

The app is static files — no build step, no server process. Any static host works.

**Vercel (recommended path already set up):**
1. Unzip the project folder, keeping the file layout intact
2. Vercel dashboard → **Add New Project** → drag the folder in (or push to GitHub and import), or via CLI:
   ```
   npm i -g vercel
   cd symoh-store
   vercel --prod
   ```
3. `vercel.json` is already included — it prevents `sw.js` from being cached stale (so PWA updates actually apply) and sets the correct MIME type for the manifest

**Important:** the service worker requires a real `https://` (or `http://localhost`) origin — it will not register when the file is opened directly (`file://`). Install prompts and full offline mode only work once it's actually hosted.

---

## 8. Known limitations

- Share password is per-parcel now, but there's no per-parcel "view count" or "last viewed" tracking yet
- Only images get auto-generated thumbnails — videos and files show a generic icon in the grid
- No albums/folders — organization is via tags and filters only
- Restore always creates new parcels; there's no merge/dedupe against existing ones
- No image crop/rotate or client-side compression before upload yet
- "Remember this device" and dark mode are stored in `localStorage`, so they're per-browser, not synced across devices

---

## 9. Quick reference

| Thing | Value |
|---|---|
| Login | `Symoh` / `87dm654ls` |
| Default share password | `Techn` (editable per parcel) |
| Auto sign-out | 60 seconds idle (toggle in topbar) |
| Trash retention | 30 days |
| Password rate limit | 5 attempts / 15 minutes per share link |
| Supabase project ref | `uivlfniqirbmuxjbbwis` |
