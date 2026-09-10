# Waha Admin — Preview Run Doc

SvelteKit 2 + Svelte 5 + Tailwind v4 + Supabase. Dev server via Vite.

## Artifacts a fresh checkout needs

1. **Install dependencies** (npm; lockfile `package-lock.json` present):

   ```bash
   npm install
   ```

2. **Environment file `.env`** — git-ignored, must exist at the project root.
   Copy it from the main checkout (never symlink; adapt values if needed):

   ```bash
   cp <main-checkout>/.env .env
   ```

   Required keys (values live only in `.env`, never in the repo):

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

3. Nothing else is generated — `.svelte-kit/` is produced automatically by
   `vite dev` / `npm run check`.

## Run the server

**Port: 5174** (5173 is the user's own long-running dev server for this same
project — do not touch it).

> ⚠️ **On this machine, the agent's command runner reaps detached background
> processes** — `{ nohup … & disown; }` and even `setsid` die within seconds
> (silently, empty logs). Verified 2026-09-09. Use the systemd user manager
> instead; it is immune because the unit is owned by systemd, not the runner.

Launch (detached, survives the conversation):

```bash
systemd-run --user --unit=waha-preview --collect \
  --working-directory=/home/ziro/Documents/Waha/Waha-dashboard \
  bash -lc 'exec npm run dev -- --port 5174 --strictPort > /home/ziro/Documents/Waha/Waha-dashboard/.freebuff/preview-<id>.log 2>&1 < /dev/null'
```

Then:

```bash
# readiness (wait for "ready" in the log / HTTP 200)
systemctl --user is-active waha-preview.service
curl -sf http://localhost:5174/ -o /dev/null && echo ok

# main pid (for register_preview)
systemctl --user show -p MainPID --value waha-preview.service

# stop / restart
systemctl --user stop waha-preview.service
systemctl --user restart waha-preview.service   # after re-running systemd-run if stopped

# logs (stdout+stderr of the unit)
journalctl --user -u waha-preview.service -n 50 --no-pager
```

- URL: `http://localhost:5174`
- Useful checks: `npm run check` (svelte-check), `npm run build` (Cloudflare adapter)
- Note: the unit name `waha-preview` is reusable; `systemd-run` fails with
  "already loaded" if a stale unit exists — `systemctl --user stop waha-preview`
  first (it was created with `--collect`, so it also self-cleans on failure).
