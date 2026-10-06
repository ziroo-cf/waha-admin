import type { VideoRow } from '$lib/types';
import { env } from '$env/dynamic/private';

/**
 * Determine what kind of YouTube identifier a raw string represents.
 * Shared by the in-core ingestion path and any other server code
 * that needs to parse YouTube URLs / IDs.
 */
export function determineInputType(input: string): {
	type: 'video' | 'playlist' | 'unknown';
	id: string | null;
} {
	if (!input) return { type: 'unknown', id: null };
	const trimmed = input.trim();

	// Playlist ID from a youtube.com/playlist?list=... URL.
	if (trimmed.includes('list=')) {
		const match = trimmed.match(/list=([a-zA-Z0-9_-]+)/);
		if (match) return { type: 'playlist', id: match[1] };
	}

	// Channel URL / ID → we normalise to a playlist (uploads) id.
	if (trimmed.startsWith('UC')) {
		return { type: 'playlist', id: trimmed.replace(/^UC/, 'UU') };
	}

	if (trimmed.startsWith('PL') || trimmed.startsWith('UU')) {
		return { type: 'playlist', id: trimmed };
	}

	// Video from any common URL shape.
	const videoMatch = trimmed.match(
		/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
	);
	if (videoMatch) {
		return { type: 'video', id: videoMatch[1] };
	}

	// Bare 11-char video id.
	if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
		return { type: 'video', id: trimmed };
	}

	return { type: 'unknown', id: null };
}

/**
 * Build the response envelope the UI expects from the import action.
 */
interface ImportResult {
	success: boolean;
	type: 'video' | 'playlist';
	videos_added: number;
	video_title?: string;
	channel_name?: string;
	channel_id?: string;
}

interface ImportError {
	success: false;
	error: string;
}

type ImportResponse = ImportResult | ImportError;

/**
 * Convert an ISO-8601 duration (`PT1H2M3S`, as returned by the YouTube API
 * `contentDetails.duration` field) into a whole number of seconds.
 * Returns null when the input is missing or unparseable.
 */
