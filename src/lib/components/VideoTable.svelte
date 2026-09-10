<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { VideoRow } from '$lib/types';
	import { relTimeAr } from '$lib/utils/date';

	interface Props {
		videos: VideoRow[];
		busyId: string | null;
		/** which moderation list is shown ('all' shows a real status badge per row) */
		mode: 'pending' | 'approved' | 'all';
		submit: SubmitFunction;
		categorySubmit: SubmitFunction;
		titleSubmit: SubmitFunction;
		categories: readonly string[];
		selected: Set<string>;
		ontoggleselect: (id: string) => void;
		onselectall: () => void;
		previewVideo: (video: VideoRow) => void;
	}

	let {
		videos,
		busyId,
		mode,
		submit,
		categorySubmit,
		titleSubmit,
		categories,
		selected,
		ontoggleselect,
		onselectall,
		previewVideo
	}: Props = $props();

	const isAnyBusy = $derived(busyId !== null);
	const allSelected = $derived(videos.length > 0 && videos.every((v) => selected.has(v.id)));

	/* ── Inline title editing ─────────────────────────────── */
	let editingId = $state<string | null>(null);
	let draftTitle = $state('');

	function startEdit(video: VideoRow) {
		editingId = video.id;
		draftTitle = video.title ?? '';
	}

	function cancelEdit() {
		editingId = null;
		draftTitle = '';
	}

	function onEditKeydown(e: KeyboardEvent, video: VideoRow) {
		if (e.key === 'Enter') {
			e.preventDefault();
			const form = (e.currentTarget as HTMLElement).closest('form') as HTMLFormElement | null;
			form?.requestSubmit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	function onEditBlur(e: FocusEvent, video: VideoRow) {
		// Save on blur only when the value actually changed.
		if (editingId !== video.id) return;
		const input = e.currentTarget as HTMLInputElement;
		if (input.value.trim() && input.value.trim() !== (video.title ?? '')) {
			const form = input.closest('form') as HTMLFormElement | null;
			form?.requestSubmit();
		} else {
			cancelEdit();
		}
	}

	const placeholderThumb =
		'data:image/svg+xml;utf8,' +
		encodeURIComponent(
			`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#27272a"/></svg>`
		);
</script>

<div class="min-w-[52rem] overflow-x-auto rounded-xl border border-zinc-800/80 bg-zinc-900/80">
	<table class="w-full text-right text-xs">
		<thead>
			<tr class="border-b border-zinc-800 bg-zinc-900/60">
				<th class="h-10 w-10 px-3 align-middle">
					<input
						type="checkbox"
						class="h-4 w-4 cursor-pointer rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/50"
						checked={allSelected}
						onchange={onselectall}
						aria-label="تحديد الكل"
					/>
				</th>
				<th class="px-3 align-middle font-medium text-zinc-400">الفيديو</th>
				<th class="px-3 align-middle font-medium text-zinc-400">التصنيف</th>
				<th class="w-28 px-3 align-middle font-medium text-zinc-400" title="ترتيب حسب تاريخ الإضافة">تاريخ الإضافة</th>
				<th class="w-28 px-3 align-middle font-medium text-zinc-400">الحالة</th>
				<th class="w-28 px-3 align-middle font-medium text-zinc-400">المعرّف</th>
				<th class="w-32 px-3 align-middle font-medium text-zinc-400">الإجراءات</th>
			</tr>
		</thead>
		<tbody class="divide-y divide-zinc-800/60">
			{#each videos as video (video.id)}
				<tr
					class="transition hover:bg-zinc-800/40 {selected.has(video.id) ? 'bg-blue-500/5' : ''} {busyId === video.id ? 'opacity-50' : ''}"
				>
					<!-- Checkbox -->
					<td class="p-2">
						<label class="flex cursor-pointer items-center">
							<input
								type="checkbox"
								class="h-4 w-4 cursor-pointer rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/50"
								checked={selected.has(video.id)}
								onchange={() => ontoggleselect(video.id)}
							/>
						</label>
					</td>

					<!-- Video info + inline-editable title -->
					<td class="p-2">
						<div class="flex items-center gap-3">
							<button
								type="button"
								onclick={() => previewVideo(video)}
								class="flex h-10 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded bg-zinc-800 text-zinc-500 transition hover:ring-1 hover:ring-blue-500/50"
								title="معاينة الفيديو"
								aria-label="معاينة {video.title ?? video.id}"
							>
								{#if video.thumbnail}
									<img
										src={video.thumbnail}
										alt=""
										class="h-full w-full object-cover"
										loading="lazy"
										onerror={(e) => ((e.currentTarget as HTMLImageElement).src = placeholderThumb)}
									/>
								{:else}
									<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<path d="M22 8.5a2.5 2.5 0 0 0-2.5-2.5h-13A2.5 2.5 0 0 0 4 8.5v7A2.5 2.5 0 0 0 6.5 18h13a2.5 2.5 0 0 0 2.5-2.5Z" />
										<path d="M22 9.5l-4.5 2.5 4.5 2.5Z" />
									</svg>
								{/if}
							</button>

							<div class="min-w-0 flex-1">
								{#if editingId === video.id}
									<!-- Inline edit form (?/update-title) -->
									<form
										method="POST"
										action="?/update-title"
										use:enhance={titleSubmit}
										class="flex items-center gap-1"
									>
										<input type="hidden" name="id" value={video.id} />
										<input
											type="text"
											name="title"
											bind:value={draftTitle}
											onkeydown={(e) => onEditKeydown(e, video)}
											onblur={(e) => onEditBlur(e, video)}
											disabled={isAnyBusy}
											class="h-7 w-full min-w-0 rounded-md border border-blue-500/60 bg-zinc-950 px-2 text-xs text-zinc-100 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
											aria-label="تعديل العنوان"
										/>
									</form>
								{:else}
									<button
										type="button"
										ondblclick={() => startEdit(video)}
										onclick={() => startEdit(video)}
										class="block w-full truncate rounded px-1 py-0.5 text-start font-medium text-zinc-200 transition hover:bg-zinc-800 hover:text-zinc-100"
										title="{video.title ?? 'بدون عنوان'} — انقر للتعديل"
									>
										{video.title ?? 'بدون عنوان'}
									</button>
								{/if}
			</div>
						</div>
					</td>

					<!-- Category: instant save on change (?/set-category) -->
					<td class="p-2">
						<form method="POST" action="?/set-category" use:enhance={categorySubmit} class="flex items-center">
							<input type="hidden" name="id" value={video.id} />
							<select
								name="category"
								value={video.category ?? ''}
								onchange={(e) => {
									const sel = e.currentTarget as HTMLSelectElement;
									if (sel.value !== (video.category ?? '')) {
										(sel.closest('form') as HTMLFormElement).requestSubmit();
									}
								}}
								disabled={isAnyBusy}
								class="h-7 w-32 cursor-pointer rounded-md border border-zinc-700 bg-zinc-800/60 px-1.5 text-[11px] text-zinc-300 transition hover:border-zinc-600 focus:border-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
							>
								<option value="">— بدون —</option>
								{#each categories as cat (cat)}
									<option value={cat} selected={cat === video.category}>{cat}</option>
								{/each}
								{#if video.category && !categories.includes(video.category)}
									<option value={video.category} selected>{video.category}</option>
								{/if}
							</select>
						</form>
					</td>

					<!-- Date of addition -->
					<td class="whitespace-nowrap p-2 text-zinc-500" title={video.created_at ? new Date(video.created_at).toLocaleString('ar') : ''}>
						{#if video.created_at}
							{relTimeAr(video.created_at)}
						{:else}
							<span class="text-zinc-700">—</span>
						{/if}
					</td>

					<!-- Status badge -->
					<td class="p-2">
						{#if mode === 'all' ? video.status === 'approved' : mode === 'approved'}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
								معتمد
							</span>
						{:else}
							<span
								class="inline-flex inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
								بانتظار المراجعة
							</span>
						{/if}
					</td>

					<!-- Video ID (copyable) -->
					<td class="p-2" dir="ltr">
						<div class="flex items-center gap-1">
							<span class="truncate font-mono text-zinc-500" title={video.id}>{video.id}</span>
							<button
								type="button"
								onclick={() => navigator.clipboard?.writeText(video.id)}
								class="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-zinc-600 transition hover:bg-zinc-700 hover:text-zinc-400"
								title="نسخ المعرف"
							>
								<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
									<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
								</svg>
							</button>
						</div>
					</td>

					<!-- Actions -->
					<td class="p-2">
						<div class="flex items-center gap-1">
							{#if mode !== 'approved' && video.status !== 'approved'}
								<!-- Approve -->
								<form method="POST" action="?/approve" use:enhance={submit} class="contents">
									<input type="hidden" name="id" value={video.id} />
									<button
										type="submit"
										disabled={isAnyBusy}
										title="اعتماد الفيديو"
										class="flex h-7 items-center justify-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/70 px-2 text-[11px] font-semibold text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
									>
										{#if busyId === video.id}
											<svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
												<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
												<path class="opacity-90" fill="currentColor" d="M21 12a9 9 0 1 1-6.22-8.56" />
											</svg>
										{:else}
											<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
												<path d="m5 13 4 4L19 7" />
											</svg>
										{/if}
										اعتماد
									</button>
								</form>
							{:else}
								<!-- Revert -->
								<form method="POST" action="?/revert" use:enhance={submit} class="contents">
									<input type="hidden" name="id" value={video.id} />
									<button
										type="submit"
										disabled={isAnyBusy}
										title="إرجاع إلى قائمة المراجعة"
										class="flex h-7 items-center justify-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/70 px-2 text-[11px] font-medium text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
									>
										{#if busyId === video.id}
											<svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
												<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
												<path class="opacity-90" fill="currentColor" d="M21 12a9 9 0 1 1-6.22-8.56" />
											</svg>
										{:else}
											<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
												<path d="M9 14 4 9l5-5" />
												<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
											</svg>
										{/if}
										إرجاع
									</button>
								</form>
							{/if}

							<!-- Delete -->
							<form
								method="POST"
								action="?/delete"
								use:enhance={submit}
								onsubmit={(e) => {
									if (!confirm('حذف هذا الفيديو؟ يمكنك التراجع من الإشعار خلال ثوانٍ.')) {
										e.preventDefault();
									}
								}}
								class="contents"
							>
								<input type="hidden" name="id" value={video.id} />
								<button
									type="submit"
									disabled={isAnyBusy}
									title="حذف"
									class="flex h-7 items-center justify-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/50 px-2 text-[11px] font-medium text-zinc-500 transition hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
								>
									{#if busyId === video.id}
										<svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
											<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
											<path class="opacity-90" fill="currentColor" d="M21 12a9 9 0 1 1-6.22-8.56" />
										</svg>
									{:else}
										<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
											<path d="M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M10 11v6 M14 11v6" />
										</svg>
									{/if}
									حذف
								</button>
							</form>
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
