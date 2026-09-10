<script lang="ts">
	import type { VideoRow } from '$lib/types';

	interface Props {
		video: VideoRow | null;
		open: boolean;
		onclose: () => void;
	}

	let { video, open, onclose }: Props = $props();

	const isOpen = $derived(open && video !== null);

	/**
	 * Build a reliable YouTube embed URL.
	 * The video's `id` IS the YouTube id in this schema, so prefer it and
	 * only fall back to parsing the thumbnail URL. The old derivation
	 * replaced the whole URL with the raw thumbnail when no regex matched,
	 * which produced a dead iframe ("player: not work").
	 */
	const embedUrl = $derived.by(() => {
		const id = video?.id ?? '';
		if (/^[A-Za-z0-9_-]{11}$/.test(id)) {
			return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
		}
		const thumb = video?.thumbnail ?? '';
		const m = thumb.match(
			/(?:youtube\.com\/(?:watch\?v=|embed\/|vi\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
		);
		return m
			? `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0`
			: `https://www.youtube.com/embed/${id}?rel=0`;
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
	<!-- Centering wrapper: the old markup had no positioning context, so the
	     panel rendered unpositioned. This overlay centers it and closes on click. -->
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<!-- Backdrop -->
		<button
			type="button"
			class="absolute inset-0 h-full w-full cursor-default bg-black/80 backdrop-blur-sm"
			onclick={onclose}
			aria-label="إغلاق المعاينة"
		></button>

		<!-- Modal -->
		<div
			class="relative z-10 w-full max-w-4xl overflow-hidden rounded-2xl border border-zinc-700/60 bg-zinc-900 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-label="معاينة الفيديو: {video?.title ?? video?.id}"
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
				<div class="flex items-center gap-3 min-w-0">
					<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400">
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M22 8.5a2.5 2.5 0 0 0-2.5-2.5h-13A2.5 2.5 0 0 0 4 8.5v7A2.5 2.5 0 0 0 6.5 18h13a2.5 2.5 0 0 0 2.5-2.5Z" />
							<path d="M22 9.5l-4.5 2.5 4.5 2.5Z" />
						</svg>
					</div>
					<div class="min-w-0">
						<h3 class="truncate text-sm font-semibold text-zinc-100 leading-tight">{video?.title ?? 'فيديو بدون عنوان'}</h3>
						<p class="text-[11px] text-zinc-500 font-mono" dir="ltr">{video?.id}</p>
					</div>
				</div>
				<button
					type="button"
					onclick={onclose}
					class="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
					aria-label="إغلاق المعاينة"
				>
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M18 6 6 18 M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Embedded Player -->
			<div class="aspect-video bg-zinc-950">
				<iframe
					src={embedUrl}
					title="مشغّل الفيديو: {video?.title ?? video?.id}"
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
					allowfullscreen
					referrerpolicy="strict-origin-when-cross-origin"
					class="h-full w-full border-0"
				></iframe>
			</div>

			<!-- Footer -->
			<div class="border-t border-zinc-800 px-4 py-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div class="flex items-center gap-2 text-xs text-zinc-500">
						<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M12 8v4l3 3" />
							<circle cx="12" cy="12" r="10" />
						</svg>
						مشغّل YouTube
					</div>
					<div class="flex items-center gap-2">
						{#if video?.category}
							<span class="rounded-full border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
								{video.category}
							</span>
						{/if}
						<span class="rounded-full border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-1 text-[11px] font-medium text-zinc-400" dir="ltr">
							#{video?.id.slice(0, 8)}
						</span>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
