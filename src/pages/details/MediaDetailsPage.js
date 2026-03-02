/**
 * MediaDetailsPage — shared detail page for Movies & Series.
 *
 * Layout:
 *   - Full-page view with blurred poster background
 *   - Left: Poster  |  Right: Title, meta, plot, play/seasons/episodes
 *
 * Focus regions (TV navigation):
 *   0 = Back button
 *   1 = Play button (movies) / Season tabs (series)
 *   2 = Episode list (series only)
 *
 * Usage:
 *   const page = new MediaDetailsPage();
 *   await page.mount(container, { item, type: 'movie' | 'series' });
 */

import VodService from '../../api/VodService.js';
import SeriesService from '../../api/SeriesService.js';
import { EVENTS } from '../../config/AppConstants.js';
import { mapRemoteEvent } from '../../input/RemoteKeyMapper.js';
import { RemoteActions } from '../../input/RemoteActions.js';
import TemplateEngine from '../../utils/templateEngine.js';
import WatchHistoryService from '../../services/WatchHistoryService.js';

const SUPPORTED_EXT = new Set(['mp4', 'm3u8', 'ts', 'mkv', 'webm']);

const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>';

class MediaDetailsPage {
    static PAGE_ID = 'details';

    constructor() {
        this._container = null;
        this._el = {};
        this._type = 'movie';   // 'movie' or 'series'
        this._item = null;      // basic item from grid
        this._info = null;      // full API response
        this._isDestroyed = false;

        // Series state
        this._seasonKeys = [];
        this._activeSeason = null;
        this._seasonBtns = [];
        this._episodeEls = [];
        this._seasonIdx = 0;
        this._episodeIdx = 0;
        this._playBtn = null;
        this._continueBtn = null;
        this._playSeriesBtn = null;
        this._resumeEpisodeIdx = null;

        // Focus
        this._region = 0;       // 0=back, 1=play/seasons, 2=episodes
        this._keyHandler = this._onKey.bind(this);

        // Delegated click handlers (one per container, avoids per-element listeners)
        this._onActionClick = this._onActionClick.bind(this);
        this._onSeasonClick = this._onSeasonClick.bind(this);
        this._onEpisodeClick = this._onEpisodeClick.bind(this);
    }

    /* ═══════════════ LIFECYCLE ═══════════════ */

    async mount(container, { item, type }) {
        this._container = container;
        this._item = item;
        this._type = type;

        await TemplateEngine.load('pages/details/details.html', this._container);
        this._cacheDom();
        this._populateInitial();
        this._bindEvents();

        // Focus back button initially
        this._region = 0;
        this._setFocus();

        // Fetch full details
        await this._loadDetails();
    }

    destroy() {
        this._isDestroyed = true;
        document.removeEventListener('keydown', this._keyHandler);
        this._el.actions?.removeEventListener('click', this._onActionClick);
        this._el.seasons?.removeEventListener('click', this._onSeasonClick);
        this._el.episodes?.removeEventListener('click', this._onEpisodeClick);
        this._seasonBtns = [];
        this._episodeEls = [];
        this._playBtn = null;
        this._continueBtn = null;
        this._playSeriesBtn = null;
        if (this._container) {
            this._container.textContent = '';
        }
    }

    /* ═══════════════ TEMPLATE ═══════════════ */

    _cacheDom() {
        const c = this._container;
        this._el = {
            bg: c.querySelector('#details-bg'),
            back: c.querySelector('#details-back'),
            poster: c.querySelector('#details-poster'),
            title: c.querySelector('#details-title'),
            meta: c.querySelector('#details-meta'),
            plot: c.querySelector('#details-plot'),
            actions: c.querySelector('#details-actions'),
            seasons: c.querySelector('#details-seasons'),
            episodes: c.querySelector('#details-episodes'),
            loading: c.querySelector('#details-loading'),
        };
    }

    /** Populate the template with initial item data (before API response) */
    _populateInitial() {
        const item = this._item;
        const cover = item.cover || item.stream_icon || '';
        const name = item.name || 'Untitled';

        // Background
        if (cover) {
            this._el.bg.style.backgroundImage = 'url(' + cover + ')';
        }

        // Poster
        if (cover) {
            const img = document.createElement('img');
            img.src = cover;
            img.alt = '';
            this._el.poster.appendChild(img);
        } else {
            this._el.poster.innerHTML =
                '<div class="details-poster__placeholder">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
                '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>' +
                '<line x1="7" y1="2" x2="7" y2="22"/>' +
                '<line x1="17" y1="2" x2="17" y2="22"/>' +
                '<line x1="2" y1="12" x2="22" y2="12"/>' +
                '</svg></div>';
        }

        // Title
        this._el.title.textContent = name;
    }