export function parseIsoDuration(iso: string | undefined | null): number | null {
	if (!iso) return null;
	const match = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
	if (!match) return null;
	const [, d, h, m, s] = match;
	const seconds =
		(Number(d ?? 0) * 86400) +
		(Number(h ?? 0) * 3600) +
		(Number(m ?? 0) * 60) +
		Number(s ?? 0);
	return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Convert an ISO-8601 duration into standard mm:ss / hh:mm:ss text format.
 */
export function formatIsoDuration(iso: string | undefined | null): string | null {
	const seconds = parseIsoDuration(iso);
	if (seconds === null || seconds < 0) return null;
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * In-core YouTube → Supabase ingestion.
 *
 * Replaces the external Cloudflare Worker call. Accepts a single `input`
 * string (YouTube URL / playlist id / channel id / video id) and a
 * `category`, fetches metadata from the YouTube Data API v3, and inserts
 * the discovered videos into the `videos` table with `status = 'pending'`.
 *
 * IMPORTANT: this module lives under `src/lib/server/` so it is stripped
 * from the client bundle by SvelteKit. Do not import it from any `.svelte`
 * or client-side `.ts` file.
 */
export async function ingestYouTubeContent(
	input: string,
	category: string,
): Promise<ImportResponse> {
	

	if (!env.YOUTUBE_API_KEY || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
		return {
			success: false,
			error:
				"تأكد من إضافه YOUTUBE_API_KEY و SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في متغيرات بيئة الخادم",
		};
	}

	const { type, id: extractedId } = determineInputType(input);

	if (type === 'unknown' || !extractedId) {
		return {
			success: false,
			error:
				'تعذر التعرف على الرابط. يرجى إدخال رابط فيديو، قناة، أو قائمة تشغيل صالح.',
		};
	}

	const videosToInsert: VideoRow[] = [];
	let responsePayload: ImportResult = {
		success: true,
		type,
		videos_added: 0,
	};

	if (type === 'video') {
		const videoUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${extractedId}&key=${env.YOUTUBE_API_KEY}`;
		const videoRes = await fetch(videoUrl);
		const videoData = await videoRes.json();

		if (!videoRes.ok) {
			return {
				success: false,
				error: `خطأ من YouTube API عند جلب الفيديو (${videoRes.status})`,
			};
		}

		if (!videoData.items || videoData.items.length === 0) {
			return {
				success: false,
				error: 'الفيديو غير موجود أو خاص',
			};
		}

		const item = videoData.items[0];
		const snippet = item.snippet;
		videosToInsert.push({
			id: extractedId,
			title: snippet.title,
			thumbnail: snippet.thumbnails?.high?.url ||
				snippet.thumbnails?.medium?.url ||
				snippet.thumbnails?.default?.url ||
				'',
			category,
			status: 'pending',
			duration: formatIsoDuration(item.contentDetails?.duration),
		});

		responsePayload = {
			success: true,
			type: 'video',
			video_title: snippet.title,
			videos_added: 1,
		};
	} else if (type === 'playlist') {
		let nextPageToken: string | undefined = '';
		const MAX_PAGES = 10; //  5 = 250 videos
		let pageCount = 0;

		do {
			const tokenParam = nextPageToken ? `&pageToken=${nextPageToken}` : '';
			const itemsUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${extractedId}&maxResults=50${tokenParam}&key=${env.YOUTUBE_API_KEY}`;

			const itemsRes = await fetch(itemsUrl);
			const itemsData = await itemsRes.json();

			if (!itemsRes.ok) {
				return {
					success: false,
					error: `خطأ من YouTube API عند جلب فيديوهات القائمة (${itemsRes.status})`,
				};
			}

			if (itemsData.items && itemsData.items.length > 0) {
				for (const item of itemsData.items) {
					const snippet = item.snippet;
					const videoId = snippet.resourceId?.videoId;

					if (
						!videoId ||
						snippet.title === 'Private video' ||
						snippet.title === 'Deleted video'
					)
						continue;

						videosToInsert.push({
							id: videoId,
							title: snippet.title,
							thumbnail: snippet.thumbnails?.high?.url ||
							snippet.thumbnails?.medium?.url ||
							snippet.thumbnails?.default?.url ||
							'',
							category,
							status: 'pending',
							duration: null,
						});
				}
			}

			nextPageToken = itemsData.nextPageToken;
			pageCount++;
		} while (nextPageToken && pageCount < MAX_PAGES);

		// playlistItems does not return durations, so resolve them in one
		// batched `videos.list` call (50 ids per request) and map them back.
		const ids = videosToInsert.map((v) => v.id);
		const durationById = new Map<string, string | null>();
		for (let i = 0; i < ids.length; i += 50) {
			const batch = ids.slice(i, i + 50).join(',');
			const durationsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${batch}&key=${env.YOUTUBE_API_KEY}`;
			try {
				const durationsRes = await fetch(durationsUrl);
				const durationsData = await durationsRes.json();
				for (const item of durationsData.items ?? []) {
					durationById.set(item.id, formatIsoDuration(item.contentDetails?.duration));
				}
			} catch (err) {
				// Duration is best-effort — never fail the whole import over it.
				console.warn('[youtube-ingest] duration lookup failed →', err);
			}
		}
		for (const video of videosToInsert) {
			video.duration = durationById.get(video.id) ?? null;
		}

		responsePayload = {
			success: true,
			type: 'playlist',
			videos_added: videosToInsert.length,
		};
	}

	if (videosToInsert.length > 0) {
		const supabase = (await import('./supabase')).getSupabaseAdmin();
		const { data, error } = await supabase
		.from('videos')
		.upsert(videosToInsert, {
			onConflict: 'id',
		  ignoreDuplicates: true
		})
		.select('id');

		if (error) {
			console.error('[youtube-ingest] Supabase Error:', error);
			return {
				success: false,
				error: `فشل حفظ البيانات: ${error.message}`,
			};
		}

		// تحديث العدد بالفيديوهات التي تم إدخالها فعلياً (بدون المكرر)
		responsePayload.videos_added = data?.length ?? videosToInsert.length;
	} else {
		responsePayload.video_title = responsePayload.video_title ?? '';
		responsePayload.channel_name = responsePayload.video_title ?? '';
		responsePayload.videos_added = 0;
	}

	responsePayload.channel_name = responsePayload.video_title ?? input;
	responsePayload.channel_id = extractedId;

	return responsePayload;
}
