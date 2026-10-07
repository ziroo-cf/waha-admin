<script lang="ts">
	import '../app.css';

	let { children } = $props();

	const PROFILE_URL = 'https://github.com/ziroo-cf';
	const REPO_URL = 'https://github.com/ziroo-cf/waha-admin';
	const YEAR = 2026;
</script>

{@render children()}

<!-- Project footer: author + repository links -->
<footer class="border-t border-zinc-800/70 bg-zinc-950/90">
	<div
		class="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-zinc-500 sm:flex-row sm:px-6"
	>
		<p class="order-2 sm:order-1">
			<span dir="ltr">MIT License</span>
			· © {YEAR}
			<a
				class="font-medium text-zinc-400 transition hover:text-zinc-100"
				href={PROFILE_URL}
				target="_blank"
				rel="noopener noreferrer">ziroo-cf</a
			>
		</p>

		<nav class="order-1 flex items-center gap-2 sm:order-2" aria-label="رابط المشروع">
			<a
				class="flex h-8 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
				href={REPO_URL}
				target="_blank"
				rel="noopener noreferrer"
			>
				<svg
					class="h-3.5 w-3.5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
					<path d="M9 18c-4.51 2-5-2-7-2" />
				</svg>
				<span dir="ltr">المستودع</span>
			</a>
		</nav>
	</div>
</footer>
