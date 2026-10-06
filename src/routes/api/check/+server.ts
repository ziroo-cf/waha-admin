import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { checkYouTubeVideosAvailability } from '$lib/server/youtube';
import type { VideoAvailabilityIssue } from '$lib/types';

/**
 * GET /api/check
 * Query a paginated list of videos from the database to audit.
 * Query params:
 * - `offset`: start index (default 0)
 * - `limit`: batch size (default 50, max 100)
 */
export const GET: RequestHandler = async ({ url }) => {
	const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
	const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

	const supabase = getSupabaseAdmin();
	const { data: videos, count, error: fetchError } = await supabase
		.from('videos')
		.select('id, title, thumbnail', { count: 'exact' })
		.range(offset, offset + limit - 1);

	if (fetchError) {
		console.error('[api/check] GET failed:', fetchError.message);
		throw error(500, 'فشل جلب الفيديوهات من قاعدة البيانات.');
	}

	return json({
		videos: videos ?? [],
		total: count ?? 0,
		offset,
		limit
	});
};

/**
 * POST /api/check
 * Handlers:
 * - action: 'check' -> checks a batch of video objects against YouTube API.
 * - action: 'delete' -> bulk deletes the provided IDs.
 * - action: 'disable' -> sets status = 'unavailable' for the provided IDs.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const action = body.action ?? 'check';
	const supabase = getSupabaseAdmin();

	if (action === 'check') {
		const videos = (body.videos ?? []) as Array<{ id: string; title: string | null; thumbnail: string | null }>;
		if (!videos.length) {
			return json({ issues: [] });
		}

		const ids = videos.map((v) => v.id);
		const issuesMap = await checkYouTubeVideosAvailability(ids);

		const issues: VideoAvailabilityIssue[] = [];
		for (const video of videos) {
			const issue = issuesMap.get(video.id);
			if (issue) {
				issues.push({
					id: video.id,
					title: video.title,
					thumbnail: video.thumbnail,
					type: issue.type,
					reason: issue.reason
				});
			}
		}

		return json({ issues });
	}

	if (action === 'delete') {
		const ids = (body.ids ?? []) as string[];
		if (!ids.length) {
			return json({ success: true, count: 0 });
		}

		const { data: deleted, error: delError } = await supabase
			.from('videos')
			.delete()
			.in('id', ids)
			.select('id');

		if (delError) {
			console.error('[api/check] delete failed:', delError.message);
			throw error(500, 'فشل حذف الفيديوهات.');
		}

		return json({ success: true, count: deleted?.length ?? ids.length });
	}

	if (action === 'disable') {
		const ids = (body.ids ?? []) as string[];
		if (!ids.length) {
			return json({ success: true, count: 0 });
		}

		const { data: updated, error: updError } = await supabase
			.from('videos')
			.update({ status: 'unavailable' })
			.in('id', ids)
			.select('id');

		if (updError) {
			console.error('[api/check] disable failed:', updError.message);
			throw error(500, 'فشل تحديث حالة الفيديوهات.');
		}

		return json({ success: true, count: updated?.length ?? ids.length });
	}

	throw error(400, 'نوع العملية غير معروف.');
};
