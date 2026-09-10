import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase';
import type { VideoRow } from '$lib/types';

/**
 * GET /export?format=csv|json&scope=filtered|all&status=…&q=…&category=…
 *
 * Streams the current filtered dataset — or the entire database — as a
 * downloadable CSV or JSON file. Uses the same service-role admin client
 * as the rest of the backend and never exposes the key.
 */

function csvEscape(value: unknown): string {
	const s = value === null || value === undefined ? '' : String(value);
	// Quote when the value contains a separator, quote, newline — or to
	// protect leading characters spreadsheets interpret as formulas.
	if (/[",\n\r]/.test(s) || /^[=+\-@]/.test(s)) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
	const header = columns.map(csvEscape).join(',');
	const lines = rows.map((row) => columns.map((c) => csvEscape(row[c])).join(','));
	// BOM so Excel opens Arabic titles correctly.
	return '\uFEFF' + [header, ...lines].join('\r\n');
}

export const GET: RequestHandler = async ({ url }) => {
	const supabase = getSupabaseAdmin();

	const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
	const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'filtered';

	let query = supabase
		.from('videos')
		.select('id, title, thumbnail, category, status, created_at');

	if (scope === 'filtered') {
		const status = url.searchParams.get('status');
		if (status === 'pending' || status === 'approved') {
			query = query.eq('status', status);
		}
		const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
		if (q) query = query.or(`title.ilike.%${q}%,id.ilike.%${q}%`);
		const category = (url.searchParams.get('category') ?? '').trim().slice(0, 120);
		if (category) query = query.eq('category', category);
	}

	// Export ordered by date of addition (newest first), matching the dashboard.
	const { data, error } = await query
		.order('created_at', { ascending: false, nullsFirst: false })
		.order('id', { ascending: true });

	if (error) {
		console.error('[waha] export: failed →', error.message);
		return new Response(JSON.stringify({ success: false, message: 'فشل تصدير البيانات.' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json; charset=utf-8' }
		});
	}

	const rows = (data ?? []) as VideoRow[];
	const stamp = new Date().toISOString().slice(0, 10);

	if (format === 'json') {
		return new Response(JSON.stringify(rows, null, 2), {
			headers: {
				'Content-Type': 'application/json; charset=utf-8',
				'Content-Disposition': `attachment; filename="waha-videos-${scope}-${stamp}.json"`,
				'Cache-Control': 'no-store'
			}
		});
	}

	const csv = toCsv(
		rows as unknown as Record<string, unknown>[],
		['id', 'title', 'thumbnail', 'category', 'status', 'created_at']
	);
	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="waha-videos-${scope}-${stamp}.csv"`,
			'Cache-Control': 'no-store'
		}
	});
};
