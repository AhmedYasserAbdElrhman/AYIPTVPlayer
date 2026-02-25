import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

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
            function scan(dir, keyPrefix, subDir = '') {
                const entries = readdirSync(dir);
                for (const entry of entries) {
                    if (entry.startsWith('.')) continue;
                    const fullPath = join(dir, entry);
                    const relativePath = subDir ? `${subDir}/${entry}` : entry;
                    if (statSync(fullPath).isDirectory()) {
                        scan(fullPath, keyPrefix, relativePath);
                    } else if (entry.endsWith('.html')) {
                        templates[`${keyPrefix}/${relativePath}`] = readFileSync(fullPath, 'utf-8');
                    }
                }
            }
            scan(resolve(__dirname, 'src/pages'), 'pages');
            scan(resolve(__dirname, 'src/components'), 'components');
            return `export default ${JSON.stringify(templates)};`;
        },
    };
}

function webosHtmlFix() {
    return {
        name: 'webos-html-fix',
        enforce: 'post',
        apply: 'build',
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
                    if (assetInfo.name?.endsWith('.css')) return 'app.css';
                    return '[name][extname]';
                },
                manualChunks: undefined,
            },
        },
        chunkSizeWarningLimit: 800,
        assetsInlineLimit: 4096,
        cssCodeSplit: false,
        minify: 'esbuild',
        modulePreload: false,
    },
});