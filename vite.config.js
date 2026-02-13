import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Inlines all HTML templates into a virtual JS module at build time.
 */
function inlineTemplates() {
    const virtualModuleId = 'virtual:templates';
    const resolvedId = '\0' + virtualModuleId;

    return {
        name: 'inline-templates',

        resolveId(id) {
            if (id === virtualModuleId) return resolvedId;
        },

        load(id) {
            if (id !== resolvedId) return;

            const templates = {};
            const pagesDir = resolve(__dirname, 'src/pages');

            function scan(dir, prefix = '') {
                const entries = readdirSync(dir);
                for (const entry of entries) {
                    const fullPath = join(dir, entry);
                    const relativePath = prefix ? `${prefix}/${entry}` : entry;

                    if (statSync(fullPath).isDirectory()) {
                        scan(fullPath, relativePath);
                    } else if (entry.endsWith('.html')) {
                        const key = `pages/${relativePath}`;
                        templates[key] = readFileSync(fullPath, 'utf-8');
                    }
                }
            }

            scan(pagesDir);

            return `export default ${JSON.stringify(templates)};`;
        },
    };
}

/**
 * Cleans the output HTML for WebOS compatibility.
 * - Removes type="module" from script tags
 * - Removes crossorigin attributes
 */
function webosHtmlFix() {
    return {
        name: 'webos-html-fix',
        enforce: 'post',

        transformIndexHtml(html) {
            return html
                .replace(/ type="module"/g, '')
                .replace(/ crossorigin/g, '');
        },
    };
}

export default defineConfig({
    root: '.',

    plugins: [
        inlineTemplates(),
        webosHtmlFix(),
    ],

    base: './',

    server: {
        port: 8888,
        open: true,
        host: true,
    },

    build: {
        outDir: 'dist',
        target: 'es2020',

        rollupOptions: {
            input: resolve(__dirname, 'index.html'),
            output: {
                format: 'iife',
                entryFileNames: 'app.js',
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name?.endsWith('.css')) {
                        return 'app.css';
                    }
                    return '[name][extname]';
                },
                manualChunks: undefined,
            },
        },

        assetsInlineLimit: 4096,
        cssCodeSplit: false,
        minify: 'esbuild',
        modulePreload: false,
    },
});
