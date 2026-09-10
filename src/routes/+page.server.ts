import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase';
import type { VideoRow, StatusTab, UndoPayload } from '$lib/types';
import { PER_PAGE_OPTIONS } from '$lib/types';

export type { VideoRow };

/**
 * ─────────────────────────────────────────────────────────────
 *  WAHA · Enterprise CMS backend (videos + video_urls)
 * ─────────────────────────────────────────────────────────────
 *  This module runs exclusively on the server (`.server.ts`).
 *  The service-role client never reaches the browser, and all
 *  mutations happen through named form actions — no REST
 *  endpoints and no client-side fetch() calls anywhere.
 * ─────────────────────────────────────────────────────────────
 */

/** Cap on how many ids a bulk action accepts per submission. */
const MAX_BULK_IDS = 200;

/** External content-ingestion worker (Cloudflare Worker). */
const WAHA_FETCH_URL = 'https://waha-fetch.ziroo.workers.dev/';

/** Parse + sanitize a list of video ids from a form field. */
function parseIds(form: FormData, field = 'ids'): string[] {
	const ids = form
		.getAll(field)
		.map((v) => v.toString().trim())
		.filter((id) => id.length > 0);
	return [...new Set(ids)].slice(0, MAX_BULK_IDS);
}

/** Sanitize the `status` URL param into a valid tab (defaults to `pending`). */
function parseTab(raw: string | null): StatusTab {
	return raw === 'approved' || raw === 'all' ? raw : 'pending';
}

/** Sanitize the per-page URL param into one of the allowed sizes. */
function parsePerPage(raw: string | null): number {
	const n = Number(raw);
	return (PER_PAGE_OPTIONS as readonly number[]).includes(n) ? n : 15;
}

/** Sanitize the page number (1-based). */
function parsePage(raw: string | null): number {
	const n = Math.floor(Number(raw));
	return Number.isFinite(n) && n >= 1 ? n : 1;
}

/* ────────────────────────────────────────────────────────────────
 *  LOAD — filtered, searchable, paginated
 * ──────────────────────────────────────────────────────────────── */
export const load: PageServerLoad = async ({ url }) => {
	const supabase = getSupabaseAdmin();

	const tab = parseTab(url.searchParams.get('status'));
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
	const category = (url.searchParams.get('category') ?? '').trim().slice(0, 120) || null;
	const perPage = parsePerPage(url.searchParams.get('perPage'));
	const requestedPage = parsePage(url.searchParams.get('page'));

	// Distinct categories currently in use (feeds every <select> in the UI).
	const categoriesRes = await supabase
		.from('videos')
		.select('category')
		.not('category', 'is', null)
		.limit(1000);
	if (categoriesRes.error) {
		console.error('[waha] load: failed to fetch categories →', categoriesRes.error.message);
		throw new Error('تعذّر تحميل قائمة التصنيفات من قاعدة البيانات.');
	}
	const categories = [
		...new Set(
			(categoriesRes.data ?? [])
				.map((r) => r.category?.trim())
				.filter((c): c is string => !!c)
		)
	].sort((a, b) => a.localeCompare(b, 'ar'));

	// Build the shared filter chain for the active tab.
	const base = supabase.from('videos').select('id, title, thumbnail, category, status', { count: 'exact' });
	const filtered = tab === 'all' ? base : base.eq('status', tab);
	if (q) filtered.or(`title.ilike.%${q}%,id.ilike.%${q}%`);
	if (category) filtered.eq('category', category);

	const from = (requestedPage - 1) * perPage;
	const { data: videos, count, error } = await filtered
		.order('id', { ascending: tab !== 'approved' })
		.range(from, from + perPage - 1);

	if (error) {
		console.error('[waha] load: failed to fetch videos →', error.message);
		throw new Error('تعذّر تحميل قائمة الفيديوهات من قاعدة البيانات.');
	}

	const total = count ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / perPage));
	const page = Math.min(requestedPage, totalPages); // clamp for the UI

	// Parallel counts for the KPI cards + tab badges.
	const [totalRes, pendingRes, approvedRes] = await Promise.all([
		supabase.from('videos').select('id', { count: 'exact', head: true }),
		supabase.from('videos').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
		supabase.from('videos').select('id', { count: 'exact', head: true }).eq('status', 'approved')
	]);

	return {
		videos: (videos ?? []) as VideoRow[],
		tab,
		q,
		category,
		perPage,
		page,
		total,
		totalPages,
		categories,
		stats: {
			total: totalRes.count ?? 0,
			pending: pendingRes.count ?? 0,
			approved: approvedRes.count ?? 0
		}
	};
};

