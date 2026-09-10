<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';
	import VideoCard from '$lib/components/VideoCard.svelte';
	import VideoTable from '$lib/components/VideoTable.svelte';
	import VideoModal from '$lib/components/VideoModal.svelte';
	import ImportModal from '$lib/components/ImportModal.svelte';
	import ActivityDrawer from '$lib/components/ActivityDrawer.svelte';
	import Pagination from '$lib/components/Pagination.svelte';
	import type { VideoRow, StatusTab, ActivityEntry, UndoPayload, SortDir } from '$lib/types';
	import { CATEGORIES } from '$lib/types';
	import { relTimeAr } from '$lib/utils/date';

	let { data }: PageProps = $props();

	// ── URL-driven state (single source of truth: the server) ──────
	const tab = $derived(data.tab);
	const stats = $derived(data.stats);
	const videos = $derived(data.videos);
	/** Fixed category list — same on every screen, never DB-derived. */
	const categories: readonly string[] = CATEGORIES;

	// ── View mode ──────────────────────────────────────────────────
	type ViewMode = 'grid' | 'table';
	let viewMode = $state<ViewMode>('grid');

	// ── Search (debounced, server-side) ───────────────────────────
	// Initialized from `data.q` by the sync effect on mount.
	let query = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let searchInput: HTMLInputElement | null = null;

	// Sync the box when navigation happens externally (e.g. back/forward),
	// but never clobber what the user is actively typing.
	$effect(() => {
		if (document.activeElement !== searchInput) query = data.q;
	});

	/** URL params of the current view as a mutable map. */
	function currentParams(): URLSearchParams {
		const sp = new URLSearchParams();
		sp.set('status', tab);
		if (data.q) sp.set('q', data.q);
		if (data.category) sp.set('category', data.category);
		sp.set('perPage', String(data.perPage));
		sp.set('page', String(data.page));
		sp.set('sort', data.sort);
		return sp;
	}

	/** Patch URL params → triggers a server round-trip through `load`. */
	function navigate(patch: Record<string, string | number | null>, opts: { resetPage?: boolean } = {}) {
		const sp = currentParams();
		for (const [k, v] of Object.entries(patch)) {
			if (v === null || v === '') sp.delete(k);
			else sp.set(k, String(v));
		}
		if (opts.resetPage) sp.set('page', '1');
		goto(`/?${sp.toString()}`, { noScroll: true, keepFocus: true, replaceState: true });
	}

	function handleSearchInput() {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			navigate({ q: query.trim() || null }, { resetPage: true });
		}, 400);
	}

	function clearFilters() {
		query = '';
		navigate({ q: null, category: null }, { resetPage: true });
	}

	function switchTab(next: StatusTab) {
		clearSelection();
		navigate({ status: next }, { resetPage: true });
	}

	function switchSort(next: SortDir) {
		navigate({ sort: next }, { resetPage: true });
	}

	const hasActiveFilters = $derived(Boolean(data.q || data.category));

	// ── Selection ─────────────────────────────────────────────────
	let selectedIds = $state<Set<string>>(new Set());

	function toggleSelect(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	}

	function selectAllVisible() {
		const next = new Set(selectedIds);
		for (const v of videos) next.add(v.id);
		selectedIds = next;
	}

	function toggleSelectAll() {
		if (videos.length > 0 && videos.every((v) => selectedIds.has(v.id))) {
			selectedIds = new Set();
		} else {
			selectAllVisible();
		}
	}

	function clearSelection() {
		selectedIds = new Set();
	}

	const selectedCount = $derived(selectedIds.size);

	// ── Per-row pending state ─────────────────────────────────────
	let busyId = $state<string | null>(null);
	let bulkBusy = $state<
		null | 'approve-all' | 'approve-selected' | 'delete-selected' | 'bulk-set-category'
	>(null);

	// ── Modal state ───────────────────────────────────────────────
	let previewVideoState = $state<VideoRow | null>(null);
	let previewOpen = $state(false);
	let importOpen = $state(false);

	function openPreview(video: VideoRow) {
		previewVideoState = video;
		previewOpen = true;
	}

	function closePreview() {
		previewOpen = false;
		previewVideoState = null;
	}

	// ── Activity audit log (client-side reactive) ─────────────────
	let activityOpen = $state(false);
	let entries = $state<ActivityEntry[]>([]);
	let entrySeq = 0;
	let undoneEntryIds = $state<Set<number>>(new Set());
	let undoingEntryIds = $state<Set<number>>(new Set());

	function logActivity(text: string, kind: ActivityEntry['kind'], undo?: UndoPayload): number {
		const id = ++entrySeq;
		entries = [{ id, text, kind, at: new Date().toISOString(), undo }, ...entries].slice(0, 100);
		return id;
	}

	// ── Toasts with Undo ──────────────────────────────────────────
	type Toast = { id: number; text: string; kind: 'success' | 'error'; entryId?: number };
	let toasts = $state<Toast[]>([]);
	let toastSeq = 0;

	function pushToast(text: string, kind: Toast['kind'], entryId?: number) {
		const id = ++toastSeq;
		toasts = [...toasts, { id, text, kind, entryId }];
		setTimeout(() => dismissToast(id), 8000);
	}

	function dismissToast(id: number) {
		toasts = toasts.filter((t) => t.id !== id);
	}

	/** Shared result handling: toast + audit entry (+ undo wiring). */
	function applyResult(
		payload: { success?: boolean; message?: string; undo?: UndoPayload } | undefined,
		type: 'success' | 'failure' | 'error'
	) {
		if (type === 'error') {
			const entryId = logActivity('حدث خطأ غير متوقع في الخادم.', 'error');
			pushToast('حدث خطأ غير متوقع في الخادم.', 'error', entryId);
			return;
		}
		if (payload?.success) {
			const msg = payload.message ?? 'تمت العملية بنجاح.';
			const entryId = logActivity(msg, 'success', payload.undo);
			pushToast(msg, 'success', entryId);
		} else if (payload?.message) {
			const entryId = logActivity(payload.message, 'error');
			pushToast(payload.message, 'error', entryId);
		}
	}

	// ── Undo execution (hidden enhanced form → ?/undo) ────────────
	let undoFormEl: HTMLFormElement | null = null;
	let undoInputEl: HTMLInputElement | null = null;

	function triggerUndo(entry: ActivityEntry) {
		if (!entry.undo || !undoFormEl || !undoInputEl) return;
		undoingEntryIds = new Set([...undoingEntryIds, entry.id]);
		undoInputEl.value = JSON.stringify(entry.undo);
		undoFormEl.requestSubmit();
	}

	const handleUndo: SubmitFunction = ({ cancel }) => {
		if (undoingEntryIds.size === 0) {
			cancel();
			return () => {};
		}
		return async ({ update, result }) => {
			if (result.type === 'success' || result.type === 'failure') {
				const payload = (result.data ?? {}) as { success?: boolean; message?: string };
				if (payload.success) {
					// Mark every in-flight undo entry as reverted.
					const done = new Set(undoneEntryIds);
					for (const id of undoingEntryIds) done.add(id);
					undoneEntryIds = done;
					entries = entries.map((e) =>
						undoingEntryIds.has(e.id) ? { ...e, undo: undefined, kind: 'undo' as const } : e
					);
					toasts = toasts.map((t) => (undoingEntryIds.has(t.entryId ?? -1) ? { ...t, entryId: undefined } : t));
					const entryId = logActivity(payload.message ?? 'تم التراجع عن العملية بنجاح.', 'undo');
					pushToast(payload.message ?? 'تم التراجع عن العملية بنجاح.', 'success', entryId);
				} else if (payload.message) {
					const entryId = logActivity(payload.message, 'error');
					pushToast(payload.message, 'error', entryId);
				}
			} else {
				applyResult(undefined, 'error');
			}
			undoingEntryIds = new Set();
			await update({ reset: false });
		};
	};

	// ── Row actions (approve / revert / delete) ───────────────────
	const handleSubmit: SubmitFunction = ({ formData, cancel }) => {
		const id = String(formData.get('id') ?? '');
		if (busyId !== null) {
			cancel();
			return () => {};
		}
		busyId = id;
		return async ({ update, result }) => {
			busyId = null;
			if (result.type === 'success' || result.type === 'failure') {
				applyResult(
					result.data as { success?: boolean; message?: string; undo?: UndoPayload } | undefined,
					result.type === 'success' ? 'success' : 'failure'
				);
				const payload = result.data as { success?: boolean } | undefined;
				if (payload?.success && String(formData.get('intent')) === 'delete') {
					const next = new Set(selectedIds);
					next.delete(id);
					selectedIds = next;
				}
			} else {
				applyResult(undefined, 'error');
			}
			await update({ reset: false });
		};
	};

	// ── Per-row category / title forms ────────────────────────────
	function makeFieldHandler(): SubmitFunction {
		return ({ formData, cancel }) => {
			const id = String(formData.get('id') ?? '');
			if (busyId !== null) {
				cancel();
				return () => {};
			}
			busyId = id;
			return async ({ update, result }) => {
				busyId = null;
				if (result.type === 'success' || result.type === 'failure') {
					applyResult(
						result.data as { success?: boolean; message?: string; undo?: UndoPayload } | undefined,
						result.type === 'success' ? 'success' : 'failure'
					);
				} else {
					applyResult(undefined, 'error');
				}
				await update({ reset: false });
			};
		};
	}

	const handleCategory = makeFieldHandler();
	const handleTitle = makeFieldHandler();

	// ── Bulk actions ──────────────────────────────────────────────
	const handleBulk: SubmitFunction = ({ formData, cancel }) => {
		const action = String(formData.get('bulk') ?? '') as typeof bulkBusy;
		if (bulkBusy !== null) {
			cancel();
			return () => {};
		}
		bulkBusy = action || 'approve-selected';
		return async ({ update, result }) => {
			bulkBusy = null;
			if (result.type === 'success' || result.type === 'failure') {
				const payload = result.data as
					| { success?: boolean; message?: string; undo?: UndoPayload }
					| undefined;
				applyResult(payload, result.type === 'success' ? 'success' : 'failure');
				if (payload?.success && (action === 'approve-selected' || action === 'delete-selected')) {
					clearSelection();
				}
			} else {
				applyResult(undefined, 'error');
			}
			await update({ reset: false });
		};
	};

	// ── Confirm helpers ───────────────────────────────────────────
	function handleConfirmApproveAll(event: SubmitEvent) {
		if (!confirm(`اعتماد جميع الفيديوهات المعلّقة (${stats.pending}) دفعة واحدة؟`)) {
			event.preventDefault();
		}
	}

	function handleConfirmDeleteSelected(event: SubmitEvent) {
		if (!confirm(`حذف ${selectedCount} فيديو؟ يمكنك التراجع من الإشعار خلال ثوانٍ.`)) {
			event.preventDefault();
		}
	}

	// ── Export dropdown ───────────────────────────────────────────
	let exportOpen = $state(false);

	const filteredExportQuery = $derived.by(() => {
		const sp = new URLSearchParams({ format: 'csv', scope: 'filtered', status: tab, sort: data.sort });
		if (data.q) sp.set('q', data.q);
		if (data.category) sp.set('category', data.category);
		return sp;
	});

	function exportHref(format: 'csv' | 'json', scope: 'filtered' | 'all'): string {
		if (scope === 'all') return `/export?format=${format}&scope=all`;
		const sp = new URLSearchParams(filteredExportQuery);
		sp.set('format', format);
		return `/export?${sp.toString()}`;
	}

	// ── Bulk category control ─────────────────────────────────────
	function handleBulkCategoryChange(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (selectedCount === 0) return;
		if (
			!confirm(
				value
					? `تغيير تصنيف ${selectedCount} فيديو إلى «${value}»؟`
					: `إزالة التصنيف من ${selectedCount} فيديو؟`
			)
		) {
			(event.currentTarget as HTMLSelectElement).value = '';
			return;
		}
		const form = (event.currentTarget as HTMLSelectElement).closest('form') as HTMLFormElement;
		form.requestSubmit();
	}
