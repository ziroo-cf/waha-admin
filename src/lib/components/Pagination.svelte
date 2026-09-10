<script lang="ts">
	import { PER_PAGE_OPTIONS } from '$lib/types';

	interface Props {
		page: number;
		perPage: number;
		total: number;
		totalPages: number;
		onnavigate: (page: number) => void;
		onPerPageChange: (n: number) => void;
		busy?: boolean;
	}

	let { page, perPage, total, totalPages, onnavigate, onPerPageChange, busy = false }: Props = $props();

	const rangeStart = $derived(total === 0 ? 0 : (page - 1) * perPage + 1);
	const rangeEnd = $derived(Math.min(page * perPage, total));

	/** Compact page list with ellipses: 1 … (p-1 p p+1) … N. */
	const pages = $derived.by(() => {
		const out: (number | '…')[] = [];
		const push = (n: number | '…') => out.push(n);
		if (totalPages <= 7) {
			for (let i = 1; i <= totalPages; i++) push(i);
			return out;
		}
		push(1);
		if (page > 3) push('…');
		for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) push(i);
		if (page < totalPages - 2) push('…');
		push(totalPages);
		return out;
	});

	const btnBase =
		'flex h-8 min-w-8 items-center justify-center rounded-md border text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40';
	const btnIdle =
		'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800';
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
	<!-- Range summary + per-page selector -->
	<div class="flex flex-wrap items-center gap-3">
		<p class="text-xs text-zinc-500 tabular-nums">
			{rangeStart}–{rangeEnd} من أصل <span class="font-medium text-zinc-400">{total}</span>
		</p>
		<label class="flex items-center gap-1.5 text-xs text-zinc-500">
			عناصر لكل صفحة
			<select
				value={perPage}
				onchange={(e) => onPerPageChange(Number((e.currentTarget as HTMLSelectElement).value))}
				disabled={busy}
				class="h-7 cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-1.5 text-xs text-zinc-300 focus:border-zinc-500 focus:outline-none"
			>
				{#each PER_PAGE_OPTIONS as n (n)}
					<option value={n}>{n}</option>
				{/each}
			</select>
		</label>
	</div>

	<!-- Page navigation -->
	<div class="flex items-center gap-1" role="navigation" aria-label="تنقل الصفحات">
		<button
			type="button"
			class="{btnBase} {btnIdle} px-2"
			disabled={page <= 1 || busy}
			onclick={() => onnavigate(page - 1)}
			aria-label="الصفحة السابقة"
		>
			<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="m9 18 6-6-6-6" />
			</svg>
		</button>

		{#each pages as p, i (i)}
			{#if p === '…'}
				<span class="flex h-8 min-w-8 items-center justify-center text-xs text-zinc-600">…</span>
			{:else}
				<button
					type="button"
					class="{btnBase} {p === page
						? 'border-blue-500/60 bg-blue-600/20 text-blue-300'
						: btnIdle}"
					disabled={busy}
					onclick={() => onnavigate(p)}
					aria-current={p === page ? 'page' : undefined}
				>
					{p}
				</button>
			{/if}
		{/each}

		<button
			type="button"
			class="{btnBase} {btnIdle} px-2"
			disabled={page >= totalPages || busy}
			onclick={() => onnavigate(page + 1)}
			aria-label="الصفحة التالية"
		>
			<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="m15 18-6-6 6-6" />
			</svg>
		</button>
	</div>
</div>
