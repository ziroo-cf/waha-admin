import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Enables using Vite-native tooling (e.g. Tailwind v4) inside <style> blocks.
	preprocess: vitePreprocess(),

	kit: {
		/**
		 * adapter-cloudflare builds the app as a Cloudflare Pages/Workers project.
		 * `routes: { include: ['/*'], exclude: ['<all>'] }` serves all static
		 * assets directly from the Pages CDN and everything else from the SSR worker.
		 */
		adapter: adapter({
			routes: {
				include: ['/*'],
				exclude: ['<all>']
			}
		})
	}
};

export default config;
