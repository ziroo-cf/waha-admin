import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

/**
 * ─────────────────────────────────────────────────────────────
 *  WAHA · Supabase ADMIN client (SERVER-ONLY)
 * ─────────────────────────────────────────────────────────────
 *
 *  SECURITY CONTRACT
 *  ─────────────────
 *  1. Any module under `src/lib/server/` is stripped from the
 *     client bundle by SvelteKit; importing `$lib/server/...`
 *     from client code is a hard build error. That is the
 *     guarantee that `SUPABASE_SERVICE_ROLE_KEY` never ships
 *     to the browser.
 *  2. We deliberately use `$env/dynamic/private` so the same
 *     code reads the values from Cloudflare Pages environment
 *     variables in production without a rebuild.
 *  3. The service_role key bypasses RLS — every call made with
 *     this client is fully privileged. Keep it behind forms +
 *     actions only, never `fetch()` it from a component.
 * ─────────────────────────────────────────────────────────────
 */

/** Alias matching the spec: every DB modification goes through `supabaseAdmin`. */
export const supabaseAdmin = getServiceRoleClient;

/** Same client, named the way the actions use it. */
export function getSupabaseAdmin(): SupabaseClient {
	return getServiceRoleClient();
}

let client: SupabaseClient | null = null;

/**
 * Lazily creates (and caches) a single Supabase client per
 * server isolate. `getServiceRoleClient()` may only be called
 * from server code (.server.ts files or src/lib/server/**).
 */
export function getServiceRoleClient(): SupabaseClient {
	if (client) return client;

	const url = env.SUPABASE_URL;
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

	if (!url || !serviceRoleKey) {
		// Fail fast with an actionable message instead of an opaque
		// "supabaseUrl is required" deeper inside supabase-js.
		throw new Error(
			'[waha] Missing Supabase environment variables. ' +
				'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
				'in .env (dev) or Cloudflare Pages → Settings → Environment variables (prod).'
		);
	}

	client = createClient(url, serviceRoleKey, {
		auth: {
			// We never use Supabase Auth in the admin panel; persisting a
			// session server-side is pointless and can leak memory across
			// requests in a serverless isolate.
			persistSession: false,
			autoRefreshToken: false,
			detectSessionInUrl: false
		}
	});

	return client;
}