    _bindEvents() {
        document.addEventListener('keydown', this._keyHandler);
        this._el.back.addEventListener('click', () => this._goBack());
        this._el.actions.addEventListener('click', this._onActionClick);
        this._el.seasons.addEventListener('click', this._onSeasonClick);
        this._el.episodes.addEventListener('click', this._onEpisodeClick);
    }

    /* ═══════════════ DATA LOADING ═══════════════ */

    async _loadDetails() {
        try {
            if (this._type === 'movie') {
                const id = this._item.stream_id || this._item.id;
                const full = await VodService.getInfo(id);
                if (this._isDestroyed) return;
                this._info = full;
                this._renderMovieDetails(full);
            } else {
                const id = this._item.series_id || this._item.id;
                const full = await SeriesService.getInfo(id);
                if (this._isDestroyed) return;
                this._info = full;
                this._renderSeriesDetails(full);
            }
        } catch (err) {
            console.error('[MediaDetailsPage] Failed to load details:', err);
            if (this._isDestroyed) return;
            // Show basic info from grid item
            if (this._type === 'movie') {
                this._renderMovieDetails({ info: this._item });
            } else {
                this._renderSeriesDetails({ info: this._item, episodes: {} });
            }
        }

        this._el.loading.style.display = 'none';
    }

    /* ═══════════════ MOVIE DETAILS ═══════════════ */

    _renderMovieDetails(data) {
        const info = data?.info || data?.movie_data || this._item;
        const merged = { ...this._item, ...info };

        this._renderMeta(merged);
        this._renderPlot(merged.plot || merged.description || '');

        // Play button
        this._el.actions.innerHTML =
            '<button class="details-play" id="details-play">' +
            PLAY_SVG + ' Play' +
            '</button>';

        this._playBtn = this._el.actions.querySelector('#details-play');

        // Focus play button
        this._region = 1;
        this._setFocus();
    }

    _playMovie() {
        const item = this._item;
        const info = this._info?.info || this._info?.movie_data || {};
        const merged = { ...item, ...info };
        const rawExt = merged.container_extension || item.container_extension || 'mp4';
        const ext = SUPPORTED_EXT.has(rawExt) ? rawExt : 'mp4';
        const url = VodService.getStreamUrl(item.stream_id || item.id, ext);

        console.log('[MediaDetailsPage] _playMovie called!', { url, ext, id: item.stream_id || item.id });

        this._container.dispatchEvent(
            new CustomEvent(EVENTS.PLAY_REQUEST, {
                detail: {
                    url,
                    title: merged.name || item.name || 'Movie',
                    subtitle: merged.year ? String(merged.year) : '',
                    contentId: String(item.stream_id || item.id),
                    contentType: 'movie',
                    thumbnail: item.stream_icon || item.cover || '',
                },
                bubbles: true,
            })
        );
    }

    /* ═══════════════ SERIES DETAILS ═══════════════ */

    _renderSeriesDetails(data) {
        const info = data?.info || this._item;
        const merged = { ...this._item, ...info };

        this._renderMeta(merged);
        this._renderPlot(merged.plot || merged.description || '');

        // Parse episodes
        const episodes = data?.episodes || {};
        this._seasonKeys = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
        this._activeSeason = this._seasonKeys[0] || null;
        this._seasonIdx = 0;
        this._episodeIdx = 0;

        // Check watch history for this series
        const seriesId = String(this._item.series_id || this._item.id);
        const historyEntry = WatchHistoryService.getById('series:' + seriesId);

        if (historyEntry && historyEntry.season != null) {
            // Auto-select the last watched season
            const resumeKey = String(historyEntry.season);
            const idx = this._seasonKeys.indexOf(resumeKey);
            if (idx >= 0) {
                this._activeSeason = resumeKey;
                this._seasonIdx = idx;
            }
            this._resumeEpisodeIdx = historyEntry.episodeIdx;
        }

        if (this._seasonKeys.length > 0) {
            if (historyEntry) {
                // Has history — show "Continue" button
                this._renderContinueButton();
            } else {
                // No history — show "Play" button (starts S1E1)
                this._renderPlayButton();
            }

            this._el.seasons.style.display = 'flex';
            this._el.episodes.style.display = 'flex';
            this._renderSeasonTabs();
            this._renderEpisodes();

            // Auto-select resume episode
            if (this._resumeEpisodeIdx != null) {
                const epIdx = Number(this._resumeEpisodeIdx);
                const epList = episodes[this._activeSeason] || [];
                if (epIdx >= 0 && epIdx < epList.length) {
                    this._episodeIdx = epIdx;
                }
            }

            // Focus action button or first season
            this._region = 1;
            this._setFocus();
        }
    }

