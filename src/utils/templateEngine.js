/**
 * Template Engine — loads and caches HTML templates.
 * 
 * How it works:
 * - PROD: Templates are pre-registered at startup (bundled by Vite plugin)
 * - DEV:  Fetches .html files over HTTP (Vite dev server)
 * 
 * No file:// fetching needed. No dynamic imports. Works everywhere.
 */
class TemplateEngine {
    constructor() {
        /** @type {Map<string, string>} */
        this._cache = new Map();
    }

    /**
     * Registers pre-bundled templates into cache.
     * Called once at app startup with the Vite virtual module output.
     * @param {Object<string, string>} templates - { 'pages/login/login.html': '<div>...</div>' }
     */
    registerTemplates(templates) {
        for (const [key, html] of Object.entries(templates)) {
            this._cache.set(key, html);
        }
    }

    /**
     * Fetches an HTML template and injects it into a container.
     * @param {string} templatePath
     * @param {HTMLElement} container
     * @returns {Promise<void>}
     */
    async load(templatePath, container) {
        const html = await this.fetch(templatePath);
        container.innerHTML = html;
    }

    /**
     * Fetches an HTML template string.
     * Checks: cache → normalized cache → HTTP fetch → XHR fetch
     * @param {string} templatePath
     * @returns {Promise<string>}
     */
    async fetch(templatePath) {
        // Normalize: remove 'src/' prefix
        const normalized = templatePath.replace(/^src\//, '');

        // 1. Check cache with original path
        if (this._cache.has(templatePath)) {
            return this._cache.get(templatePath);
        }

        // 2. Check cache with normalized path
        if (this._cache.has(normalized)) {
            return this._cache.get(normalized);
        }

        // 3. Try HTTP fetch (dev server only)
        try {
            const html = await this._httpFetch(templatePath);
            this._cache.set(templatePath, html);
            return html;
        } catch {
            // not on dev server
        }

        throw new Error(`Template not found: ${templatePath}`);
    }

    /**
     * Preloads templates — no-op if already registered.
     * @param {string[]} templatePaths
     * @returns {Promise<void>}
     */
    async preload(templatePaths) {
        await Promise.all(templatePaths.map(path => this.fetch(path)));
    }

    /**
     * @param {string} templatePath
     */
    invalidate(templatePath) {
        this._cache.delete(templatePath);
    }

    clearCache() {
        this._cache.clear();
    }

    /**
     * @param {string} path
     * @returns {Promise<string>}
     * @private
     */
    async _httpFetch(path) {
        const response = await globalThis.fetch(path);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${path}`);
        }

        return response.text();
    }
}

export default new TemplateEngine();