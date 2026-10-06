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
 * Format a video length (seconds, mm:ss, hh:mm:ss, or ISO duration) as `m:ss` / `h:mm:ss`.
 * Returns null for missing, zero (`00:00`), or negative values.
 */
export function formatDuration(duration: number | string | null | undefined): string | null {
	if (duration === null || duration === undefined) return null;
	const s = String(duration).trim();
	if (!s || s === '00:00' || s === '0:00' || s === '0') return null;

	// Already formatted: mm:ss or hh:mm:ss
	if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(s)) {
		const parts = s.split(':').map(Number);
		if (parts.length === 2) {
			const [m, sec] = parts;
			return `${m}:${String(sec).padStart(2, '0')}`;
		}
		if (parts.length === 3) {
			const [h, m, sec] = parts;
			return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
		}
		return s;
	}

	// Number or numeric string (seconds)
	const num = Number(s);
	if (Number.isFinite(num) && num > 0) {
		const total = Math.floor(num);
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const sec = total % 60;
		const pad = (n: number) => String(n).padStart(2, '0');
		return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
	}

	// ISO 8601 duration (e.g. PT1M27S)
	if (s.startsWith('P')) {
		const match = s.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
		if (match) {
			const [, d, h, m, sec] = match;
			const totalSeconds =
				Number(d ?? 0) * 86400 +
				Number(h ?? 0) * 3600 +
				Number(m ?? 0) * 60 +
				Number(sec ?? 0);
			if (totalSeconds > 0) {
				const hours = Math.floor(totalSeconds / 3600);
				const mins = Math.floor((totalSeconds % 3600) / 60);
				const secs = totalSeconds % 60;
				const pad = (n: number) => String(n).padStart(2, '0');
				return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
			}
		}
	}

	return null;
}