    _renderSeasonTabs() {
        const container = this._el.seasons;
        container.innerHTML = '';
        container.className = 'details-seasons';
        this._seasonBtns = [];

        for (let i = 0; i < this._seasonKeys.length; i++) {
            const key = this._seasonKeys[i];
            const btn = document.createElement('button');
            btn.className = key === this._activeSeason
                ? 'details-season-btn details-season-btn--active'
                : 'details-season-btn';
            btn.textContent = 'Season ' + key;
            btn.dataset.season = key;

            container.appendChild(btn);
            this._seasonBtns.push(btn);
        }
    }

    _renderEpisodes() {
        const container = this._el.episodes;
        container.innerHTML = '';
        this._episodeEls = [];

        if (!this._info?.episodes || !this._activeSeason) return;
        const episodes = this._info.episodes[this._activeSeason] || [];

        for (let i = 0; i < episodes.length; i++) {
            const ep = episodes[i];
            const el = document.createElement('button');
            el.className = 'details-ep';
            el.dataset.idx = i;

            const num = ep.episode_num || ep.sort || '';
            const title = ep.title || ep.name || 'Episode ' + num;
            const duration = ep.info?.duration || '';

            const numSpan = document.createElement('span');
            numSpan.className = 'details-ep__num';
            numSpan.textContent = num;

            const body = document.createElement('div');
            body.className = 'details-ep__body';
            const titleSpan = document.createElement('span');
            titleSpan.className = 'details-ep__title';
            titleSpan.textContent = title;
            body.appendChild(titleSpan);
            if (duration) {
                const durSpan = document.createElement('span');
                durSpan.className = 'details-ep__duration';
                durSpan.textContent = duration;
                body.appendChild(durSpan);
            }

            const playIcon = document.createElement('div');
            playIcon.className = 'details-ep__play';
            playIcon.innerHTML = PLAY_SVG;

            el.appendChild(numSpan);
            el.appendChild(body);
            el.appendChild(playIcon);

            container.appendChild(el);
            this._episodeEls.push(el);
        }
    }

    _switchSeason(key) {
        this._activeSeason = key;
        for (let i = 0; i < this._seasonBtns.length; i++) {
            this._seasonBtns[i].className = this._seasonBtns[i].dataset.season === key
                ? 'details-season-btn details-season-btn--active'
                : 'details-season-btn';
        }
        if (this._seasonBtns[this._seasonIdx]) {
            this._seasonBtns[this._seasonIdx].className += ' focused';
        }
        this._episodeIdx = 0;
        this._renderEpisodes();
    }

    _renderPlayButton() {
        const epList = this._info?.episodes?.[this._activeSeason] || [];
        if (!epList.length) return;

        this._el.actions.innerHTML =
            '<button class="details-play" id="details-play-series">' +
            PLAY_SVG + ' Play' +
            '</button>';

        this._playSeriesBtn = this._el.actions.querySelector('#details-play-series');
    }

    _playFirstEpisode() {
        const epList = this._info?.episodes?.[this._activeSeason] || [];
        if (epList[0]) {
            this._episodeIdx = 0;
            this._playEpisode(epList[0]);
        }
    }

    _renderContinueButton() {
        const epList = this._info?.episodes?.[this._activeSeason] || [];
        const epIdx = Number(this._resumeEpisodeIdx);
        const ep = epList[epIdx];
        if (!ep) return;

        const epTitle = ep.title || ep.name || 'Episode ' + (ep.episode_num || '');
        this._el.actions.innerHTML =
            '<button class="details-play details-play--continue" id="details-continue">' +
            PLAY_SVG + ' Continue · S' + this._activeSeason + ' · ' + _escapeHtml(epTitle) +
            '</button>';

        this._continueBtn = this._el.actions.querySelector('#details-continue');
    }

