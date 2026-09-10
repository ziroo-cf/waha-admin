<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { CATEGORIES } from '$lib/types';

	interface Props {
		open: boolean;
		onclose: () => void;
		/** Called with the server result so the page can log + toast. */
		onresult: (payload: { success?: boolean; message?: string }, type: 'success' | 'failure' | 'error') => void;
	}

	let { open, onclose, onresult }: Props = $props();

	let input = $state('');
	let category = $state<(typeof CATEGORIES)[number]>('عام');
	let importing = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);

	// Preserve current URL so we can force a fresh load after success.
		// Keep the current URL so we can force a fresh load after a successful
	// import. This is browser-only — guarded so SSR doesn't crash.
	let currentUrl = $state('');
	import { onMount } from 'svelte';
	onMount(() => {
		currentUrl = window.location.pathname + window.location.search;
	});

	// Reset + focus the input whenever the modal opens.
	$effect(() => {
		if (open) {
			input = '';
			category = 'عام';
			importing = false;
			setTimeout(() => inputEl?.focus(), 30);
		}
	});

	const handleSubmit: SubmitFunction = ({ cancel }) => {
		if (importing) {
			cancel();
			return () => {};
		}
		importing = true;
		return async ({ update, result }) => {
			importing = false;
			await update({ reset: false });
			if (result.type === 'success' || result.type === 'failure') {
				onresult(
					(result.data ?? {}) as { success?: boolean; message?: string },
					result.type === 'success' ? 'success' : 'failure'
				);
				if (result.type === 'success') {
					// Close the modal and refresh server data by re-visiting the
					// current URL (triggers a fresh `load` call).
					onclose();
					goto(currentUrl, { noScroll: true, keepFocus: true, replaceState: true });
				}
			} else {
				onresult({}, 'error');
			}
		};
	};

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
		<button
			type="button"
			class="absolute inset-0 h-full w-full cursor-default bg-black/80 backdrop-blur-sm"
			onclick={onclose}
			aria-label="إغلاق نافذة الاستيراد"
		></button>

		<div
			class="relative z-10 w-full max-w-lg rounded-2xl border border-zinc-700/60 bg-zinc-900 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-label="استيراد محتوى"
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
				<div class="flex items-center gap-3">
					<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
						<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<path d="m7 10 5 5 5-5" />
							<path d="M12 15V3" />
						</svg>
					</div>
					<div>
						<h3 class="text-sm font-semibold text-zinc-100">استيراد محتوى</h3>
						<p class="text-[11px] text-zinc-500">جلب الفيديوهات من يوتيوب وإضافتها إلى قائمة المراجعة</p>
					</div>
				</div>
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

			<!-- Body -->
			<form method="POST" action="?/importFromWorker" use:enhance={handleSubmit} class="px-4 py-4">
				<!-- `input` — YouTube URL / Playlist ID / Channel ID -->
				<label for="import-input" class="mb-1.5 block text-xs font-medium text-zinc-400">
					الرابط أو المعرّف
				</label>
				<input
					bind:this={inputEl}
					bind:value={input}
					id="import-input"
					name="input"
					type="text"
					dir="ltr"
					placeholder="رابط يوتيوب أو معرّف UC…"
					required
					disabled={importing}
					aria-describedby="import-hint"
					class="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 transition focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
				/>
				<p id="import-hint" class="mt-2 text-[11px] leading-relaxed text-zinc-500">
				يدعم رابط فيديو أو قائمة أو قناة (معرّف <span dir="ltr">UC…</span>).
				تُستفاد البيانات مباشرة من YouTube Data API، وتُحفظ الفيديوهات المستوردة بحالة
				<span class="rounded bg-amber-500/10 px-1 font-medium text-amber-400">pending</span>.
				</p>

				<!-- `category` select -->
				<label for="import-category" class="mt-4 mb-1.5 block text-xs font-medium text-zinc-400">
					التصنيف
				</label>
				<select
					bind:value={category}
					id="import-category"
					name="category"
					disabled={importing}
					class="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 text-sm text-zinc-300 transition focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#each CATEGORIES as cat (cat)}
						<option value={cat}>{cat}</option>
					{/each}
				</select>

				<!-- Footer -->
				<div class="mt-5 flex items-center justify-end gap-2 border-t border-zinc-800 pt-3">
					<button
						type="button"
						onclick={onclose}
						class="h-9 rounded-lg border border-zinc-700 px-4 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800"
					>
						إلغاء
					</button>
					<button
						type="submit"
						disabled={importing || input.trim().length === 0}
						class="flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{#if importing}
							<svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
								<path class="opacity-90" fill="currentColor" d="M21 12a9 9 0 1 1-6.22-8.56" />
							</svg>
							جارٍ الاستيراد…
						{:else}
							<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
								<path d="m7 10 5 5 5-5" />
								<path d="M12 15V3" />
							</svg>
							استيراد
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
