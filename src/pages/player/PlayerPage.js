import VideoPlayer from '../../components/VideoPlayer/VideoPlayer.js';

/**
 * PlayerPage — standalone fullscreen player page.
 *
 * Instead of embedding VideoPlayer inside each content page,
 * the app navigates HERE for fullscreen playback. The History API
 * handles back-navigation naturally — pressing Back returns to
 * the previous page without any manual keydown toggling.
 *
 * Usage (from main.js):
 *   const page = new PlayerPage();
 *   await page.mount(container, {
 *       url:      'http://...',
 *       title:    'Movie Name',
 *       subtitle: '2024 • Action',
 *   });
 */

class PlayerPage {
    static PAGE_ID = 'player';

    constructor() {
        this._container = null;
        this._player = new VideoPlayer();
        this._isDestroyed = false;
    }

    // ─── Lifecycle ──────────────────────────────────────────

    /**
     * Mount the player page and begin playback.
     * @param {HTMLElement} container
     * @param {{ url: string, title?: string, subtitle?: string }} streamInfo
     */
    async mount(container, streamInfo) {
        this._container = container;
        this._container.innerHTML = '<div class="player-page" id="player-page"></div>';

        const root = this._container.querySelector('#player-page');
        this._player.mount(root);

        if (streamInfo) {
            this._player.load({
                url: streamInfo.url,
                title: streamInfo.title || '',
                subtitle: streamInfo.subtitle || '',
                mode: 'fullscreen',
            });
        }

        // Listen for VideoPlayer's back event → navigate back
        root.addEventListener('player:back', () => {
            this._goBack();
        });
    }

    destroy() {
        this._isDestroyed = true;
        this._player.destroy();
        if (this._container) this._container.innerHTML = '';
        this._container = null;
    }

    // ─── Navigation ─────────────────────────────────────────

    _goBack() {
        window.history.back();
    }
}

export default PlayerPage;