    _playContinue() {
        const epList = this._info?.episodes?.[this._activeSeason] || [];
        const epIdx = Number(this._resumeEpisodeIdx);
        if (epList[epIdx]) {
            this._episodeIdx = epIdx;
            this._playEpisode(epList[epIdx]);
        }
    }

    _playEpisode(episode) {
        const rawExt = episode.container_extension || 'mp4';
        const ext = SUPPORTED_EXT.has(rawExt) ? rawExt : 'mp4';
        const url = SeriesService.getEpisodeUrl(episode.id, ext);
        const seriesName = this._item?.name || 'Series';
        const epTitle = episode.title || episode.name || 'Episode ' + (episode.episode_num || '');
        const episodes = this._info?.episodes?.[this._activeSeason] || [];

        this._container.dispatchEvent(
            new CustomEvent(EVENTS.PLAY_REQUEST, {
                detail: {
                    url,
                    title: seriesName,
                    subtitle: 'S' + this._activeSeason + ' · ' + epTitle,
                    episodes,
                    episodeIdx: this._episodeIdx,
                    season: this._activeSeason,
                    contentId: String(episode.id),
                    contentType: 'episode',
                    seriesId: String(this._item.series_id || this._item.id),
                    seriesName,
                    thumbnail: this._item.cover || '',
                },
                bubbles: true,
            })
        );
    }

    /* ═══════════════ DELEGATED CLICK HANDLERS ═══════════════ */

    _onActionClick(e) {
        if (e.target.closest('#details-continue')) return this._playContinue();
        if (e.target.closest('#details-play-series')) return this._playFirstEpisode();
        if (e.target.closest('#details-play')) this._playMovie();
    }

    _onSeasonClick(e) {
        const btn = e.target.closest('[data-season]');
        if (!btn) return;
        const idx = this._seasonKeys.indexOf(btn.dataset.season);
        if (idx >= 0) {
            this._seasonIdx = idx;
            this._switchSeason(btn.dataset.season);
        }
    }

    _onEpisodeClick(e) {
        const el = e.target.closest('[data-idx]');
        if (!el) return;
        const idx = Number(el.dataset.idx);
        const episodes = this._info?.episodes?.[this._activeSeason] || [];
        if (episodes[idx]) {
            this._episodeIdx = idx;
            this._playEpisode(episodes[idx]);
        }
    }

    /* ═══════════════ SHARED RENDERING ═══════════════ */

    _renderMeta(info) {
        const parts = [];
        if (info.year || info.releasedate || info.releaseDate) {
            parts.push('<span>' + _escapeHtml(String(info.year || info.releasedate || info.releaseDate)) + '</span>');
        }
        if (info.duration) {
            parts.push('<span>' + _escapeHtml(info.duration) + '</span>');
        }
        if (info.genre) {
            parts.push('<span>' + _escapeHtml(info.genre) + '</span>');
        }
        if (info.rating || info.rating_5based) {
            const r = info.rating || info.rating_5based;
            parts.push('<span class="details-rating">★ ' + _escapeHtml(String(r)) + '</span>');
        }
        this._el.meta.innerHTML = parts.join('');
    }

    _renderPlot(plot) {
        this._el.plot.textContent = plot;
        this._el.plot.style.display = plot ? '' : 'none';
    }

    /* ═══════════════ NAVIGATION ═══════════════ */

    /** Region indices that adapt based on whether an action button exists */
    get _hasActionBtn() { return !!(this._continueBtn || this._playSeriesBtn); }
    get _seasonsRegion() { return this._hasActionBtn ? 2 : 1; }
    get _episodesRegion() { return this._hasActionBtn ? 3 : 2; }

    _navUp() {
        const sr = this._seasonsRegion;
        const er = this._episodesRegion;

        if (this._region === er) {
            if (this._episodeIdx > 0) {
                this._episodeIdx--;
            } else {
                this._region = sr;
            }
        } else if (this._region === sr && this._hasActionBtn) {
            this._region = 1;
        } else if (this._region <= 1 && this._region > 0) {
            this._region = 0;
        }
        this._setFocus();
    }

    _navDown() {
        const sr = this._seasonsRegion;
        const er = this._episodesRegion;

        if (this._region === 0) {
            this._region = 1;
        } else if (this._region === 1 && this._hasActionBtn) {
            this._region = sr;
        } else if (this._region === sr && this._type === 'series' && this._episodeEls.length > 0) {
            this._region = er;
            this._episodeIdx = 0;
        } else if (this._region === er) {
            if (this._episodeIdx < this._episodeEls.length - 1) {
                this._episodeIdx++;
            }
        }
        this._setFocus();
    }

