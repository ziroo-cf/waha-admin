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
		const videoUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${extractedId}&key=${env.YOUTUBE_API_KEY}`;
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

		const snippet = videoData.items[0].snippet;
		videosToInsert.push({
			id: extractedId,
			title: snippet.title,
			thumbnail: snippet.thumbnails?.high?.url ||
				snippet.thumbnails?.medium?.url ||
				snippet.thumbnails?.default?.url ||
				'',
			category,
			status: 'pending',
		});

		responsePayload = {
			success: true,
			type: 'video',
			video_title: snippet.title,
			videos_added: 1,
		};
	} else if (type === 'playlist') {
		let nextPageToken: string | undefined = '';
		const MAX_PAGES = 5; // سيتفقد حتى 5 صفحات (250 فيديو كحد أقصى لتفادي الـ Timeout)
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
						});
				}
			}

			nextPageToken = itemsData.nextPageToken;
			pageCount++;
		} while (nextPageToken && pageCount < MAX_PAGES);

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
