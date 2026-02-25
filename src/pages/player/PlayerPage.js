import VideoPlayer from '../../components/VideoPlayer/VideoPlayer.js';
import SeriesService from '../../api/SeriesService.js';

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
 *       // For series:
 *       episodes:   [...],
 *       episodeIdx: 0,
 *       season:     '1',
 *   });
 */

// Extensions natively supported by HTML5 <video> / HLS.js
const SUPPORTED_EXT = new Set(['mp4', 'm3u8', 'ts', 'mkv', 'webm']);

class PlayerPage {
    static PAGE_ID = 'player';

    constructor() {
        this._container = null;
        this._player = new VideoPlayer();
        this._isDestroyed = false;
        this._rootEl = null;
        this._backHandler = () => this._goBack();
        this._channelUpHandler = () => this._prevEpisode();
        this._channelDownHandler = () => this._nextEpisode();

        // Episode navigation state
        this._episodes = null;
        this._episodeIdx = 0;
        this._season = null;
        this._seriesName = '';
    }

    // ─── Lifecycle ──────────────────────────────────────────

    /**
     * Mount the player page and begin playback.
     * @param {HTMLElement} container
     * @param {{ url: string, title?: string, subtitle?: string, episodes?: Array, episodeIdx?: number, season?: string }} streamInfo
     */
    async mount(container, streamInfo) {
        this._container = container;
        this._container.innerHTML = '<div class="player-page" id="player-page"></div>';

        const root = this._container.querySelector('#player-page');
        await this._player.mount(root);

        // Store episode list for next/prev navigation
        if (streamInfo?.episodes?.length) {
            this._episodes = streamInfo.episodes;
            this._episodeIdx = streamInfo.episodeIdx || 0;
            this._season = streamInfo.season || '';
            this._seriesName = streamInfo.title || 'Series';
        }

        if (streamInfo) {
            this._player.load({
                url: streamInfo.url,
                title: streamInfo.title || '',
                subtitle: streamInfo.subtitle || '',
                mode: 'fullscreen',
                episodes: !!streamInfo?.episodes?.length,
            });
        }

        // Listen for VideoPlayer events
        this._rootEl = root;
        root.addEventListener('player:back', this._backHandler);
        root.addEventListener('player:channel-up', this._channelUpHandler);
        root.addEventListener('player:channel-down', this._channelDownHandler);
    }

    destroy() {
        this._isDestroyed = true;
        if (this._rootEl) {
            this._rootEl.removeEventListener('player:back', this._backHandler);
            this._rootEl.removeEventListener('player:channel-up', this._channelUpHandler);
            this._rootEl.removeEventListener('player:channel-down', this._channelDownHandler);
            this._rootEl = null;
        }
        this._player.destroy();
        if (this._container) this._container.innerHTML = '';
        this._container = null;
        this._episodes = null;
    }

    // ─── Episode Navigation ───────────────────────────────────

    _prevEpisode() {
        if (!this._episodes || this._episodeIdx <= 0) return;
        this._episodeIdx--;
        this._loadEpisode(this._episodes[this._episodeIdx]);
    }

    _nextEpisode() {
        if (!this._episodes || this._episodeIdx >= this._episodes.length - 1) return;
        this._episodeIdx++;
        this._loadEpisode(this._episodes[this._episodeIdx]);
    }

    _loadEpisode(episode) {
        const rawExt = episode.container_extension || 'mp4';
        const ext = SUPPORTED_EXT.has(rawExt) ? rawExt : 'mp4';
        const url = SeriesService.getEpisodeUrl(episode.id, ext);
        const epTitle = episode.title || episode.name || 'Episode ' + (episode.episode_num || '');

        this._player.load({
            url,
            title: this._seriesName,
            subtitle: 'S' + this._season + ' · ' + epTitle,
            mode: 'fullscreen',
            episodes: true,
        });
    }

    // ─── Navigation ─────────────────────────────────────────

    _goBack() {
        window.history.back();
    }
}

export default PlayerPage;
