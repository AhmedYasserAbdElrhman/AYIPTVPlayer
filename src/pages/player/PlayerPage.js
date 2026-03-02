import VideoPlayer from '../../components/VideoPlayer/VideoPlayer.js';
import SeriesService from '../../api/SeriesService.js';
import WatchHistoryService from '../../services/WatchHistoryService.js';
import WatchHistoryEntry from '../../models/WatchHistoryEntry.js';
import PlaybackProgressService from '../../services/PlaybackProgressService.js';
import ResumeAlert from '../../components/ResumeAlert/ResumeAlert.js';

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
 *       // Metadata for history tracking:
 *       contentId:   '123',
 *       contentType: 'movie',
 *       thumbnail:   'http://...',
 *   });
 */

// Extensions natively supported by HTML5 <video> / HLS.js
const SUPPORTED_EXT = new Set(['mp4', 'm3u8', 'ts', 'mkv', 'webm']);
const PROGRESS_INTERVAL = 10_000; // save progress every 10s

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

        // Watch history / progress tracking
        this._historyEntryId = null;  // series:{id} or movie:{id}
        this._progressKey = null;     // episode:{...} per-episode, or same as historyEntryId
        this._progressInterval = null;
        this._resumeAlert = new ResumeAlert();
    }

    // ─── Lifecycle ──────────────────────────────────────────

    /**
     * Mount the player page and begin playback.
     * @param {HTMLElement} container
     * @param {Object} streamInfo
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

        // Record in watch history
        this._recordHistory(streamInfo);

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

        // Non-blocking: show resume alert + start progress tracking
        this._showResumeAlertIfNeeded();
        this._startProgressTracking();
    }

    destroy() {
        this._isDestroyed = true;
        this._stopProgressTracking();

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

    // ─── Watch History ────────────────────────────────────────

    _recordHistory(streamInfo) {
        if (!streamInfo?.contentId) return;

        const entry = WatchHistoryEntry.fromPlayRequest(streamInfo);
        WatchHistoryService.add(entry);
        this._historyEntryId = entry.id;
        this._progressKey = entry.getProgressKey();
    }

    // ─── Resume Alert ─────────────────────────────────────────

    async _showResumeAlertIfNeeded() {
        if (!this._progressKey) return;
        // No resume for live content
        if (this._progressKey.startsWith('live:')) return;

        // Wait for video metadata so seek works
        await this._waitForDuration();
        if (this._isDestroyed) return;

        const progress = PlaybackProgressService.get(this._progressKey);
        if (!progress || progress.currentTime < 10) return;

        const shouldResume = await this._resumeAlert.show(this._rootEl, progress.currentTime);
        if (this._isDestroyed) return;

        if (shouldResume) {
            this._seekTo(progress.currentTime);
        }
    }

    _waitForDuration(timeout = 5000) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                if (this._isDestroyed) { resolve(); return; }
                const d = this._player.getDuration();
                if (d && isFinite(d)) { resolve(); return; }
                if (Date.now() - start > timeout) { resolve(); return; }
                setTimeout(check, 200);
            };
            check();
        });
    }

    _seekTo(seconds) {
        const video = this._player._els?.video;
        if (video) video.currentTime = seconds;
    }

    // ─── Progress Tracking ────────────────────────────────────

    _startProgressTracking() {
        if (!this._progressKey) return;
        if (this._progressKey.startsWith('live:')) return;

        this._progressInterval = setInterval(() => {
            this._saveCurrentProgress();
        }, PROGRESS_INTERVAL);
    }

    _stopProgressTracking() {
        if (this._progressInterval) {
            clearInterval(this._progressInterval);
            this._progressInterval = null;
        }
        // Final save on exit
        this._saveCurrentProgress(true);
    }

    _saveCurrentProgress(immediate = false) {
        if (!this._progressKey) return;
        if (this._progressKey.startsWith('live:')) return;

        const currentTime = this._player.getCurrentTime();
        const duration = this._player.getDuration();
        if (!duration || !isFinite(duration) || currentTime <= 0) return;

        if (immediate) {
            PlaybackProgressService.saveImmediate(this._progressKey, currentTime, duration);
        } else {
            PlaybackProgressService.save(this._progressKey, currentTime, duration);
        }
    }

    // ─── Episode Navigation ───────────────────────────────────

    _prevEpisode() {
        if (!this._episodes || this._episodeIdx <= 0) return;
        this._stopProgressTracking();
        this._episodeIdx--;
        this._loadEpisode(this._episodes[this._episodeIdx]);
    }

    _nextEpisode() {
        if (!this._episodes || this._episodeIdx >= this._episodes.length - 1) return;
        this._stopProgressTracking();
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

        // Update history for the new episode
        this._recordHistory({
            url,
            title: this._seriesName,
            subtitle: 'S' + this._season + ' · ' + epTitle,
            contentId: String(episode.id),
            contentType: 'episode',
            seriesId: this._episodes[0]?.series_id ? String(this._episodes[0].series_id) : '',
            seriesName: this._seriesName,
            season: this._season,
            episodeIdx: this._episodeIdx,
        });

        this._startProgressTracking();
    }

    // ─── Navigation ─────────────────────────────────────────

    _goBack() {
        window.history.back();
    }
}

export default PlayerPage;
