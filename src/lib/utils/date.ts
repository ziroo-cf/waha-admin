/**
 * Small shared formatting helpers.
 */

/** Arabic relative time for a date, e.g. «قبل 3 أيام» / «قبل ساعتين». */
export function relTimeAr(date: Date | string, now: Date = new Date()): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	const diff = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
	if (diff < 60) return 'قبل لحظات';
	const minutes = Math.floor(diff / 60);
	if (minutes < 60) return `قبل ${minutes} دقيقة`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return hours === 1 ? 'قبل ساعة' : hours === 2 ? 'قبل ساعتين' : `قبل ${hours} ساعات`;
	const days = Math.floor(hours / 24);
	if (days === 1) return 'أمس';
	if (days === 2) return 'قبل يومين';
	if (days < 30) return `قبل ${days} أيام`;
	return d.toLocaleDateString('ar', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Format a video length (in seconds) as `m:ss` / `h:mm:ss`.
 * Returns null for missing or negative values so callers can show a placeholder.
 */
export function formatDuration(seconds: number | null | undefined): string | null {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
		return null;
	}
	const total = Math.floor(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