/* ────────────────────────────────────────────────────────────────
 *  ACTIONS
 * ──────────────────────────────────────────────────────────────── */
export const actions: Actions = {
	/**
	 * ?/importFromWorker — send a YouTube URL / playlist id / channel id
	 * (`input`) + category to the external Cloudflare Worker GET endpoint.
	 * The worker returns `{ success, channel_name, channel_id, videos_added }`
	 * on success or `{ error: "..." }` on failure.
	 */
	importFromWorker: async ({ request }) => {
		const form = await request.formData();
		const input = form.get('input')?.toString().trim() ?? '';
		const category = form.get('category')?.toString().trim() ?? 'عام';

		if (!input) {
			return fail(400, { action: 'importFromWorker' as const, success: false, message: 'أدخل رابط يوتيوب أو معرّف القناة/القائمة.' });
		}

		let payload: { success?: boolean; channel_name?: string; channel_id?: string; videos_added?: number; error?: string; video_title?: string };
		try {
			const { ingestYouTubeContent } = await import('$lib/server/youtube');
			payload = (await ingestYouTubeContent(input, category)) as typeof payload;
		} catch (err) {
			console.error('[waha] importFromWorker: ingestion failed →', err);
			return fail(500, { action: 'importFromWorker' as const, success: false, message: 'تعذّر تنفيذ الاستيراد الداخلي.' });
		}

		if (!payload.success) {
			return fail(400, { action: 'importFromWorker' as const, success: false, message: payload.error ?? 'فشل استيراد المحتوى.' });
		}

		return {
			action: 'importFromWorker' as const,
			success: true,
			message: `تم استيراد ${payload.videos_added ?? 0} فيديو${payload.video_title ? ` من «${payload.video_title}»` : ''}${payload.channel_id ? ` (المعرّف ${payload.channel_id})` : ''}.`,
			channel_name: payload.channel_name,
			channel_id: payload.channel_id,
			videos_added: payload.videos_added
		};
	},

	/**
	 * ?/fetchFromWorker — send a YouTube URL / video id to the external
	 * Waha worker, parse the returned metadata and upsert it into the
	 * `videos` table with status = 'pending'. The raw link is also
	 * recorded in `video_urls` when that table exists.
	 */
	fetchFromWorker: async ({ request }) => {
		const form = await request.formData();
		const raw = form.get('url')?.toString().trim() ?? '';

		if (!raw) {
			return fail(400, { action: 'fetchFromWorker' as const, success: false, message: 'أدخل رابط يوتيوب أو معرّف الفيديو.' });
		}

		// Extract an 11-char video id from any common YouTube URL shape.
		let videoId = '';
		const m = raw.match(
			/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
		);
		if (m) videoId = m[1];
		else if (/^[A-Za-z0-9_-]{11}$/.test(raw)) videoId = raw;
		if (!videoId) {
			return fail(400, { action: 'fetchFromWorker' as const, success: false, message: 'رابط يوتيوب غير صالح — تحقق من الرابط وحاول مجددًا.' });
		}

		let meta: Record<string, unknown>;
		try {
			const res = await fetch(WAHA_FETCH_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: raw, videoId }),
				signal: AbortSignal.timeout(20000)
			});
			if (!res.ok) {
				return fail(502, {
					action: 'fetchFromWorker' as const,
					success: false,
					message: `استجاب الخدمة الخارجية بالخطأ ${res.status}. حاول لاحقًا.`
				});
			}
			meta = (await res.json()) as Record<string, unknown>;
		} catch (err) {
			console.error('[waha] fetchFromWorker: worker request failed →', err);
			return fail(502, { action: 'fetchFromWorker' as const, success: false, message: 'تعذّر الاتصال بخدمة الجلب الخارجية.' });
		}

		// The worker may nest metadata under `data`/`video` or return it flat.
		const src = (meta.data ?? meta.video ?? meta) as Record<string, unknown>;
		const pick = (...keys: string[]): string | null => {
			for (const k of keys) {
				const v = src[k] ?? meta[k];
				if (typeof v === 'string' && v.trim()) return v.trim();
			}
			return null;
		};

		const title =
			pick('title', 'videoTitle', 'name') ?? `فيديو ${videoId}`;
		const thumbnail =
			pick('thumbnail', 'thumbnailUrl', 'thumb') ??
			`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
		const category = pick('category', 'categoryName', 'channel');
		const channelTitle = pick('channel', 'channelTitle', 'author');

		const supabase = getSupabaseAdmin();
		const { data: inserted, error: upsertError } = await supabase
			.from('videos')
			.upsert(
				{ id: videoId, title, thumbnail, category, status: 'pending' },
				{ onConflict: 'id' }
			)
			.select('id, title')
			.maybeSingle();

		if (upsertError) {
			console.error('[waha] fetchFromWorker: upsert failed →', upsertError.message);
			return fail(500, { action: 'fetchFromWorker' as const, success: false, message: 'فشل حفظ بيانات الفيديو في قاعدة البيانات.' });
		}

		// Optional side-log into `video_urls`; failures here are non-fatal.
		try {
			const { error } = await supabase
				.from('video_urls')
				.upsert(
					{ id: videoId, url: raw, video_id: videoId },
					{ onConflict: 'id', ignoreDuplicates: true }
				);
			if (error) console.warn('[waha] fetchFromWorker: video_urls log skipped →', error.message);
		} catch {
			/* table not present — ignore */
		}

		return {
			action: 'fetchFromWorker' as const,
			success: true,
			message: `تم استيراد «${title}»${channelTitle ? ` — ${channelTitle}` : ''} وإضافته إلى قائمة المراجعة.`
		};
	},

	/**
	 * ?/approve — flip one video's status to `approved` (undoable).
	 */
	approve: async ({ request }) => {
		const form = await request.formData();
		const videoId = form.get('id')?.toString().trim();

		if (!videoId) {
			return fail(400, { action: 'approve' as const, success: false, message: 'معرّف الفيديو مفقود.' });
		}

		const supabase = getSupabaseAdmin();
		const { data: video, error: fetchError } = await supabase
			.from('videos')
			.select('id, title, thumbnail, category, status')
			.eq('id', videoId)
			.maybeSingle();

		if (fetchError) {
			console.error('[waha] approve: fetch failed →', fetchError.message);
			return fail(500, { action: 'approve' as const, success: false, message: 'فشل جلب بيانات الفيديو.' });
		}
		if (!video) {
			return fail(404, { action: 'approve' as const, success: false, message: 'الفيديو غير موجود (ربما حُذف للتو).' });
		}

		const { error: videoError } = await supabase.from('videos').update({ status: 'approved' }).eq('id', videoId);
		if (videoError) {
			console.error('[waha] approve: video update failed →', videoError.message);
			return fail(500, { action: 'approve' as const, success: false, message: 'فشل اعتماد الفيديو.' });
		}

		return {
			action: 'approve' as const,
			success: true,
			message: `تم اعتماد «${video.title ?? videoId}».`,
			undo: { intent: 'status' as const, id: videoId, previousStatus: video.status }
		};
	},

	/**
	 * ?/revert — flip one video back to `pending` (undo an approval).
	 */
	revert: async ({ request }) => {
		const form = await request.formData();
		const videoId = form.get('id')?.toString().trim();

		if (!videoId) {
			return fail(400, { action: 'revert' as const, success: false, message: 'معرّف الفيديو مفقود.' });
		}

		const supabase = getSupabaseAdmin();
		const { data: video, error: fetchError } = await supabase
			.from('videos')
			.select('id, title, thumbnail, category, status')
			.eq('id', videoId)
			.maybeSingle();

		if (fetchError) {
			console.error('[waha] revert: fetch failed →', fetchError.message);
			return fail(500, { action: 'revert' as const, success: false, message: 'فشل جلب بيانات الفيديو.' });
		}
		if (!video) {
			return fail(404, { action: 'revert' as const, success: false, message: 'الفيديو غير موجود.' });
		}

		const { error: updateError } = await supabase.from('videos').update({ status: 'pending' }).eq('id', videoId);
		if (updateError) {
			console.error('[waha] revert: update failed →', updateError.message);
			return fail(500, { action: 'revert' as const, success: false, message: 'فشل إرجاع الفيديو إلى قائمة المراجعة.' });
		}

		return {
			action: 'revert' as const,
			success: true,
			message: `تم إرجاع «${video.title ?? videoId}» إلى قائمة المراجعة.`,
			undo: { intent: 'status' as const, id: videoId, previousStatus: video.status }
		};
	},

	/**
	 * ?/update-title — inline title edit from the table view (undoable).
	 */
	'update-title': async ({ request }) => {
		const form = await request.formData();
		const videoId = form.get('id')?.toString().trim();
		const rawTitle = form.get('title')?.toString().trim() ?? '';

		if (!videoId) {
			return fail(400, { action: 'update-title' as const, success: false, message: 'معرّف الفيديو مفقود.' });
		}
		if (!rawTitle) {
			return fail(400, { action: 'update-title' as const, success: false, message: 'لا يمكن ترك العنوان فارغًا.' });
		}
		if (rawTitle.length > 300) {
			return fail(400, { action: 'update-title' as const, success: false, message: 'العنوان طويل جدًا (الحد 300 حرفًا).' });
		}

		const supabase = getSupabaseAdmin();
		const { data: video, error: fetchError } = await supabase
			.from('videos')
			.select('id, title, thumbnail, category, status')
			.eq('id', videoId)
			.maybeSingle();

		if (fetchError) {
			console.error('[waha] update-title: fetch failed →', fetchError.message);
			return fail(500, { action: 'update-title' as const, success: false, message: 'فشل جلب بيانات الفيديو.' });
		}
		if (!video) {
			return fail(404, { action: 'update-title' as const, success: false, message: 'الفيديو غير موجود.' });
		}
		if (video.title === rawTitle) {
			return { action: 'update-title' as const, success: true, message: 'العنوان محدَّث بالفعل.' };
		}

		const { error: updateError } = await supabase.from('videos').update({ title: rawTitle }).eq('id', videoId);
		if (updateError) {
			console.error('[waha] update-title: update failed →', updateError.message);
			return fail(500, { action: 'update-title' as const, success: false, message: 'فشل تحديث العنوان.' });
		}

		return {
			action: 'update-title' as const,
			success: true,
			message: `تم تحديث عنوان «${video.title ?? videoId}».`,
			undo: { intent: 'update' as const, id: videoId, previousTitle: video.title }
		};
	},

	/**
	 * ?/set-category — change one video's category (undoable).
	 * An empty value clears the category (stored as SQL NULL).
	 */
	'set-category': async ({ request }) => {
		const form = await request.formData();
		const videoId = form.get('id')?.toString().trim();
		const rawCategory = form.get('category')?.toString().trim() ?? '';
		const category = rawCategory.length > 0 ? rawCategory : null;

		if (!videoId) {
			return fail(400, { action: 'set-category' as const, success: false, message: 'معرّف الفيديو مفقود.' });
		}
		if (category && category.length > 120) {
			return fail(400, { action: 'set-category' as const, success: false, message: 'اسم التصنيف طويل جدًا (الحد 120 حرفًا).' });
		}

		const supabase = getSupabaseAdmin();
		const { data: video, error: fetchError } = await supabase
			.from('videos')
			.select('id, title, thumbnail, category, status')
			.eq('id', videoId)
			.maybeSingle();

		if (fetchError) {
			console.error('[waha] set-category: fetch failed →', fetchError.message);
			return fail(500, { action: 'set-category' as const, success: false, message: 'فشل جلب بيانات الفيديو.' });
		}
		if (!video) {
			return fail(404, { action: 'set-category' as const, success: false, message: 'الفيديو غير موجود.' });
		}
		if (video.category === category) {
			return { action: 'set-category' as const, success: true, message: 'التصنيف محدَّث بالفعل.' };
		}

		const { error: updateError } = await supabase.from('videos').update({ category }).eq('id', videoId);
		if (updateError) {
			console.error('[waha] set-category: update failed →', updateError.message);
			return fail(500, { action: 'set-category' as const, success: false, message: 'فشل تحديث التصنيف.' });
		}

		return {
			action: 'set-category' as const,
			success: true,
			message: category
				? `تم تصنيف «${video.title ?? videoId}» ضمن «${category}».`
				: `تمت إزالة التصنيف من «${video.title ?? videoId}».`,
			undo: { intent: 'update' as const, id: videoId, previousCategory: video.category }
		};
	},

	/**
	 * ?/bulk-set-category — apply one category to every selected video
	 * in a single click (undoable for the whole batch).
	 */
	'bulk-set-category': async ({ request }) => {
		const form = await request.formData();
		const ids = parseIds(form);
		const rawCategory = form.get('category')?.toString().trim() ?? '';
		const category = rawCategory.length > 0 ? rawCategory : null;

		if (ids.length === 0) {
			return fail(400, { action: 'bulk-set-category' as const, success: false, message: 'لم يتم تحديد أي فيديو.' });
		}
		if (category && category.length > 120) {
			return fail(400, { action: 'bulk-set-category' as const, success: false, message: 'اسم التصنيف طويل جدًا (الحد 120 حرفًا).' });
		}

		const supabase = getSupabaseAdmin();
		const { data: previous, error: fetchError } = await supabase
			.from('videos')
			.select('id, category')
			.in('id', ids);

		if (fetchError) {
			console.error('[waha] bulk-set-category: fetch failed →', fetchError.message);
			return fail(500, { action: 'bulk-set-category' as const, success: false, message: 'فشل جلب بيانات الفيديوهات.' });
		}

		const { data: updated, error } = await supabase
			.from('videos')
			.update({ category })
			.in('id', ids)
			.select('id');

		if (error) {
			console.error('[waha] bulk-set-category: update failed →', error.message);
			return fail(500, { action: 'bulk-set-category' as const, success: false, message: 'فشل تحديث التصنيف الجماعي.' });
		}

		return {
			action: 'bulk-set-category' as const,
			success: true,
			message: category
				? `تم تصنيف ${updated?.length ?? 0} فيديو ضمن «${category}».`
				: `تمت إزالة التصنيف من ${updated?.length ?? 0} فيديو.`,
			undo: { intent: 'update' as const, ids, previousCategory: category }
		};
	},

	/**
	 * ?/approve-all — approve every currently-pending video in ONE bulk
	 * update (undoable for the whole batch).
	 */
	'approve-all': async () => {
		const supabase = getSupabaseAdmin();

		const { data: updated, error } = await supabase
			.from('videos')
			.update({ status: 'approved' })
			.eq('status', 'pending')
			.select('id');

		if (error) {
			console.error('[waha] approve-all: failed →', error.message);
			return fail(500, { action: 'approve-all' as const, success: false, message: 'فشل اعتماد جميع الفيديوهات.' });
		}

		const n = updated?.length ?? 0;
		if (n === 0) {
			return { action: 'approve-all' as const, success: true, message: 'لا يوجد شيء للاعتماد — القائمة فارغة.' };
		}

		return {
			action: 'approve-all' as const,
			success: true,
			message: `تم اعتماد ${n} فيديو دفعة واحدة.`,
			undo: { intent: 'status' as const, ids: updated!.map((r) => r.id), previousStatus: 'pending' }
		};
	},

	/**
	 * ?/approve-selected — approve all videos whose ids arrive in the
	 * `ids` field (undoable for the whole batch).
	 */
	'approve-selected': async ({ request }) => {
		const ids = parseIds(await request.formData());

		if (ids.length === 0) {
			return fail(400, { action: 'approve-selected' as const, success: false, message: 'لم يتم تحديد أي فيديو.' });
		}

		const supabase = getSupabaseAdmin();
		const { data: updated, error } = await supabase
			.from('videos')
			.update({ status: 'approved' })
			.in('id', ids)
			.select('id');

		if (error) {
			console.error('[waha] approve-selected: failed →', error.message);
			return fail(500, { action: 'approve-selected' as const, success: false, message: 'فشل الاعتماد الجماعي.' });
		}

		return {
			action: 'approve-selected' as const,
			success: true,
			message: `تم اعتماد ${updated?.length ?? 0} فيديو من المحددين.`,
			undo: { intent: 'status' as const, ids: updated?.map((r) => r.id) ?? ids, previousStatus: 'pending' }
		};
	},

	/**
	 * ?/delete-selected — permanently remove all selected videos.
	 * Every deleted row is captured first so "Undo" can restore them.
	 */
	'delete-selected': async ({ request }) => {
		const ids = parseIds(await request.formData());

		if (ids.length === 0) {
			return fail(400, { action: 'delete-selected' as const, success: false, message: 'لم يتم تحديد أي فيديو.' });
		}

		const supabase = getSupabaseAdmin();
		const { data: rows, error: fetchError } = await supabase
			.from('videos')
			.select('id, title, thumbnail, category, status')
			.in('id', ids);

		if (fetchError) {
			console.error('[waha] delete-selected: fetch failed →', fetchError.message);
			return fail(500, { action: 'delete-selected' as const, success: false, message: 'فشل جلب بيانات الفيديوهات.' });
		}

		const { data: deleted, error } = await supabase.from('videos').delete().in('id', ids).select('id');
		if (error) {
			console.error('[waha] delete-selected: failed →', error.message);
			return fail(500, { action: 'delete-selected' as const, success: false, message: 'فشل الحذف الجماعي.' });
		}

		return {
			action: 'delete-selected' as const,
			success: true,
			message: `تم حذف ${deleted?.length ?? 0} فيديو نهائيًا.`,
			undo: { intent: 'delete' as const, rows: (rows ?? []) as VideoRow[] }
		};
	},

	/**
	 * ?/delete — permanently remove the video row (undoable: the full
	 * row snapshot travels back with the toast).
	 */
	delete: async ({ request }) => {
		const form = await request.formData();
		const videoId = form.get('id')?.toString().trim();

		if (!videoId) {
			return fail(400, { action: 'delete' as const, success: false, message: 'معرّف الفيديو مفقود.' });
		}

		const supabase = getSupabaseAdmin();
		const { data: video, error: fetchError } = await supabase
			.from('videos')
			.select('id, title, thumbnail, category, status')
			.eq('id', videoId)
			.maybeSingle();

		if (fetchError) {
			console.error('[waha] delete: fetch failed →', fetchError.message);
			return fail(500, { action: 'delete' as const, success: false, message: 'فشل جلب بيانات الفيديو.' });
		}
		if (!video) {
			return fail(404, { action: 'delete' as const, success: false, message: 'الفيديو غير موجود.' });
		}

		const { error: deleteError } = await supabase.from('videos').delete().eq('id', videoId);
		if (deleteError) {
			console.error('[waha] delete: failed →', deleteError.message);
			return fail(500, { action: 'delete' as const, success: false, message: 'فشل حذف الفيديو.' });
		}

		return {
			action: 'delete' as const,
			success: true,
			message: `تم حذف «${video.title ?? videoId}» نهائيًا.`,
			undo: { intent: 'delete' as const, rows: [video] }
		};
	},

	/**
	 * ?/undo — restore a previous state described by an UndoPayload.
	 * Covers status flips (single/bulk), deleted-row restoration and
	 * field updates (title/category, single/bulk).
	 */
	undo: async ({ request }) => {
		const form = await request.formData();
		const raw = form.get('payload')?.toString() ?? '';

		if (!raw) {
			return fail(400, { action: 'undo' as const, success: false, message: 'بيانات التراجع مفقودة.' });
		}

		let payload: UndoPayload;
		try {
			payload = JSON.parse(raw) as UndoPayload;
		} catch {
			return fail(400, { action: 'undo' as const, success: false, message: 'بيانات التراجع تالفة.' });
		}

		const supabase = getSupabaseAdmin();

		switch (payload.intent) {
			// Restore one or many videos to their previous status.
			case 'status': {
				if (payload.id) {
					const { error } = await supabase
						.from('videos')
						.update({ status: payload.previousStatus ?? 'pending' })
						.eq('id', payload.id);
					if (error) {
						console.error('[waha] undo(status): failed →', error.message);
						return fail(500, { action: 'undo' as const, success: false, message: 'فشل التراجع عن العملية.' });
					}
				} else if (payload.ids && payload.ids.length > 0) {
					const { error } = await supabase
						.from('videos')
						.update({ status: payload.previousStatus ?? 'pending' })
						.in('id', payload.ids);
					if (error) {
						console.error('[waha] undo(status,bulk): failed →', error.message);
						return fail(500, { action: 'undo' as const, success: false, message: 'فشل التراجع عن العملية الجماعية.' });
					}
				} else {
					return fail(400, { action: 'undo' as const, success: false, message: 'بيانات التراجع ناقصة.' });
				}
				break;
			}

			// Re-insert previously deleted rows.
			case 'delete': {
				const rows = payload.rows ?? (payload.previousRow ? [payload.previousRow] : []);
				if (rows.length === 0) {
					return fail(400, { action: 'undo' as const, success: false, message: 'لا توجد بيانات لاستعادتها.' });
				}
				const { error } = await supabase.from('videos').upsert(rows, { onConflict: 'id' });
				if (error) {
					console.error('[waha] undo(delete): failed →', error.message);
					return fail(500, { action: 'undo' as const, success: false, message: 'فشل استعادة الفيديوهات المحذوفة.' });
				}
				break;
			}

			// Restore previous field values (title / category).
			case 'update': {
				const patch: Record<string, unknown> = {};
				if ('previousTitle' in payload) patch.title = payload.previousTitle ?? null;
				if ('previousCategory' in payload) patch.category = payload.previousCategory ?? null;
				if (Object.keys(patch).length === 0) {
					return fail(400, { action: 'undo' as const, success: false, message: 'لا توجد حقول لاستعادتها.' });
				}
				if (payload.id) {
					const { error } = await supabase.from('videos').update(patch).eq('id', payload.id);
					if (error) {
						console.error('[waha] undo(update): failed →', error.message);
						return fail(500, { action: 'undo' as const, success: false, message: 'فشل التراجع عن التعديل.' });
					}
				} else if (payload.ids && payload.ids.length > 0) {
					const { error } = await supabase.from('videos').update(patch).in('id', payload.ids);
					if (error) {
						console.error('[waha] undo(update,bulk): failed →', error.message);
						return fail(500, { action: 'undo' as const, success: false, message: 'فشل التراجع عن التعديل الجماعي.' });
					}
				} else {
					return fail(400, { action: 'undo' as const, success: false, message: 'بيانات التراجع ناقصة.' });
				}
				break;
			}

			default:
				return fail(400, { action: 'undo' as const, success: false, message: 'نوع التراجع غير معروف.' });
		}

		return { action: 'undo' as const, success: true, message: 'تم التراجع عن العملية بنجاح.' };
	}
};
