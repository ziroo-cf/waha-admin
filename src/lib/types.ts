/**
 * Shape of a row in the `videos` table (subset used by the UI).
 * Shared by the server page and UI components.
 */
export interface VideoRow {
	id: string;
	title: string | null;
	thumbnail: string | null;
	category: string | null;
	status: string;
	/** Row insertion timestamp (`created_at`) — may be absent on legacy rows. */
	created_at?: string | null;
}

/**
 * The complete, fixed list of content categories (طلب المستخدم).
 * The category editor + filters use exactly these values — never a
 * free-form list derived from the database.
 */
export const CATEGORIES = [
	'رسوم متحركة',
	'أناشيد',
	'قصص',
	'معرفة',
	'برامج دينية',
	'عام'
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Sort directions for date-of-addition ordering. */
export type SortDir = 'newest' | 'oldest';

/** Row of the `video_urls` table (import queue metadata, if present). */
export interface VideoUrlRow {
	id: string;
	url: string | null;
	video_id: string | null;
}

/** Which moderation tab is active. */
export type StatusTab = 'pending' | 'approved' | 'all';

/** Valid per-page sizes for server-side pagination. */
export const PER_PAGE_OPTIONS = [15, 30, 50] as const;

/** One entry in the client-side activity audit log. */
export interface ActivityEntry {
	id: number;
	text: string;
	/** ISO timestamp of when the operation happened. */
	at: string;
	/** Visual kind of the entry. */
	kind: 'success' | 'error' | 'info' | 'undo';
	/** Payload needed to revert this operation, when it is undoable. */
	undo?: UndoPayload;
}

/** Data the server action `?/undo` needs to restore a previous state. */
export interface UndoPayload {
	/** The undo intent decides which restoration the server performs. */
	intent: 'approve' | 'delete' | 'update' | 'status';
	/** Video id the operation was applied to (single-item ops). */
	id?: string;
	/** Previous status of the video, restored by `intent: 'status'`. */
	previousStatus?: string;
	/** Previous category of the video (null = no category). */
	previousCategory?: string | null;
	/** Previous title of the video. */
	previousTitle?: string | null;
	/** Full row snapshot for restoring a deleted video. */
	previousRow?: VideoRow;
	/** Full row snapshots for restoring multiple deleted videos. */
	rows?: VideoRow[];
	/** Count of rows affected (bulk ops, restored by `intent: 'status'`). */
	ids?: string[];
}
