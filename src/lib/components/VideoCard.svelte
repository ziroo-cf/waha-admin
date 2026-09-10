<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { VideoRow } from '$lib/types';
	import { relTimeAr } from '$lib/utils/date';

	interface Props {
		video: VideoRow;
		/** id of the video currently mid-action, or null */
		busyId: string | null;
		/** which action list this card belongs to */
		mode: 'pending' | 'approved';
		/** shared submit callback for card buttons (approve/revert/delete) */
		submit: SubmitFunction;
		/** submit callback for the category form (?/set-category) */
		categorySubmit: SubmitFunction;
		/** fixed category list (for the inline editor) */
		categories: readonly string[];
		/** whether this card is part of the current selection */
		selected: boolean;
		/** selection toggle (checkbox) */
		ontoggleselect: () => void;
		/** open preview modal */
		openPreview: (video: VideoRow) => void;
	}

	let { video, busyId, mode, submit, categorySubmit, categories, selected, ontoggleselect, openPreview }: Props =
		$props();

	const isBusy = $derived(busyId === video.id);
	const isAnyBusy = $derived(busyId !== null);
	const currentCategory = $derived(video.category ?? '');

	// ── Thumbnail fallback ──────────────────────────────────────
	const placeholderThumb =
		'data:image/svg+xml;utf8,' +
		encodeURIComponent(
			`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#27272a"/><text x="160" y="95" font-size="16" fill="#71717a" text-anchor="middle" font-family="sans-serif">لا صورة</text></svg>`
		);

	function onThumbError(event: Event) {
		(event.currentTarget as HTMLImageElement).src = placeholderThumb;
	}

	function handleConfirmDelete(event: SubmitEvent) {
		if (!confirm('هل تريد حذف هذا الفيديو؟ يمكنك التراجع من الإشعار خلال ثوانٍ.')) {
			event.preventDefault();
		}
	}

	async function copyId() {
		try {
			// Use navigator.clipboard API
			if (navigator.clipboard && navigator.clipboard.writeText) {
				await navigator.clipboard.writeText(video.id);
			} else {
				// Fallback: select text
				const el = document.querySelector(`[data-copy-target="${video.id}"]`) as HTMLTextAreaElement;
				el?.select();
			}
		} catch {
			// Fallback: select text
			const el = document.querySelector(`[data-copy-target="${video.id}"]`) as HTMLTextAreaElement;
			el?.select();
		}
	}
</script>

<article
	class="group relative overflow-hidden rounded-xl border transition {selected
		? 'border-blue-500/80 ring-1 ring-blue-500/40'
		: 'border-zinc-800/80 bg-zinc-900/80 hover:border-zinc-700 hover:bg-zinc-900'} {isBusy
		? 'opacity-60'
		: ''}"
	data-video-id={video.id}