    _navLeft() {
        const sr = this._seasonsRegion;
        if (this._region === sr && this._type === 'series') {
            if (this._seasonIdx > 0) {
                this._seasonIdx--;
                this._switchSeason(this._seasonKeys[this._seasonIdx]);
                this._setFocus();
            }
        }
    }

    _navRight() {
        const sr = this._seasonsRegion;
        if (this._region === sr && this._type === 'series') {
            if (this._seasonIdx < this._seasonKeys.length - 1) {
                this._seasonIdx++;
                this._switchSeason(this._seasonKeys[this._seasonIdx]);
                this._setFocus();
            }
        }
    }

    _navOk() {
        const er = this._episodesRegion;
        if (this._region === 0) {
            this._goBack();
        } else if (this._region === 1) {
            if (this._type === 'movie') {
                this._playMovie();
            } else if (this._continueBtn) {
                this._playContinue();
            } else if (this._playSeriesBtn) {
                this._playFirstEpisode();
            }
        } else if (this._region === er) {
            const episodes = this._info?.episodes?.[this._activeSeason] || [];
            if (episodes[this._episodeIdx]) {
                this._playEpisode(episodes[this._episodeIdx]);
            }
        }
    }

    _goBack() {
        window.history.back();
    }

    /* ═══════════════ FOCUS MANAGEMENT ═══════════════ */

    /**
     * Focus regions:
     *  0 = Back button
     *  1 = Continue button (series with resume) / Play button (movie) / Season tabs
     *  2 = Season tabs (when continue button is in region 1) / Episode list
     *  3 = Episode list (when continue button pushes seasons to region 2)
     */
    _setFocus() {
        // Clear all focus
        this._el.back.classList.remove('focused');
        if (this._playBtn) this._playBtn.classList.remove('focused');
        if (this._continueBtn) this._continueBtn.classList.remove('focused');
        if (this._playSeriesBtn) this._playSeriesBtn.classList.remove('focused');
        for (const btn of this._seasonBtns) btn.classList.remove('focused');
        for (const el of this._episodeEls) el.classList.remove('focused');

        const seasonsRegion = this._continueBtn ? 2 : 1;
        const episodesRegion = this._continueBtn ? 3 : 2;

        switch (this._region) {
            case 0:
                this._el.back.classList.add('focused');
                break;
            case 1:
                if (this._type === 'movie' && this._playBtn) {
                    this._playBtn.classList.add('focused');
                } else if (this._continueBtn) {
                    this._continueBtn.classList.add('focused');
                } else if (this._playSeriesBtn) {
                    this._playSeriesBtn.classList.add('focused');
                } else if (this._seasonBtns[this._seasonIdx]) {
                    this._seasonBtns[this._seasonIdx].classList.add('focused');
                }
                break;
            default:
                if (this._region === seasonsRegion && this._seasonBtns[this._seasonIdx]) {
                    this._seasonBtns[this._seasonIdx].classList.add('focused');
                } else if (this._region === episodesRegion && this._episodeEls[this._episodeIdx]) {
                    this._episodeEls[this._episodeIdx].classList.add('focused');
                    this._ensureEpisodeVisible(this._episodeIdx);
                }
                break;
        }
    }

    _ensureEpisodeVisible(idx) {
        const el = this._episodeEls[idx];
        if (!el) return;
        el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }

    /* ═══════════════ KEY HANDLER ═══════════════ */

    _onKey(e) {
        const action = mapRemoteEvent(e);
        if (!action) return;

        switch (action) {
            case RemoteActions.BACK:
                e.preventDefault();
                this._goBack();
                return;

            case RemoteActions.UP:
                e.preventDefault();
                this._navUp();
                return;

            case RemoteActions.DOWN:
                e.preventDefault();
                this._navDown();
                return;

            case RemoteActions.LEFT:
                e.preventDefault();
                this._navLeft();
                return;

            case RemoteActions.RIGHT:
                e.preventDefault();
                this._navRight();
                return;

            case RemoteActions.OK:
                e.preventDefault();
                this._navOk();
                return;
        }
    }
}

/* ═══════════════ UTILS ═══════════════ */

function _escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default MediaDetailsPage;
