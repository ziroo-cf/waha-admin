<script lang="ts">
	import type { ActivityEntry } from '$lib/types';

	interface Props {
		open: boolean;
		entries: ActivityEntry[];
		onclose: () => void;
		/** Execute the revert server action for an undoable entry. */
		onundo: (entry: ActivityEntry) => void;
		/** Ids of entries currently being reverted. */
		undoingIds?: Set<number>;
		/** Clear the whole log. */
		onclear: () => void;
	}

	let { open, entries, onclose, onundo, undoingIds = new Set(), onclear }: Props = $props();

	const UNDO_SECONDS = 8;

	function relTime(iso: string): string {
		const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
		if (diff < 5) return 'الآن';
		if (diff < 60) return `قبل ${diff} ثانية`;
		if (diff < 3600) return `قبل ${Math.floor(diff / 60)} دقيقة`;
		if (diff < 86400) return `قبل ${Math.floor(diff / 3600)} ساعة`;
		return `قبل ${Math.floor(diff / 86400)} يوم`;
	}

	function kindStyle(kind: ActivityEntry['kind']): { dot: string; text: string; ring: string } {
		switch (kind) {
			case 'success':
				return { dot: 'bg-emerald-400', text: 'text-emerald-300', ring: 'border-emerald-500/20' };
			case 'error':
				return { dot: 'bg-red-400', text: 'text-red-300', ring: 'border-red-500/20' };
			case 'undo':
				return { dot: 'bg-sky-400', text: 'text-sky-300', ring: 'border-sky-500/20' };
			default:
				return { dot: 'bg-zinc-400', text: 'text-zinc-300', ring: 'border-zinc-500/20' };
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
{#if open}
	<button
		type="button"
		class="fixed inset-0 z-40 h-full w-full cursor-default bg-black/60 backdrop-blur-sm"
		onclick={onclose}
		aria-label="إغلاق سجل النشاط"
	></button>
{/if}

<!-- Drawer (slides from the left edge in RTL layouts) -->
<aside
	class="fixed inset-y-0 left-0 z-40 flex w-[22rem] max-w-[90vw] flex-col border-e border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-300 {open
		? 'translate-x-0'
		: '-translate-x-full'}"
	aria-label="سجل النشاط"
>
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
		<div class="flex items-center gap-2.5">
			<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800 text-zinc-400">
				<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M3 12h.01" />
					<path d="M12 12h.01" />
					<path d="M21 12h.01" />
					<path d="M8.5 8.5 6 6" />
					<path d="m17.5 6-2.5 2.5" />
					<path d="M12 10V4" />
				</svg>
			</div>
			<div>
				<h3 class="text-sm font-semibold text-zinc-100">سجل النشاط</h3>
				<p class="text-[11px] text-zinc-500">آخر {entries.length} عملية</p>
			</div>
		</div>
		<div class="flex items-center gap-1">
			{#if entries.length > 0}
				<button
					type="button"
					onclick={onclear}
					class="flex h-7 items-center rounded-md px-2 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
					title="تفريغ السجل"
				>
					تفريغ
				</button>
			{/if}
			<button
				type="button"
				onclick={onclose}
				class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
				aria-label="إغلاق"
			>
				<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M18 6 6 18 M6 6l12 12" />
				</svg>
			</button>
		</div>
	</div>

	<!-- Entries -->
	<div class="flex-1 overflow-y-auto p-3">
		{#if entries.length === 0}
			<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
				<div class="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-900 text-zinc-600">
					<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M12 8v4l3 3" />
						<circle cx="12" cy="12" r="10" />
					</svg>
				</div>
				<p class="text-xs font-medium text-zinc-400">لا توجد عمليات بعد</p>
				<p class="max-w-[16rem] text-[11px] text-zinc-600">
					ستظهر هنا كل عمليات الاعتماد والحذف والتعديل أثناء عملك.
				</p>
			</div>
		{:else}
			<ol class="flex flex-col gap-2">
				{#each entries as entry (entry.id)}
					{@const style = kindStyle(entry.kind)}
					<li class="rounded-xl border {style.ring} bg-zinc-900/70 p-3">
						<div class="flex items-start gap-2.5">
							<span class="relative mt-1 flex h-2 w-2 shrink-0" aria-hidden="true">
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 {style.dot}"></span>
								<span class="relative inline-flex h-2 w-2 rounded-full {style.dot}"></span>
							</span>
							<div class="min-w-0 flex-1">
								<p class="text-xs leading-relaxed {style.text}">{entry.text}</p>
								<p class="mt-1 text-[10px] text-zinc-500">{relTime(entry.at)}</p>
							</div>
							{#if entry.undo}
								<button
									type="button"
									disabled={undoingIds.has(entry.id)}
									onclick={() => onundo(entry)}
									class="flex h-7 shrink-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-[10px] font-semibold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
								>
									<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<path d="M9 14 4 9l5-5" />
										<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
									</svg>
									{undoingIds.has(entry.id) ? 'جارٍ…' : 'تراجع'}
								</button>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</div>

	<!-- Footer hint -->
	<div class="border-t border-zinc-800 px-4 py-2.5">
		<p class="text-[10px] leading-relaxed text-zinc-600">
			التراجع متاح لمدة {UNDO_SECONDS} ثوانٍ من الإشعار، أو في أي وقت من هذا السجل.
		</p>
	</div>
</aside>
