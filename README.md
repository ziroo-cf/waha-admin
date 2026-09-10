# Waha · Admin Dashboard

لوحة تحكم إدارية لمراجعة المحتوى — SvelteKit (SSR) + Supabase + Tailwind CSS v4، جاهزة للنشر على Cloudflare Pages.

An admin moderation dashboard for the **Waha** media streaming app: review pending
videos, approve them or delete them — fully server-rendered, no client-side API
calls, service-role key never leaves the server.

## Features

- 🏷 **Category editing** — inline `<select>` on every card, populated with the
  distinct categories already in the database; an empty choice clears the
  category (SQL NULL). Changes go through `?/set-category`.
- 🎯 **Group selection** — per-card checkboxes + "تحديد الكل"; a floating
  action bar offers bulk **approve** (`?/approve-selected`) and bulk **delete**
  (`?/delete-selected`) with a confirm dialog. Selection survives tab switches
  and searches; it clears after a successful bulk action.
- 📊 **Live stats bar** — total / pending / approved counts on every load
- 🗂 **Two tabs** — Pending queue (oldest first) and Recently approved (latest 60)
- 🔍 **Instant search** — filters both tabs by title, video id, or category (client-side)
- ✅ **Approve** a single video, ⚡ **bulk-approve all** pending in one round-trip
- ↩ **Revert** an approved video back to pending (undo mistakes)
- 🗑 **Delete** with a confirmation dialog
- 🔔 **Toast feedback** for every action, per-card spinners, double-submit guards
- 🖥 **Mature admin UI** — dense icon-based cards, 4-column grid on wide
  screens, SVG icons, blue ring on selected cards
- 📱 **Responsive RTL UI** with Arabic-first typography
- 🚫 **No-JS fallback** — every action is a plain HTML form that still works
  without JavaScript

---

## Stack

| Layer     | Tech                                          |
| --------- | --------------------------------------------- |
| Framework | SvelteKit 2 + Svelte 5 (SSR)                  |
| Hosting   | `@sveltejs/adapter-cloudflare` (Pages/Workers) |
| Styling   | Tailwind CSS v4 (via `@tailwindcss/vite`)      |
| Database  | Supabase (PostgreSQL)                          |

---

## 1. Prerequisites

- Node.js **20+**
- A Supabase project with the tables below already created
- A (free) Cloudflare account for deployment

```sql
-- Reference schema (you said it already exists)
create table videos (
  id         text primary key,
  title      text,
  thumbnail  text,
  category   text,
  status     text not null default 'pending'
);
```

## 2. Project setup

```bash
# create the project folder and enter it
mkdir waha-admin && cd waha-admin

# initialize git (optional but recommended)
git init

# install everything
npm install @supabase/supabase-js
npm install -D @sveltejs/kit@latest @sveltejs/adapter-cloudflare@latest \
  @sveltejs/vite-plugin-svelte@latest svelte@latest vite@latest \
  tailwindcss@latest @tailwindcss/vite@latest svelte-check typescript
```

Or, if you are starting from this repository, simply:

```bash
npm install
```

## 3. Environment variables

Copy the template and fill in your values from
**Supabase Dashboard → Project Settings → API**:

```bash
cp .env.example .env
```

```dotenv
SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIs..."   # ⚠️ secret!
```

> **Why the service_role key?** The admin panel is a trusted server context; the
> key bypasses RLS so moderation actions work without per-user policies. It is
> loaded **only** through `$env/dynamic/private` inside `src/lib/server/`, which
> SvelteKit guarantees never to bundle for the client.

## 4. Run locally

```bash
npm run dev          # http://localhost:5173
npm run check        # typecheck (svelte-check)
npm run build        # production build (Cloudflare adapter)
npm run preview      # preview the production build
```

## 5. How it works

```
src/
├── app.css                       # Tailwind v4 entry + Cairo font
├── app.html                      # <html lang="ar" dir="rtl">
├── lib/
│   ├── components/VideoCard.svelte  # shared card (approve/revert/delete)
│   ├── server/supabase.ts           # 🔒 service_role client (server-only)
│   └── types.ts                     # shared VideoRow type
└── routes/
    ├── +layout.svelte
    ├── +page.server.ts           # load() + actions: approve, revert,
    │                             #   approve-all, delete
    └── +page.svelte              # RTL dashboard: stats, tabs, search,
                                  #   bulk approve (use:enhance forms)
```

- **`load()`** — fetches pending + approved lists, total counts, and the
  distinct category list in parallel via the service-role client.
- **`?/approve`** — sets the video's `status = 'approved'`.
- **`?/revert`** — sets the video's `status = 'pending'` (undo).
- **`?/set-category`** — updates (or clears) one video's `category`.
- **`?/approve-all`** — one bulk update flipping every pending video to approved.
- **`?/approve-selected`** — bulk-approves the ids posted from the selection bar.
- **`?/delete-selected`** — bulk-deletes the selected ids (confirm-guarded).
- **`?/delete`** — permanently deletes the video row.
- Both actions are plain `<form method="POST" action="?/...">` progressively
  enhanced with `use:enhance` — they work without JavaScript and update
  in-place with it. After each action `invalidateAll()` re-runs `load`, so the
  queue is always fresh; no client-side `fetch()` anywhere.

## 6. Deploy to Cloudflare Pages

1. Push this repo to GitHub.
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**,
   select the repo.
3. Build settings:
   - **Framework preset:** `SvelteKit`
   - **Build command:** `npm run build`
   - **Build output directory:** `.svelte-kit/cloudflare`
4. **Settings → Environment variables** (Production *and* Preview):

   | Variable                    | Value                        |
   | --------------------------- | ---------------------------- |
   | `SUPABASE_URL`              | `https://YOUR_PROJECT_REF.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | your service_role key        |

5. Deploy. 🎉

> **Rotation note:** if the service_role key ever leaks, rotate it in Supabase
> (Settings → API → Rotate) and update the Pages variable.

## 7. Security checklist

- [x] `SUPABASE_SERVICE_ROLE_KEY` only read via `$env/dynamic/private`
- [x] Supabase client created **only** in `src/lib/server/` (unimportable from the browser)
- [x] No REST endpoints, no client-side `fetch()` — only form actions
- [x] `.env` git-ignored; `.env.example` committed as a template
- [ ] Optional hardening: add Cloudflare Access / basic auth in front of the dashboard,
      since anyone with the URL can moderate content.
