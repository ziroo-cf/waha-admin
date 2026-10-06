<script lang="ts">
	import type { VideoRow, VideoAvailabilityIssue } from '$lib/types';

	interface Props {
		open: boolean;
		currentPageVideos: VideoRow[];
		totalVideosCount: number;
		onclose: () => void;
		onlog: (text: string, kind: 'success' | 'error' | 'info') => void;
		onrefresh: () => void;
	}

	let { open, currentPageVideos, totalVideosCount, onclose, onlog, onrefresh }: Props = $props();

	// Scan state
	let scanning = $state(false);
	let abortController: AbortController | null = null;
	let progressCurrent = $state(0);
	let progressTotal = $state(0);
	let healthyCount = $state(0);
	let scanCompleted = $state(false);

	// Issues state
	let issues = $state<VideoAvailabilityIssue[]>([]);
	let selectedIssueIds = $state<Set<string>>(new Set());
	let resolving = $state(false);

	// Filter
	type IssueFilter = 'all' | 'deleted_or_unavailable' | 'private' | 'not_embeddable';
	let activeFilter = $state<IssueFilter>('all');

	const filteredIssues = $derived(
		activeFilter === 'all' ? issues : issues.filter((i) => i.type === activeFilter)
	);

	const allSelected = $derived(
		filteredIssues.length > 0 && filteredIssues.every((i) => selectedIssueIds.has(i.id))
	);

	function toggleSelectAll() {
		if (allSelected) {
			selectedIssueIds = new Set();
		} else {
			const next = new Set(selectedIssueIds);
			for (const i of filteredIssues) next.add(i.id);
			selectedIssueIds = next;
		}
	}

	function toggleSelect(id: string) {
		const next = new Set(selectedIssueIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIssueIds = next;
	}

	function stopScan() {
		if (abortController) {
			abortController.abort();
			abortController = null;
		}
		scanning = false;
	}

	async function startCurrentPageScan() {
		if (scanning || !currentPageVideos.length) return;
		issues = [];
		selectedIssueIds = new Set();
		scanning = true;
		scanCompleted = false;
		progressCurrent = 0;
		progressTotal = currentPageVideos.length;
		healthyCount = 0;

		abortController = new AbortController();

		try {
			const res = await fetch('/api/check', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'check',
					videos: currentPageVideos.map((v) => ({ id: v.id, title: v.title, thumbnail: v.thumbnail }))
				}),
				signal: abortController.signal
			});

			if (res.ok) {
				const data = await res.json();
				const detectedIssues = (data.issues ?? []) as VideoAvailabilityIssue[];
				issues = detectedIssues;
				progressCurrent = currentPageVideos.length;
				healthyCount = currentPageVideos.length - detectedIssues.length;
				scanCompleted = true;
				onlog(
					`اكتمل فحص الصفحة: تم فحص ${currentPageVideos.length} فيديو، ووُجد ${detectedIssues.length} غير متاح.`,
					detectedIssues.length > 0 ? 'error' : 'success'
				);
			} else {
				onlog('فشل فحص الصفحة عبر الخادم.', 'error');
			}
		} catch (err: any) {
			if (err?.name !== 'AbortError') {
				console.error('Scan error:', err);
				onlog('حدث خطأ أثناء فحص الفيديوهات.', 'error');
			}
		} finally {
			scanning = false;
			abortController = null;
		}
	}

	async function startFullScan() {
		if (scanning) return;
		issues = [];
		selectedIssueIds = new Set();
		scanning = true;
		scanCompleted = false;
		progressCurrent = 0;
		progressTotal = totalVideosCount;
		healthyCount = 0;

		abortController = new AbortController();
		const batchSize = 50;
		let offset = 0;
		const accumulatedIssues: VideoAvailabilityIssue[] = [];

		try {
			while (scanning) {
				// 1. Fetch next batch of videos from DB
				const getRes = await fetch(`/api/check?offset=${offset}&limit=${batchSize}`, {
					signal: abortController.signal
				});
				if (!getRes.ok) break;
				const getData = await getRes.json();
				const batchVideos = (getData.videos ?? []) as VideoRow[];
				if (!batchVideos.length) break;

				if (getData.total) progressTotal = getData.total;

				// 2. Check batch against YouTube
				const checkRes = await fetch('/api/check', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						action: 'check',
						videos: batchVideos.map((v) => ({ id: v.id, title: v.title, thumbnail: v.thumbnail }))
					}),
					signal: abortController.signal
				});

				if (checkRes.ok) {
					const checkData = await checkRes.json();
					const batchIssues = (checkData.issues ?? []) as VideoAvailabilityIssue[];
					accumulatedIssues.push(...batchIssues);
					issues = [...accumulatedIssues];
					progressCurrent += batchVideos.length;
					healthyCount += batchVideos.length - batchIssues.length;
				}

				offset += batchVideos.length;
				if (offset >= progressTotal) break;
			}

			scanCompleted = true;
			onlog(
				`اكتمل الفحص الشامل: تم فحص ${progressCurrent} فيديو، ووُجد ${issues.length} غير متاح.`,
				issues.length > 0 ? 'error' : 'success'
			);
		} catch (err: any) {
			if (err?.name !== 'AbortError') {
				console.error('Full scan error:', err);
				onlog('حدث خطأ أثناء الفحص الشامل.', 'error');
			}
		} finally {
			scanning = false;
			abortController = null;
		}
	}

	async function handleBulkDelete(ids: string[]) {
		if (!ids.length) return;
		if (!confirm(`هل أنت متأكد من حذف ${ids.length} فيديو غير متاح نهائياً؟`)) return;

		resolving = true;
		try {
			const res = await fetch('/api/check', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'delete', ids })
			});

			if (res.ok) {
				const idSet = new Set(ids);
				issues = issues.filter((i) => !idSet.has(i.id));
				selectedIssueIds = new Set([...selectedIssueIds].filter((id) => !idSet.has(id)));
				onlog(`تم حذف ${ids.length} فيديو غير متاح بنجاح.`, 'success');
				onrefresh();
			} else {
				onlog('فشل حذف الفيديوهات.', 'error');
			}
		} catch (err) {
			onlog('حدث خطأ أثناء حذف الفيديوهات.', 'error');
		} finally {
			resolving = false;
		}
	}

	async function handleBulkDisable(ids: string[]) {
		if (!ids.length) return;
		if (!confirm(`تعطيل ${ids.length} فيديو وتغيير حالتها إلى «غير متاح»؟`)) return;

		resolving = true;
		try {
			const res = await fetch('/api/check', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'disable', ids })
			});

			if (res.ok) {
				const idSet = new Set(ids);
				issues = issues.filter((i) => !idSet.has(i.id));
				selectedIssueIds = new Set([...selectedIssueIds].filter((id) => !idSet.has(id)));
				onlog(`تم تغيير حالة ${ids.length} فيديو إلى غير متاح.`, 'info');
				onrefresh();
			} else {
				onlog('فشل تعطيل الفيديوهات.', 'error');
			}
		} catch (err) {
			onlog('حدث خطأ أثناء تعطيل الفيديوهات.', 'error');
		} finally {
			resolving = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open && !scanning) onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" dir="rtl">
		<!-- Backdrop -->
		<button
			type="button"
			class="absolute inset-0 h-full w-full cursor-default bg-black/80 backdrop-blur-sm"
			onclick={() => {
				if (!scanning) onclose();
			}}
			aria-label="إغلاق نافذة الفحص"
		></button>

		<!-- Modal Container -->
		<div
			class="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700/60 bg-zinc-900 shadow-2xl"
			role="dialog"
			aria-modal="true"
			aria-label="فحص صلاحية الفيديوهات"
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-zinc-800 px-4 py-3 sm:px-6">
				<div class="flex items-center gap-3">
					<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
						<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
							<path d="m9 12 2 2 4-4" />
						</svg>
					</div>
					<div>
						<h3 class="text-sm font-semibold text-zinc-100 sm:text-base">فحص صلاحية وتوفر الفيديوهات</h3>
						<p class="text-[11px] text-zinc-500 sm:text-xs">
							التحقق من يوتيوب لاكتشاف الفيديوهات المحذوفة، الخاصة، أو التي تم إيقاف تضمينها
						</p>
					</div>
				</div>

				<button
					type="button"
					onclick={() => {
						stopScan();
						onclose();
					}}
					class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
					aria-label="إغلاق"
				>
					<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M18 6 6 18 M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Control Bar -->
			<div class="border-b border-zinc-800/80 bg-zinc-950/40 p-4 sm:px-6">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex flex-wrap items-center gap-2">
						<!-- Scan Current Page Button -->
						<button
							type="button"
							onclick={startCurrentPageScan}
							disabled={scanning || resolving}
							class="flex h-8.5 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
						>
							<svg class="h-3.5 w-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<rect x="3" y="3" width="18" height="18" rx="2" />
								<path d="M3 9h18" />
							</svg>
							فحص الصفحة الحالية ({currentPageVideos.length})
						</button>

						<!-- Full Scan Button -->
						<button
							type="button"
							onclick={startFullScan}
							disabled={scanning || resolving}
							class="flex h-8.5 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
						>
							<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<circle cx="12" cy="12" r="10" />
								<path d="m10 15 5-3-5-3v6Z" />
							</svg>
							فحص شامل للقاعدة ({totalVideosCount})
						</button>
					</div>

					{#if scanning}
						<button
							type="button"
							onclick={stopScan}
							class="flex h-8.5 items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-xs font-medium text-red-400 transition hover:bg-red-500/20"
						>
							<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<rect x="6" y="6" width="12" height="12" rx="2" />
							</svg>
							إيقاف الفحص
						</button>
					{/if}
				</div>

				<!-- Progress bar when scanning -->
				{#if scanning || (scanCompleted && progressTotal > 0)}
					<div class="mt-4">
						<div class="mb-1.5 flex items-center justify-between text-xs">
							<span class="font-medium text-zinc-300">
								{#if scanning}
									<span class="inline-flex items-center gap-1.5">
										<span class="h-2 w-2 animate-ping rounded-full bg-blue-400"></span>
										جارٍ الفحص التتابعي عبر يوتيوب…
									</span>
								{:else}
									<span class="text-emerald-400">اكتمل الفحص بالكامل</span>
								{/if}
							</span>
							<span class="tabular-nums font-mono text-zinc-400">
								{progressCurrent} / {progressTotal} ({Math.round(
									(progressCurrent / Math.max(1, progressTotal)) * 100
								)}%)
							</span>
						</div>
						<div class="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
							<div
								class="h-full rounded-full transition-all duration-300 {issues.length > 0
									? 'bg-gradient-to-r from-blue-500 via-amber-500 to-red-500'
									: 'bg-blue-500'}"
								style="width: {Math.min(100, Math.round((progressCurrent / Math.max(1, progressTotal)) * 100))}%"
							></div>
						</div>

						<div class="mt-2.5 flex items-center gap-4 text-[11px] text-zinc-400">
							<span class="flex items-center gap-1 text-emerald-400">
								<span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
								سليمة: {healthyCount}
							</span>
							<span class="flex items-center gap-1 text-red-400 font-semibold">
								<span class="h-1.5 w-1.5 rounded-full bg-red-400"></span>
								مشاكل مكتشفة: {issues.length}
							</span>
						</div>
					</div>
				{/if}
			</div>

			<!-- Issues List / Results Container -->
			<div class="flex-1 overflow-y-auto p-4 sm:px-6">
				{#if issues.length > 0}
					<!-- Filter tabs + Bulk Actions Header -->
					<div class="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
						<div class="flex items-center gap-1 overflow-x-auto text-xs">
							<button
								type="button"
								onclick={() => (activeFilter = 'all')}
								class="rounded-md px-2.5 py-1 font-medium transition {activeFilter === 'all'
									? 'bg-zinc-800 text-zinc-100'
									: 'text-zinc-400 hover:text-zinc-200'}"
							>
								الكل ({issues.length})
							</button>
							<button
								type="button"
								onclick={() => (activeFilter = 'deleted_or_unavailable')}
								class="rounded-md px-2.5 py-1 font-medium transition {activeFilter === 'deleted_or_unavailable'
									? 'bg-red-500/20 text-red-300'
									: 'text-zinc-400 hover:text-zinc-200'}"
							>
								محذوف ({issues.filter((i) => i.type === 'deleted_or_unavailable').length})
							</button>
							<button
								type="button"
								onclick={() => (activeFilter = 'private')}
								class="rounded-md px-2.5 py-1 font-medium transition {activeFilter === 'private'
									? 'bg-amber-500/20 text-amber-300'
									: 'text-zinc-400 hover:text-zinc-200'}"
							>
								خاص ({issues.filter((i) => i.type === 'private').length})
							</button>
							<button
								type="button"
								onclick={() => (activeFilter = 'not_embeddable')}
								class="rounded-md px-2.5 py-1 font-medium transition {activeFilter === 'not_embeddable'
									? 'bg-purple-500/20 text-purple-300'
									: 'text-zinc-400 hover:text-zinc-200'}"
							>
								غير قابل للتضمين ({issues.filter((i) => i.type === 'not_embeddable').length})
							</button>
						</div>

						<div class="flex items-center gap-2">
							<button
								type="button"
								onclick={toggleSelectAll}
								class="text-xs text-zinc-400 hover:text-zinc-200"
							>
								{allSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
							</button>
						</div>
					</div>

					<!-- Issue cards list -->
					<div class="flex flex-col gap-2">
						{#each filteredIssues as item (item.id)}
							<div
								class="flex items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-2.5 transition hover:border-zinc-700 {selectedIssueIds.has(item.id)
									? 'border-blue-500/60 bg-blue-500/5'
									: ''}"
							>
								<!-- Checkbox -->
								<input
									type="checkbox"
									checked={selectedIssueIds.has(item.id)}
									onchange={() => toggleSelect(item.id)}
									class="h-4 w-4 cursor-pointer rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/40"
									aria-label="تحديد"
								/>

								<!-- Thumbnail -->
								<div class="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-zinc-800">
									{#if item.thumbnail}
										<img src={item.thumbnail} alt="" class="h-full w-full object-cover" />
									{:else}
										<div class="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
											لا صورة
										</div>
									{/if}
								</div>

								<!-- Info -->
								<div class="min-w-0 flex-1">
									<h4 class="truncate text-xs font-medium text-zinc-100" title={item.title ?? ''}>
										{item.title ?? 'بدون عنوان'}
									</h4>
									<div class="mt-1 flex flex-wrap items-center gap-2">
										<!-- Issue reason badge -->
										<span
											class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold {item.type ===
											'deleted_or_unavailable'
												? 'bg-red-500/10 text-red-400 border border-red-500/20'
												: item.type === 'private'
													? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
													: 'bg-purple-500/10 text-purple-400 border border-purple-500/20'}"
										>
											{item.reason}
										</span>

										<span class="font-mono text-[10px] text-zinc-500" dir="ltr">
											{item.id}
										</span>
									</div>
								</div>

								<!-- Action shortcuts -->
								<div class="flex shrink-0 items-center gap-1">
									<!-- Open on YouTube in new tab -->
									<a
										href="https://www.youtube.com/watch?v={item.id}"
										target="_blank"
										rel="noopener noreferrer"
										class="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
										title="فتح على يوتيوب للتأكد"
									>
										<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
											<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
											<polyline points="15 3 21 3 21 9" />
											<line x1="10" y1="14" x2="21" y2="3" />
										</svg>
									</a>

									<!-- Disable / Set unavailable -->
									<button
										type="button"
										onclick={() => handleBulkDisable([item.id])}
										disabled={resolving}
										class="flex h-7 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/80 px-2 text-[10px] font-medium text-zinc-300 transition hover:bg-zinc-700"
										title="تعطيل الفيديو"
									>
										تعطيل
									</button>

									<!-- Delete -->
									<button
										type="button"
										onclick={() => handleBulkDelete([item.id])}
										disabled={resolving}
										class="flex h-7 items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 text-[10px] font-medium text-red-400 transition hover:bg-red-500/20"
										title="حذف نهائي"
									>
										حذف
									</button>
								</div>
							</div>
						{/each}
					</div>
				{:else if scanCompleted}
					<div class="flex flex-col items-center justify-center py-12 text-center">
						<div class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
							<svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<polyline points="20 6 9 17 4 12" />
							</svg>
						</div>
						<h4 class="mt-3 text-sm font-semibold text-zinc-100">جميع الفيديوهات المفحوصة سليمة تماماً!</h4>
						<p class="mt-1 text-xs text-zinc-500">
							لم يتم العثور على أي فيديو محذوف أو خاص في نطاق الفحص المكتمل.
						</p>
					</div>
				{:else}
					<div class="flex flex-col items-center justify-center py-12 text-center text-zinc-500">
						<svg class="h-10 w-10 stroke-[1.5] text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<circle cx="12" cy="12" r="10" />
							<path d="M12 16v-4" />
							<path d="M12 8h.01" />
						</svg>
						<p class="mt-2.5 text-xs">
							اختر «فحص الصفحة الحالية» أو «فحص شامل للقاعدة» للبدء في التحقق من توفر الفيديوهات على يوتيوب.
						</p>
					</div>
				{/if}
			</div>

			<!-- Footer with Action Bar -->
			{#if issues.length > 0}
				<div class="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 bg-zinc-950/60 px-4 py-3 sm:px-6">
					<div class="text-xs text-zinc-400">
						<span class="font-semibold text-zinc-200">{selectedIssueIds.size}</span> فيديو محدد من أصل{' '}
						<span class="font-semibold text-zinc-200">{issues.length}</span> غير متاح
					</div>

					<div class="flex items-center gap-2">
						<!-- Disable selected -->
						<button
							type="button"
							onclick={() => handleBulkDisable([...selectedIssueIds])}
							disabled={resolving || selectedIssueIds.size === 0}
							class="flex h-8 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-xs font-medium text-zinc-300 transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
						>
							تعطيل المحدد ({selectedIssueIds.size})
						</button>

						<!-- Delete selected -->
						<button
							type="button"
							onclick={() => handleBulkDelete([...selectedIssueIds])}
							disabled={resolving || selectedIssueIds.size === 0}
							class="flex h-8 items-center gap-1 rounded-md bg-red-600 px-3 text-xs font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
						>
							حذف المحدد ({selectedIssueIds.size})
						</button>

						<!-- Delete all issues -->
						<button
							type="button"
							onclick={() => handleBulkDelete(issues.map((i) => i.id))}
							disabled={resolving}
							class="flex h-8 items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-3 text-xs font-medium text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
						>
							حذف الكل المعطوب ({issues.length})
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