>
	<!-- Selection checkbox (top-right) -->
	<label
		class="absolute top-2.5 right-2.5 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border backdrop-blur transition {selected
			? 'border-blue-400 bg-blue-600 text-white'
			: 'border-zinc-500/70 bg-zinc-950/50 text-transparent hover:border-blue-400/70'}"
		title={selected ? 'إلغاء التحديد' : 'تحديد'}
	>
		<input type="checkbox" class="peer sr-only" checked={selected} onchange={ontoggleselect} />
		<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="m5 13 4 4L19 7" />
		</svg>
	</label>

	<!-- Thumbnail (clickable for preview) -->
	<button
		type="button"
		onclick={() => openPreview(video)}
		class="block w-full cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-blue-500/50"
		aria-label="معاينة الفيديو: {video.title ?? video.id}"
	>
		<div class="relative aspect-video overflow-hidden bg-zinc-800">
			<img
				src={video.thumbnail || placeholderThumb}
				alt="صورة مصغّرة لـ {video.title ?? video.id}"
				loading="lazy"
				class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
				onerror={onThumbError}
			/>
			<div class="absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-zinc-950/10"></div>

			<!-- Status badge (top-left): clean glassy pill -->
			{#if mode === 'pending'}
				<span
					class="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-zinc-950/60 px-2 py-0.5 text-[10px] font-medium text-amber-400 backdrop-blur"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
					بانتظار المراجعة
				</span>
			{:else}
				<span
					class="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-zinc-950/60 px-2 py-0.5 text-[10px] font-medium text-emerald-400 backdrop-blur"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
					معتمد
				</span>
			{/if}

				<!-- Date-of-addition chip (bottom-left, muted) -->
			{#if video.created_at}
				<span
					class="absolute bottom-2 left-2 flex items-center gap-1 rounded border border-zinc-700/40 bg-zinc-950/60 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 backdrop-blur"
					title="تاريخ الإضافة: {new Date(video.created_at).toLocaleString('ar')}"
				>
					<svg class="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<rect x="3" y="4" width="18" height="18" rx="2" />
						<path d="M16 2v4 M8 2v4 M3 10h18" />
					</svg>
					{relTimeAr(video.created_at)}
				</span>
			{/if}

			<!-- Hover overlay with play icon -->
			<div
				class="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition group-hover:opacity-100"
			>
				<div class="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur">
					<svg class="h-5 w-5 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M8 5v14l11-7z" />
					</svg>
				</div>
			</div>

		</div>
	</button>

	<!-- Body: compact — the editor select doubles as the category display (one category control per card) -->
	<div class="flex flex-col gap-1.5 p-3">
		<h3 class="line-clamp-2 text-[13px] font-medium leading-snug text-zinc-100" title={video.title ?? ''}>
			{video.title ?? 'بدون عنوان'}
		</h3>

		<!-- Inline category editor: a real POST form (?/set-category). -->
		<form
			method="POST"
			action="?/set-category"
			use:enhance={categorySubmit}
			class="flex items-center gap-1.5"
		>
			<input type="hidden" name="id" value={video.id} />
			<label class="text-[11px] font-medium text-zinc-500" for="cat-{video.id}">التصنيف</label>
			<select
				id="cat-{video.id}"
				name="category"
				value={currentCategory}
				onchange={(e) => {
					const select = e.currentTarget as HTMLSelectElement;
					if (select.value !== currentCategory) {
						(select.closest('form') as HTMLFormElement).requestSubmit();
					} else {
						select.value = currentCategory;
					}
				}}
				disabled={isAnyBusy}
				class="h-7 min-w-0 flex-1 cursor-pointer rounded-md border border-zinc-800 bg-zinc-800/60 px-1.5 text-[11px] font-medium text-zinc-300 transition hover:border-zinc-600 focus:border-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
			>
				<option value="">— بدون —</option>
				{#each categories as cat (cat)}
					<option value={cat} selected={cat === currentCategory}>{cat}</option>
				{/each}
				{#if currentCategory && !categories.includes(currentCategory)}
					<option value={currentCategory} selected>{currentCategory}</option>
				{/if}
			</select>
			<!-- No-JS fallback submit button -->
			<button
				type="submit"
				class="hidden noscript:block rounded-md border border-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-300"
			>
				تطبيق
			</button>
		</form>

		<!-- Video ID: always visible (truncated), click the row to copy -->
		<button
			type="button"
			onclick={copyId}
			class="flex w-full cursor-pointer items-center gap-1 rounded-md bg-zinc-800/40 px-2 py-1 text-start text-[10px] font-mono text-zinc-500 transition hover:bg-zinc-800/60 hover:text-zinc-400"
			title="انقر للنسخ: {video.id}"
			aria-label="نسخ معرّف الفيديو {video.id}"
		>
			<svg class="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
				<rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
				<line x1="6" y1="6" x2="6.01" y2="6" />
				<line x1="6" y1="18" x2="6.01" y2="18" />
			</svg>
			<span class="truncate font-mono" dir="ltr" data-copy-target={video.id}>{video.id}</span>
		</button>

		<!-- Actions: ghost buttons for approve/revert, delete -->
		<div class="grid grid-cols-2 gap-1.5">
			{#if mode === 'pending'}
				<!-- APPROVE (ghost button — slate background) -->
				<form method="POST" action="?/approve" use:enhance={submit} class="contents">
					<input type="hidden" name="id" value={video.id} />
					<input type="hidden" name="intent" value="approve" />
					<button
						type="submit"
						disabled={isAnyBusy}
						title="اعتماد الفيديو"
						class="flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/70 px-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{#if isBusy}
							<svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
								<path class="opacity-90" fill="currentColor" d="M21 12a9 9 0 1 1-6.22-8.56" />
							</svg>
							جارٍ…
						{:else}
							<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="m5 13 4 4L19 7" />
							</svg>
							اعتماد
						{/if}
					</button>
				</form>
			{:else}
				<!-- REVERT (ghost button) -->
				<form method="POST" action="?/revert" use:enhance={submit} class="contents">
					<input type="hidden" name="id" value={video.id} />
					<input type="hidden" name="intent" value="revert" />
					<button
						type="submit"
						disabled={isAnyBusy}
						title="إرجاع إلى قائمة المراجعة"
						class="flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/70 px-2 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{#if isBusy}
							<svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
								<path class="opacity-90" fill="currentColor" d="M21 12a9 9 0 1 1-6.22-8.56" />
							</svg>
							جارٍ…
						{:else}
							<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="M9 14 4 9l5-5" />
								<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
							</svg>
							إرجاع
						{/if}
					</button>
				</form>
			{/if}

			<!-- DELETE -->
			<form
				method="POST"
				action="?/delete"
				use:enhance={submit}
				onsubmit={handleConfirmDelete}
				class="contents"
			>
				<input type="hidden" name="id" value={video.id} />
				<input type="hidden" name="intent" value="delete" />
				<button
					type="submit"
					disabled={isAnyBusy}
					title="حذف نهائي"
					class="flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/50 px-2 text-xs font-medium text-zinc-500 transition hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{#if isBusy}
						<svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
							<path class="opacity-90" fill="currentColor" d="M21 12a9 9 0 1 1-6.22-8.56" />
						</svg>
						جارٍ…
					{:else}
						<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M10 11v6 M14 11v6" />
						</svg>
						حذف
					{/if}
				</button>
			</form>
		</div>
	</div>
</article>
