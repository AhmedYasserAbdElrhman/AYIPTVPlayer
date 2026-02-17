import TemplateEngine from '../../utils/templateEngine.js';
import XtreamAuth from '../../api/XtreamAuth.js';
import LiveService from '../../api/LiveService.js';
import VodService from '../../api/VodService.js';
import SeriesService from '../../api/SeriesService.js';
import Settings from '../../config/settings.js';

/**
 * SplashPage — app entry point.
 *
 * Owns the startup sequence: renders the splash UI, checks for saved
 * credentials, authenticates, preloads content, then reports back to App
 * via run()'s return value so App can route to Home or Login.
 */
class SplashPage {
    static PAGE_ID = 'splash';

    constructor() {
        this._el = null;
        this._statusEl = null;
    }

    // ─── Lifecycle ──────────────────────────────────────────────

    async mount() {
        this._el = document.getElementById('splash');
        if (!this._el) return;
        await TemplateEngine.load('pages/splash/splash.html', this._el);
        this._statusEl = this._el.querySelector('.splash__status');
    }

    destroy() {
        if (this._el) this._el.remove();
        this._el = null;
        this._statusEl = null;
    }

    // ─── Public API ─────────────────────────────────────────────

    setStatus(text) {
        if (this._statusEl) this._statusEl.textContent = text;
    }

    /** Yields to the browser so it can paint the current frame. */
    _nextFrame() {
        return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }

    dismiss() {
        return new Promise(resolve => {
            if (!this._el) {
                resolve();
                return;
            }
            this._el.classList.add('splash--hidden');
            setTimeout(() => {
                this._el?.remove();
                this._el = null;
                this._statusEl = null;
                resolve();
            }, 700);
        });
    }

    /**
     * Runs the full startup sequence.
     * @returns {Promise<AuthResponse|null>} Authenticated session, or null if
     *   credentials are missing / authentication failed.
     */
    async run() {
        if (!this._hasSavedCredentials()) return null;

        this.setStatus('Authenticating…');
        const session = await XtreamAuth.restoreSession();
        if (!session) return null;

        await this._preloadContent();
        return session;
    }

    // ─── Private ────────────────────────────────────────────────

    _hasSavedCredentials() {
        const { host, port } = Settings.server;
        const { username, password } = Settings.credentials;
        return !!(host && port && username && password);
    }

    /**
     * Fires all content requests in parallel. Status text advances in order
     * as each group resolves. Any single failure is swallowed so a slow
     * endpoint doesn't block the whole startup.
     */
    async _preloadContent() {
        // Fire all requests in parallel immediately
        const livePromise = Promise.all([
            LiveService.getCategories().catch(() => {}),
            LiveService.getStreams().catch(() => {}),
        ]);
        const vodPromise = Promise.all([
            VodService.getCategories().catch(() => {}),
            VodService.getStreams().catch(() => {}),
        ]);
        const seriesPromise = Promise.all([
            SeriesService.getCategories().catch(() => {}),
            SeriesService.getSeries().catch(() => {}),
        ]);

        // Yield after each status update so the browser can paint the text
        // before JSON parsing from the resolved promise blocks the thread.
        this.setStatus('Loading channels…');
        await this._nextFrame();
        await livePromise;

        this.setStatus('Loading movies…');
        await this._nextFrame();
        await vodPromise;

        this.setStatus('Loading series…');
        await this._nextFrame();
        await seriesPromise;

        this.setStatus('Ready');
    }
}

export default SplashPage;