</script>

<svelte:head>
	<title>لوحة تحكم واحة · إدارة المحتوى</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<!-- Top bar -->
<header class="sticky top-0 z-30 border-b border-zinc-800/70 bg-zinc-950/90 backdrop-blur">
	<div class="mx-auto max-w-7xl px-4 sm:px-6">
		<div class="flex h-14 items-center justify-between gap-3">
			<div class="flex min-w-0 items-center gap-2.5">
				<img src="/favicon.png" alt="" aria-hidden="true" class="h-8 w-8 shrink-0 rounded-md object-cover" />
				<div class="min-w-0 leading-tight">
					<h1 class="truncate text-sm font-semibold">لوحة تحكم واحة</h1>
					<p class="truncate text-[11px] text-zinc-500">نظام إدارة المحتوى</p>
				</div>
			</div>

			<div class="flex shrink-0 items-center gap-2">
				<!-- Import Content -->
				<button
					type="button"
					onclick={() => (importOpen = true)}
					class="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-500"
				>
					<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<path d="m7 10 5 5 5-5" />
						<path d="M12 15V3" />
					</svg>
					<span class="hidden sm:inline">استيراد محتوى</span>
					<span class="sm:hidden">استيراد</span>
				</button>

				<!-- Activity log toggle -->
				<button
					type="button"
					onclick={() => (activityOpen = !activityOpen)}
					class="relative flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800"
					aria-expanded={activityOpen}
				>
					<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M3 12h.01" />
						<path d="M12 12h.01" />
						<path d="M21 12h.01" />
						<path d="M8.5 8.5 6 6" />
						<path d="m17.5 6-2.5 2.5" />
						<path d="M12 10V4" />
					</svg>
					<span class="hidden sm:inline">النشاط</span>
					{#if entries.length > 0}
						<span class="absolute -top-1.5 -left-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white tabular-nums">
							{entries.length}
						</span>
					{/if}
				</button>
			</div>
		</div>
	</div>
</header>

<main class="mx-auto max-w-7xl px-3 py-3 pb-24 sm:px-6 sm:py-4 {selectedCount > 0 ? 'sm:pb-28' : 'sm:pb-10'}">
	<!-- Page heading (hidden on the tightest screens — the header already says it) -->
	<div class="mb-4 hidden items-baseline justify-between sm:mb-5 sm:flex">
		<div>
			<h2 class="text-lg font-semibold tracking-tight">إدارة المحتوى</h2>
			<p class="text-xs text-zinc-500">استيراد ومراجعة واعتماد الفيديوهات قبل النشر</p>
		</div>
	</div>

	<!-- KPI cards (tap targets double as tab shortcuts) -->
	<div class="mb-3 grid grid-cols-3 gap-2 sm:mb-4 sm:gap-3">
		<!-- Total -->
		<button
			type="button"
			onclick={() => switchTab('all')}
			class="flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/80 p-3 text-start transition hover:border-zinc-700/80 sm:p-4"
		>
			<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-400">
				<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M22 8.5a2.5 2.5 0 0 0-2.5-2.5h-13A2.5 2.5 0 0 0 4 8.5v7A2.5 2.5 0 0 0 6.5 18h13a2.5 2.5 0 0 0 2.5-2.5Z" />
					<path d="M22 9.5l-4.5 2.5 4.5 2.5Z" />
				</svg>
			</div>
			<div class="min-w-0">
				<div class="text-lg font-semibold tabular-nums tracking-tight text-zinc-100 sm:text-2xl">{stats.total}</div>
				<p class="truncate text-[10px] text-zinc-500 sm:text-xs">إجمالي الفيديوهات</p>
			</div>
		</button>

		<!-- Pending -->
		<button
			type="button"
			onclick={() => switchTab('pending')}
			class="flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/80 p-3 text-start transition hover:border-zinc-700/80 hover:bg-zinc-900 sm:p-4"
		>
			<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
				<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<circle cx="12" cy="12" r="10" />
					<path d="M12 7v5l3 2" />
				</svg>
			</div>
			<div class="min-w-0">
				<div class="text-lg font-semibold tabular-nums tracking-tight text-zinc-100 sm:text-2xl">{stats.pending}</div>
				<p class="truncate text-[10px] text-zinc-500 sm:text-xs">بانتظار المراجعة</p>
			</div>
		</button>

		<!-- Approved -->
		<button
			type="button"
			onclick={() => switchTab('approved')}
			class="flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/80 p-3 text-start transition hover:border-zinc-700/80 hover:bg-zinc-900 sm:p-4"
		>
			<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
				<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M20 6 9 17l-5-5" />
				</svg>
			</div>
			<div class="min-w-0">
				<div class="text-lg font-semibold tabular-nums tracking-tight text-zinc-100 sm:text-2xl">{stats.approved}</div>
				<p class="truncate text-[10px] text-zinc-500 sm:text-xs">معتمدة</p>
			</div>
		</button>
	</div>

	<!-- ═══════════════════════════════════════════════════════════ -->
	<!-- UNIFIED TOOLBAR — reorganized into two responsive rows       -->
	<!-- ═══════════════════════════════════════════════════════════ -->
	<div class="mb-3 rounded-xl border border-zinc-800/80 bg-zinc-900/80 p-2.5 sm:mb-4 sm:p-3">
		<!-- Row 1: navigation (tabs) + view + sort -->
		<div class="mb-2 flex flex-wrap items-center gap-2 border-b border-zinc-800/60 pb-2">
			<!-- Tabs -->
			<div class="scrollbar-none flex h-9 max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-1" role="tablist">
				{#each [['pending', 'بانتظار المراجعة', 'المعلّق'], ['approved', 'معتمدة', 'معتمدة'], ['all', 'الكل', 'الكل']] as [t, label, shortLabel] (t)}
					<button
						type="button"
						role="tab"
						aria-selected={tab === t}
						onclick={() => switchTab(t as StatusTab)}
						class="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition {tab === t
							? 'bg-zinc-800 text-zinc-100 shadow-sm'
							: 'text-zinc-400 hover:text-zinc-200'}"
					>
						<span class="hidden sm:inline">{label}</span>
						<span class="sm:hidden">{shortLabel}</span>
						<span class="rounded bg-zinc-700/80 px-1.5 text-[10px] font-semibold tabular-nums {tab === t ? 'text-zinc-200' : 'text-zinc-500'}">
							{t === 'pending' ? stats.pending : t === 'approved' ? stats.approved : stats.total}
						</span>
					</button>
				{/each}
			</div>

			<div class="ms-auto flex items-center gap-2">
				<!-- Sort by date of addition -->
				<div class="flex h-9 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1" role="group" aria-label="الترتيب حسب تاريخ الإضافة">
					<button
						type="button"
						role="radio"
						aria-checked={data.sort === 'newest'}
						onclick={() => switchSort('newest')}
						class="flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium transition {data.sort === 'newest'
							? 'bg-zinc-800 text-zinc-100 shadow-sm'
							: 'text-zinc-400 hover:text-zinc-200'}"
						title="الأحدث إضافة أولًا"
					>
						<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M12 17V3" />
							<path d="m6 11 6 6 6-6" />
							<path d="M19 21H5" />
						</svg>
						<span class="hidden md:inline">الأحدث</span>
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={data.sort === 'oldest'}
						onclick={() => switchSort('oldest')}
						class="flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium transition {data.sort === 'oldest'
							? 'bg-zinc-800 text-zinc-100 shadow-sm'
							: 'text-zinc-400 hover:text-zinc-200'}"
						title="الأقدم إضافة أولًا"
					>
						<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M12 3v14" />
							<path d="m6 9 6-6 6 6" />
							<path d="M19 21H5" />
						</svg>
						<span class="hidden md:inline">الأقدم</span>
					</button>
				</div>

				<!-- View Toggle -->
				<div class="flex h-9 items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1" role="group" aria-label="وضع العرض">
					<button
						type="button"
						role="radio"
						aria-checked={viewMode === 'grid'}
						onclick={() => (viewMode = 'grid')}
						class="flex h-7 items-center justify-center gap-1 rounded-md px-2.5 text-xs font-medium transition {viewMode === 'grid'
							? 'bg-zinc-800 text-zinc-100 shadow-sm'
							: 'text-zinc-400 hover:text-zinc-200'}"
						title="وضع الشبكة"
					>
						<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<rect x="3" y="3" width="7" height="7" />
							<rect x="14" y="3" width="7" height="7" />
							<rect x="3" y="14" width="7" height="7" />
							<rect x="14" y="14" width="7" height="7" />
						</svg>
						<span class="hidden sm:inline">الشبكة</span>
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={viewMode === 'table'}
						onclick={() => (viewMode = 'table')}
						class="flex h-7 items-center justify-center gap-1 rounded-md px-2.5 text-xs font-medium transition {viewMode === 'table'
							? 'bg-zinc-800 text-zinc-100 shadow-sm'
							: 'text-zinc-400 hover:text-zinc-200'}"
						title="وضع الجدول"
					>
						<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M3 3h18v18H3z" />
							<path d="M3 9h18 M3 15h18 M9 3v18 M15 3v18" />
						</svg>
						<span class="hidden sm:inline">الجدول</span>
					</button>
				</div>
			</div>
		</div>

		<!-- Row 2: search + filters -->
		<div class="flex flex-wrap items-center gap-2">
			<!-- Search -->
			<div class="relative min-w-[9rem] max-w-xs flex-1">
				<svg
					class="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-zinc-500 rtl:rotate-180"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<circle cx="11" cy="11" r="8" />
					<path d="m21 21-4.3-4.3" />
				</svg>
				<input
					bind:this={searchInput}
					bind:value={query}
					oninput={handleSearchInput}
					type="search"
					placeholder="بحث فوري بالعنوان أو المعرّف…"
					class="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950/50 ps-8 pe-3 text-xs text-zinc-100 placeholder:text-zinc-500 transition focus:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-800"
				/>
			</div>

			<!-- Category filter (fixed list) -->
			<div class="relative">
				<select
					value={data.category ?? ''}
					onchange={(e) => navigate({ category: (e.currentTarget as HTMLSelectElement).value || null }, { resetPage: true })}
					class="h-9 w-full min-w-36 cursor-pointer appearance-none rounded-lg border border-zinc-700 bg-zinc-950/50 px-3 text-xs text-zinc-300 transition focus:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-800"
					aria-label="تصفية حسب التصنيف"
				>
					<option value="">كل التصنيفات</option>
					{#each categories as cat (cat)}
						<option value={cat}>{cat}</option>
					{/each}
				</select>
				<svg class="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500 rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="m6 9 6 6 6-6" />
				</svg>
			</div>

			<!-- Select all (current page) -->
			<button
				type="button"
				onclick={toggleSelectAll}
				class="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800"
			>
				<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="m5 13 4 4L19 7" />
				</svg>
				<span class="hidden sm:inline">تحديد الكل</span>
				<span class="sm:hidden">تحديد</span>
			</button>

			<!-- Clear filters -->
			{#if hasActiveFilters}
				<button
					type="button"
					onclick={clearFilters}
					class="flex h-9 items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/50 px-2.5 text-[11px] font-medium text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
					title="مسح جميع الفلاتر"
				>
					<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M18 6 6 18 M6 6l12 12" />
					</svg>
					<span class="hidden sm:inline">مسح</span>
				</button>
			{/if}

			<!-- Export dropdown -->
			<div class="relative">
				<button
					type="button"
					onclick={() => (exportOpen = !exportOpen)}
					class="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800"
					aria-expanded={exportOpen}
				>
					<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<path d="m17 8-5-5-5 5" />
						<path d="M12 3v12" />
					</svg>
					<span class="hidden sm:inline">تصدير</span>
					<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="m6 9 6 6 6-6" />
					</svg>
				</button>

				{#if exportOpen}
					<button type="button" class="fixed inset-0 z-40 cursor-default" onclick={() => (exportOpen = false)} aria-label="إغلاق قائمة التصدير"></button>
					<div class="absolute top-full left-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl" role="menu">
						<p class="border-b border-zinc-800 px-3 py-2 text-[10px] font-semibold text-zinc-500">البيانات المفلترة حاليًا</p>
						<a href={exportHref('csv', 'filtered')} class="flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 transition hover:bg-zinc-800" onclick={() => (exportOpen = false)}>
							<svg class="h-3.5 w-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></svg>
							تصدير CSV
						</a>
						<a href={exportHref('json', 'filtered')} class="flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 transition hover:bg-zinc-800" onclick={() => (exportOpen = false)}>
							<svg class="h-3.5 w-3.5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></svg>
							تصدير JSON
						</a>
						<p class="border-y border-zinc-800 px-3 py-2 text-[10px] font-semibold text-zinc-500">قاعدة البيانات كاملة</p>
						<a href="/export?format=csv&scope=all" class="flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 transition hover:bg-zinc-800" onclick={() => (exportOpen = false)}>
							<svg class="h-3.5 w-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></svg>
							CSV كامل
						</a>
						<a href="/export?format=json&scope=all" class="flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 transition hover:bg-zinc-800" onclick={() => (exportOpen = false)}>
							<svg class="h-3.5 w-3.5 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></svg>
							JSON كامل
						</a>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<!-- Results count + quick approve-all -->
	<div class="mb-2.5 flex flex-wrap items-center justify-between gap-2">
		<p class="text-xs text-zinc-500">
			<span class="font-medium text-zinc-400">{data.total}</span> فيديو
			{#if hasActiveFilters}
				· ضمن نتائج مفلترة
			{/if}
			· {data.sort === 'oldest' ? 'الأقدم أولًا' : 'الأحدث أولًا'}
		</p>
		<div class="flex items-center gap-2">
			{#if hasActiveFilters}
				<button type="button" onclick={clearFilters} class="text-[11px] font-medium text-zinc-500 transition hover:text-zinc-300">
					مسح الفلاتر
				</button>
			{/if}
			{#if selectedCount === 0 && tab === 'pending' && stats.pending > 0}
				<!-- Approve All (pending tab, nothing selected) -->
				<form method="POST" action="?/approve-all" use:enhance={handleBulk} onsubmit={handleConfirmApproveAll}>
					<input type="hidden" name="bulk" value="approve-all" />
					<button
						type="submit"
						disabled={bulkBusy !== null || stats.pending === 0}
						class="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{#if bulkBusy === 'approve-all'}
							<svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
								<path class="opacity-90" fill="currentColor" d="M21 12a9 9 0 1 1-6.22-8.56" />
							</svg>
							جارٍ الاعتماد…
						{:else}
							<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="m5 13 4 4L19 7" />
							</svg>
							اعتماد الكل ({stats.pending})
						{/if}
					</button>
				</form>
			{/if}
		</div>
	</div>

	<!-- ═══════════════════════════════════════════════════════════ -->
	<!-- CONTENT: GRID OR TABLE                                     -->
	<!-- ═══════════════════════════════════════════════════════════ -->
	{#if videos.length === 0}
		{@render EmptyState()}
	{:else if viewMode === 'grid'}
		<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-4">
			{#each videos as video (video.id)}
				<VideoCard
					{video}
					busyId={busyId}
					mode={video.status === 'approved' ? 'approved' : 'pending'}
					submit={handleSubmit}
					categorySubmit={handleCategory}
					{categories}
					selected={selectedIds.has(video.id)}
					ontoggleselect={() => toggleSelect(video.id)}
					openPreview={openPreview}
				/>
			{/each}
		</div>
	{:else}
		<VideoTable
			{videos}
			busyId={busyId}
			mode={tab}
			submit={handleSubmit}
			categorySubmit={handleCategory}
			titleSubmit={handleTitle}
			{categories}
			selected={selectedIds}
			ontoggleselect={toggleSelect}
			onselectall={toggleSelectAll}
			previewVideo={openPreview}
		/>
	{/if}

	<!-- Pagination -->
	{#if data.total > 0}
		<div class="mt-4 rounded-xl border border-zinc-800/80 bg-zinc-900/80 p-3">
			<Pagination
				page={data.page}
				perPage={data.perPage}
				total={data.total}
				totalPages={data.totalPages}
				onnavigate={(p) => navigate({ page: p })}
				onPerPageChange={(n) => navigate({ perPage: n }, { resetPage: true })}
			/>
		</div>
	{/if}
</main>

<!-- ═══════════════════════════════════════════════════════════ -->
<!-- FLOATING SELECTION BAR — bulk actions live at thumb-reach    -->
<!-- ═══════════════════════════════════════════════════════════ -->
{#if selectedCount > 0}
	<div class="fixed bottom-4 left-1/2 z-40 w-[min(92vw,44rem)] -translate-x-1/2">
		<div class="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900/95 p-2.5 shadow-2xl shadow-black/50 backdrop-blur">
			<span class="flex h-8 items-center gap-1.5 rounded-md bg-blue-600/15 px-2.5 text-xs font-bold text-blue-300 tabular-nums">
				<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="m5 13 4 4L19 7" />
				</svg>
				{selectedCount}
			</span>

			<!-- Bulk category edit (fixed list) -->
			<form method="POST" action="?/bulk-set-category" use:enhance={handleBulk}>
				{#each [...selectedIds] as id (id)}
					<input type="hidden" name="ids" value={id} />
				{/each}
				<input type="hidden" name="bulk" value="bulk-set-category" />
				<select
					name="category"
					onchange={handleBulkCategoryChange}
					disabled={bulkBusy !== null}
					class="h-8 w-40 cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 focus:border-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
					aria-label="تغيير تصنيف المحدد دفعة واحدة"
				>
					<option value="" disabled selected>تصنيف جماعي ({selectedCount})…</option>
					{#each categories as cat (cat)}
						<option value={cat}>{cat}</option>
					{/each}
					<option value="">— إزالة التصنيف —</option>
				</select>
			</form>

			<div class="ms-auto flex items-center gap-2">
				<!-- Approve selected (only meaningful when pending rows are selected) -->
				{#if tab !== 'approved'}
					<form method="POST" action="?/approve-selected" use:enhance={handleBulk}>
						{#each [...selectedIds] as id (id)}
							<input type="hidden" name="ids" value={id} />
						{/each}
						<input type="hidden" name="bulk" value="approve-selected" />
						<button
							type="submit"
							disabled={bulkBusy !== null}
							class="flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
						>
							{#if bulkBusy === 'approve-selected'}
								<svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
									<path class="opacity-90" fill="currentColor" d="M21 12a9 9 0 1 1-6.22-8.56" />
								</svg>
								جارٍ…
							{:else}
								<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<path d="m5 13 4 4L19 7" />
								</svg>
								اعتماد ({selectedCount})
							{/if}
						</button>
					</form>
				{/if}

				<!-- Delete selected -->
				<form method="POST" action="?/delete-selected" use:enhance={handleBulk} onsubmit={handleConfirmDeleteSelected}>
					{#each [...selectedIds] as id (id)}
						<input type="hidden" name="ids" value={id} />
					{/each}
					<input type="hidden" name="bulk" value="delete-selected" />
					<button
						type="submit"
						disabled={bulkBusy !== null}
						class="flex h-8 items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 text-xs font-semibold text-red-400 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
					>
						{#if bulkBusy === 'delete-selected'}
							<svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
								<path class="opacity-90" fill="currentColor" d="M21 12a9 9 0 1 1-6.22-8.56" />
							</svg>
							جارٍ…
						{:else}
							<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M10 11v6 M14 11v6" />
							</svg>
							حذف ({selectedCount})
						{/if}
					</button>
				</form>

				<!-- Clear selection -->
				<button
					type="button"
					onclick={clearSelection}
					class="flex h-8 items-center rounded-md px-2 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-300"
				>
					إلغاء
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Hidden undo form: submitted programmatically with the stored payload -->
<form bind:this={undoFormEl} method="POST" action="?/undo" use:enhance={handleUndo} class="hidden" aria-hidden="true">
	<input bind:this={undoInputEl} type="hidden" name="payload" />
</form>

<!-- Toasts (with Undo) — raised above the floating selection bar on phones -->
<div class="pointer-events-none fixed bottom-24 left-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-2 sm:bottom-5 sm:left-5 sm:max-w-sm" aria-live="polite">
	{#each toasts as toast (toast.id)}
		{@const entry = toast.entryId !== undefined ? entries.find((e) => e.id === toast.entryId) : undefined}
		<div
			class="pointer-events-auto flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 shadow-xl shadow-black/40 {toast.kind === 'success'
				? 'text-emerald-300'
				: 'text-red-300'}"
			role="status"
		>
			<span class="relative flex h-2 w-2 shrink-0" aria-hidden="true">
				<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {toast.kind === 'success' ? 'bg-emerald-400' : 'bg-red-400'}"></span>
				<span class="relative inline-flex h-2 w-2 rounded-full {toast.kind === 'success' ? 'bg-emerald-500' : 'bg-red-500'}"></span>
			</span>
			<span class="flex-1 text-xs font-medium">{toast.text}</span>
			{#if entry?.undo && !undoneEntryIds.has(entry.id)}
				<button
					type="button"
					disabled={undoingEntryIds.has(entry.id)}
					onclick={() => triggerUndo(entry)}
					class="flex h-6 shrink-0 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-[10px] font-bold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
				>
					<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M9 14 4 9l5-5" />
						<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
					</svg>
					{undoingEntryIds.has(entry.id) ? 'جارٍ…' : 'تراجع'}
				</button>
			{/if}
			<button
				type="button"
				onclick={() => dismissToast(toast.id)}
				class="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-zinc-500 transition hover:text-zinc-300"
				aria-label="إغلاق الإشعار"
			>
				<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M18 6 6 18 M6 6l12 12" />
				</svg>
			</button>
		</div>
	{/each}
</div>

<!-- Import Content Modal -->
<ImportModal open={importOpen} onclose={() => (importOpen = false)} onresult={applyResult} />

<!-- Activity Audit Drawer -->
<ActivityDrawer
	open={activityOpen}
	{entries}
	onclose={() => (activityOpen = false)}
	onundo={triggerUndo}
	undoingIds={undoingEntryIds}
	onclear={() => {
		entries = [];
		undoneEntryIds = new Set();
	}}
/>

<!-- Video Preview Modal -->
<VideoModal video={previewVideoState} open={previewOpen} onclose={closePreview} />

{#snippet EmptyState()}
	<div class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
		<div class="flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800/80 text-zinc-500">
			<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				{#if data.q}
					<circle cx="11" cy="11" r="8" />
					<path d="m21 21-4.3-4.3" />
				{:else}
					<path d="M22 8.5a2.5 2.5 0 0 0-2.5-2.5h-13A2.5 2.5 0 0 0 4 8.5v7A2.5 2.5 0 0 0 6.5 18h13a2.5 2.5 0 0 0 2.5-2.5Z" />
					<path d="M22 9.5l-4.5 2.5 4.5 2.5Z" />
				{/if}
			</svg>
		</div>
		<h2 class="text-sm font-semibold text-zinc-200">
			{data.q ? 'لا نتائج مطابقة' : tab === 'pending' ? 'لا يوجد محتوى معلّق' : tab === 'approved' ? 'لا توجد فيديوهات معتمدة بعد' : 'لا يوجد محتوى بعد'}
		</h2>
		<p class="max-w-md text-xs text-zinc-500">
			{data.q
				? 'جرّب كلمة بحث مختلفة أو أعد تعيين الحقل.'
				: tab === 'pending'
					? 'ستظهر الفيديوهات الجديدة هنا تلقائيًا عند استيرادها بحالة pending.'
					: 'اعتمد فيديوهات من قائمة المراجعة لتظهر هنا.'}
		</p>
		{#if data.q}
			<button
				type="button"
				class="mt-1 h-8 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
				onclick={() => {
					query = '';
					navigate({ q: null }, { resetPage: true });
				}}
			>
				مسح البحث
			</button>
		{:else if tab === 'pending'}
			<button
				type="button"
				class="mt-1 h-8 rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
				onclick={() => (importOpen = true)}
			>
				استيراد فيديو
			</button>
		{/if}
	</div>
{/snippet}
