/**
 * VideoPlayer — reusable, TV-optimised video player component.
 *
 * Features:
 *  - Netflix-style controls overlay with slide-up title and gradient
 *  - Mini player (picture-in-picture style) and fullscreen modes
 *  - TV remote controls: OK → play/pause, Back → exit, Left/Right → seek
 *  - HLS.js adaptive streaming for .m3u8 URLs, native fallback otherwise
 *  - Loading spinner overlay during buffering
 *  - Overlay auto-hides after 4s of inactivity
 *  - Minimal DOM writes for WebOS performance
 *
 * Usage:
 *   const player = new VideoPlayer();
 *   await player.mount(containerEl);
 *   player.load({ url, title, subtitle, mode: 'mini' | 'fullscreen' });
 *   player.destroy();
 */

import Hls from 'hls.js';
import { mapRemoteEvent } from '../../input/RemoteKeyMapper.js';
import { RemoteActions } from '../../input/RemoteActions.js';
import TemplateEngine from '../../utils/templateEngine.js';

// ─── Constants ───────────────────────────────────────────────
const OVERLAY_TIMEOUT = 4000;
const SEEK_STEP = 10;   // seconds
const SEEK_FAST_STEP = 30;   // seconds (long-press style)
const MAX_RETRIES = 5;
const RETRY_DELAY = 2000; // ms between retries
const LOADING_DEBOUNCE = 300; // ms before showing spinner

const HLS_CONFIG = {
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 30,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferSize: 30 * 1000 * 1000,       // 30MB — prevent OOM on 1.5GB TV RAM
    maxBufferHole: 0.5,
    startLevel: -1,                         // auto ABR from start
    abrEwmaDefaultEstimate: 500000,         // conservative 500kbps initial estimate
    testBandwidth: true,
    progressive: false,                     // NEVER use progressive on webOS
    fragLoadingMaxRetry: 4,
    levelLoadingMaxRetry: 4,
    manifestLoadingMaxRetry: 3,
};

class VideoPlayer {
    constructor() {
        this._container = null;
        this._els = {};
        this._keyHandler = this._onKeyDown.bind(this);
        this._overlayTimer = null;
        this._rafId = null;
        this._isPlaying = false;
        this._isFullscreen = false;
        this._isMounted = false;
        this._isLive = false;
        this._currentInfo = null;

        // HLS.js instance
        this._hls = null;

        // Retry state
        this._retryCount = 0;
        this._retryTimer = null;

        // Loading debounce timer
        this._loadingTimer = null;

        // Focus: row 0 = progress bar, row 1 = controls buttons
        this._focusRow = 1;  // default: controls row
        this._focusCol = 1;  // default: play button (middle)

        // Throttle: only update time text once per second
        this._lastTimeSec = -1;

        // Bind event callbacks once to avoid GC churn
        this._onPlay = () => this._syncPlayState(true);
        this._onPause = () => this._syncPlayState(false);
        this._onEnded = () => this._handleEnded();
        this._onError = (e) => this._handleError(e);
        this._onLoadedMeta = () => this._onMetadataReady();
        this._onWaiting = () => {
            this._loadingTimer = setTimeout(() => this._showLoading(true), LOADING_DEBOUNCE);
        };
        this._onCanPlay = () => {
            clearTimeout(this._loadingTimer);
            this._showLoading(false);
        };
    }

    // ─── Lifecycle ───────────────────────────────────────────

    async mount(container) {
        if (this._isMounted) return;
        this._container = container;
        await TemplateEngine.load('components/VideoPlayer/VideoPlayer.html', this._container);
        this._cacheDom();
        this._bindVideoEvents();
        this._isMounted = true;
    }

    destroy() {
        if (!this._isMounted) return;

        this._removeKeyHandler();
        this._unbindVideoEvents();
        this._stopProgressLoop();
        clearTimeout(this._overlayTimer);
        clearTimeout(this._retryTimer);
        clearTimeout(this._loadingTimer);

        this._destroyHls();

        if (this._els.video) {
            this._els.video.pause();
            this._els.video.removeAttribute('src');
            this._els.video.load(); // release resources
        }

        if (this._container) this._container.innerHTML = '';
        this._els = {};
        this._container = null;
        this._isMounted = false;
        this._currentInfo = null;
    }

    // ─── Public API ──────────────────────────────────────────

    /**
     * Load and play a stream.
     * @param {{ url: string, title?: string, subtitle?: string, mode?: 'mini'|'fullscreen' }} info
     */
    load(info) {
        if (!this._isMounted) return;

        this._currentInfo = info;
        this._retryCount = 0;
        clearTimeout(this._retryTimer);

        // Reset previous state
        this._els.errorWrap.classList.remove('vplayer__error--active');
        this._isLive = !!info.live;

        // Apply live mode immediately if caller says it's live
        if (this._isLive) {
            this._els.root.classList.add('vplayer--live');
        } else {
            this._els.root.classList.remove('vplayer--live');
        }

        // Show nav buttons for episodes too
        if (info.episodes) {
            this._els.root.classList.add('vplayer--has-nav');
        } else {
            this._els.root.classList.remove('vplayer--has-nav');
        }

        // Update overlay text
        this._els.title.textContent = info.title || '';
        this._els.subtitle.textContent = info.subtitle || '';

        // Set mode
        if (info.mode === 'fullscreen') {
            this.enterFullscreen();
        } else {
            this.enterMini();
        }

        // Load source (HLS or native)
        this._loadSource(info.url);
        this._showOverlay();
    }

    /**
     * Stop playback and hide the player.
     */
    stop() {
        if (!this._isMounted) return;
        this._destroyHls();
        const video = this._els.video;
        video.pause();
        video.removeAttribute('src');
        video.load();
        this._stopProgressLoop();
        this._showLoading(false);
        this._setVisible(false);
        this._removeKeyHandler();
        this._currentInfo = null;
    }

    enterFullscreen() {
        if (!this._isMounted) return;
        this._isFullscreen = true;
        this._els.root.classList.add('vplayer--fullscreen');
        this._els.root.classList.remove('vplayer--mini');
        this._setVisible(true);
        this._installKeyHandler();
        this._showOverlay();
        this._dispatchEvent('player:fullscreen');
    }

    enterMini() {
        if (!this._isMounted) return;
        this._isFullscreen = false;
        this._els.root.classList.add('vplayer--mini');
        this._els.root.classList.remove('vplayer--fullscreen');
        this._setVisible(true);
        this._removeKeyHandler(); // parent page handles keys in mini mode
        this._dispatchEvent('player:mini');
    }

    isActive() {
        return this._isMounted && this._currentInfo !== null;
    }

    isFullscreen() {
        return this._isFullscreen;
    }

    getCurrentTime() {
        return this._els.video?.currentTime || 0;
    }

    getDuration() {
        return this._els.video?.duration || 0;
    }

    _cacheDom() {
        const root = this._container.querySelector('.vplayer');
        this._els = {
            root,
            video: root.querySelector('.vplayer__video'),
            overlay: root.querySelector('.vplayer__overlay'),
            info: root.querySelector('.vplayer__info'),
            title: root.querySelector('.vplayer__title'),
            subtitle: root.querySelector('.vplayer__subtitle'),
            progressTrack: root.querySelector('.vplayer__progress-track'),
            progressFill: root.querySelector('.vplayer__progress-fill'),
            timeCurrent: root.querySelector('.vplayer__time-current'),
            timeTotal: root.querySelector('.vplayer__time-total'),
            playBtn: root.querySelector('.vplayer__play-btn'),
            prevBtn: root.querySelector('.vplayer__prev-btn'),
            nextBtn: root.querySelector('.vplayer__next-btn'),
            loading: root.querySelector('.vplayer__loading'),
            errorWrap: root.querySelector('.vplayer__error'),
            errorText: root.querySelector('.vplayer__error-text'),
        };
        // Set initial play icon text
        const icon = this._els.playBtn?.querySelector('.vplayer__play-icon');
        if (icon) icon.textContent = '▶';
    }

    // ─── Video Events ────────────────────────────────────────

    _bindVideoEvents() {
        const v = this._els.video;
        v.addEventListener('play', this._onPlay);
        v.addEventListener('pause', this._onPause);
        v.addEventListener('ended', this._onEnded);
        v.addEventListener('error', this._onError);
        v.addEventListener('loadedmetadata', this._onLoadedMeta);
        v.addEventListener('waiting', this._onWaiting);
        v.addEventListener('canplay', this._onCanPlay);

        // Channel nav buttons
        this._els.prevBtn?.addEventListener('click', () => this._dispatchEvent('player:channel-up'));
        this._els.nextBtn?.addEventListener('click', () => this._dispatchEvent('player:channel-down'));
    }

    _unbindVideoEvents() {
        const v = this._els.video;
        if (!v) return;
        v.removeEventListener('play', this._onPlay);
        v.removeEventListener('pause', this._onPause);
        v.removeEventListener('ended', this._onEnded);
        v.removeEventListener('error', this._onError);
        v.removeEventListener('loadedmetadata', this._onLoadedMeta);
        v.removeEventListener('waiting', this._onWaiting);
        v.removeEventListener('canplay', this._onCanPlay);
    }

    // ─── HLS.js ──────────────────────────────────────────────

    _loadSource(url) {
        const video = this._els.video;
        this._destroyHls();
        this._showLoading(true);

        const isHls = url.includes('.m3u8');

        if (isHls && Hls.isSupported()) {
            const hls = new Hls(HLS_CONFIG);
            this._hls = hls;

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                this._showLoading(false);
                video.play().catch(() => this._syncPlayState(false));
            });

            // Auto-detect live stream from HLS manifest
            hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
                if (data.details && data.details.live && !this._isLive) {
                    this._isLive = true;
                    this._els.root.classList.add('vplayer--live');
                    console.log('[VideoPlayer] HLS detected LIVE stream from manifest');
                }
            });

            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (!data.fatal) return;

                console.warn('[VideoPlayer] HLS fatal error:', data.type, data);

                // Parsing errors (e.g. ISP redirect returning HTML) are NOT recoverable
                const isParsingError = data.details && data.details.toLowerCase().includes('parsing');

                if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !isParsingError && this._retryCount < MAX_RETRIES) {
                    this._retryCount++;
                    console.log(`[VideoPlayer] HLS network retry ${this._retryCount}/${MAX_RETRIES}`);
                    hls.startLoad();
                    return;
                }

                if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this._retryCount < MAX_RETRIES) {
                    this._retryCount++;
                    console.log(`[VideoPlayer] HLS media recovery ${this._retryCount}/${MAX_RETRIES}`);
                    hls.recoverMediaError();
                    return;
                }

                // Unrecoverable
                this._showLoading(false);
                this._handleHlsError(data);
            });

            hls.loadSource(url);
            hls.attachMedia(video);

        } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS (Safari / some WebOS builds)
            video.src = url;
            video.load();
            video.play().catch(() => this._syncPlayState(false));

        } else {
            // Plain MP4 or other native format
            video.src = url;
            video.load();
            video.play().catch(() => this._syncPlayState(false));
        }
    }

    _destroyHls() {
        if (this._hls) {
            this._hls.destroy();
            this._hls = null;
        }
    }

    _handleHlsError(data) {
        // Destroy HLS immediately to stop the event flood
        this._destroyHls();
        this._syncPlayState(false);
        this._showLoading(false);

        const msg = `Stream error (${data.type})`;
        console.warn(`[VideoPlayer] HLS unrecoverable: ${msg}`);

        this._els.errorText.textContent = msg;
        this._els.errorWrap.classList.add('vplayer__error--active');
        this._dispatchEvent('player:error', { message: msg });
    }

    // ─── Key Handling (fullscreen only) ──────────────────────

    _installKeyHandler() {
        document.addEventListener('keydown', this._keyHandler);
    }

    _removeKeyHandler() {
        document.removeEventListener('keydown', this._keyHandler);
    }

    _onKeyDown(e) {
        const action = mapRemoteEvent(e);
        if (!action) return;

        e.preventDefault();
        e.stopPropagation();

        if (action === RemoteActions.BACK) {
            this._dispatchEvent('player:back');
            return;
        }

        // Show overlay on any key if hidden
        const overlayVisible = this._els.overlay.classList.contains('vplayer__overlay--visible');
        if (!overlayVisible) {
            this._showOverlay();
            this._focusRow = 1; // reset to controls row
            this._focusCol = this._hasNavButtons() ? 1 : 0; // play button
            this._updateFocus();
            return;
        }

        // ── OK: activate focused item ──
        if (action === RemoteActions.OK) {
            this._activateFocused();
            this._showOverlay();
            return;
        }

        // ── LEFT / RIGHT ──
        if (action === RemoteActions.LEFT) {
            if (this._focusRow === 0) {
                // On progress bar → seek backward
                this._seek(-SEEK_STEP);
            } else {
                // On controls row → navigate between buttons
                this._moveFocusCol(-1);
            }
            this._showOverlay();
            return;
        }

        if (action === RemoteActions.RIGHT) {
            if (this._focusRow === 0) {
                // On progress bar → seek forward
                this._seek(SEEK_STEP);
            } else {
                // On controls row → navigate between buttons
                this._moveFocusCol(1);
            }
            this._showOverlay();
            return;
        }

        // ── UP / DOWN: navigate between progress bar and controls row ──
        if (action === RemoteActions.UP) {
            if (this._isLive) {
                this._dispatchEvent('player:channel-up');
            } else if (this._focusRow === 1) {
                // Move up to progress bar
                this._focusRow = 0;
                this._updateFocus();
            }
            this._showOverlay();
            return;
        }

        if (action === RemoteActions.DOWN) {
            if (this._isLive) {
                this._dispatchEvent('player:channel-down');
            } else if (this._focusRow === 0) {
                // Move down to controls row
                this._focusRow = 1;
                this._updateFocus();
            }
            this._showOverlay();
            return;
        }

        // ── CHANNEL UP/DOWN: channel switch (live) or fast seek (VOD) ──
        if (action === RemoteActions.CHANNEL_UP) {
            if (this._isLive) {
                this._dispatchEvent('player:channel-up');
            } else {
                this._seek(SEEK_FAST_STEP);
            }
            this._showOverlay();
            return;
        }

        if (action === RemoteActions.CHANNEL_DOWN) {
            if (this._isLive) {
                this._dispatchEvent('player:channel-down');
            } else {
                this._seek(-SEEK_FAST_STEP);
            }
            this._showOverlay();
            return;
        }
    }

    // ─── Focus Management ─────────────────────────────────────

    _hasNavButtons() {
        return this._els.root.classList.contains('vplayer--live') ||
            this._els.root.classList.contains('vplayer--has-nav');
    }

    _getControlButtons() {
        if (this._hasNavButtons()) {
            return [this._els.prevBtn, this._els.playBtn, this._els.nextBtn];
        }
        return [this._els.playBtn];
    }

    _moveFocusCol(dir) {
        const btns = this._getControlButtons();
        this._focusCol = Math.max(0, Math.min(btns.length - 1, this._focusCol + dir));
        this._updateFocus();
    }

    _updateFocus() {
        const btns = this._getControlButtons();
        // Blur all control buttons
        btns.forEach(btn => btn?.blur());
        // Blur progress track
        this._els.progressTrack?.blur();

        if (this._focusRow === 0 && !this._isLive) {
            // Focus progress bar
            this._els.progressTrack?.focus();
        } else {
            // Focus the active control button
            const btn = btns[this._focusCol];
            btn?.focus();
        }
    }

    _activateFocused() {
        if (this._focusRow === 0) {
            this._togglePlay();
            return;
        }
        const btns = this._getControlButtons();
        const btn = btns[this._focusCol];
        if (btn === this._els.playBtn) {
            this._togglePlay();
        } else if (btn === this._els.prevBtn) {
            this._dispatchEvent('player:channel-up');
        } else if (btn === this._els.nextBtn) {
            this._dispatchEvent('player:channel-down');
        }
    }

    // ─── Playback Controls ───────────────────────────────────

    _togglePlay() {
        const v = this._els.video;
        if (v.paused) {
            v.play().catch(() => { });
        } else {
            v.pause();
        }
    }

    _seek(seconds) {
        const v = this._els.video;
        if (!v.duration || !isFinite(v.duration)) return;
        v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + seconds));
    }

    _syncPlayState(playing) {
        this._isPlaying = playing;

        // Toggle CSS class + icon text
        this._els.playBtn?.classList.toggle('vplayer__play-btn--paused', playing);
        const icon = this._els.playBtn?.querySelector('.vplayer__play-icon');
        if (icon) icon.textContent = playing ? '❚❚' : '▶';

        if (playing) {
            // Progress rAF loop only runs when overlay is visible
            const overlayVisible = this._els.overlay.classList.contains('vplayer__overlay--visible');
            if (overlayVisible) this._startProgressLoop();
            this._els.errorWrap.classList.remove('vplayer__error--active');
            this._showLoading(false);
        } else {
            this._stopProgressLoop();
        }
    }

    _handleEnded() {
        this._syncPlayState(false);
        this._showOverlay();
        this._dispatchEvent('player:ended');
    }

    _handleError() {
        this._syncPlayState(false);
        this._showLoading(false);

        const code = this._els.video?.error?.code;
        let msg = 'Playback error';
        if (code === 2) msg = 'Network error';
        if (code === 3) msg = 'Decode error';
        if (code === 4) msg = 'Source not supported';

        // Only retry on recoverable errors (network = code 2, unknown = code 1)
        const isRecoverable = !code || code <= 2;

        if (isRecoverable && this._retryCount < MAX_RETRIES && this._currentInfo) {
            this._retryCount++;
            console.log(`[VideoPlayer] Retry ${this._retryCount}/${MAX_RETRIES} — ${msg}`);

            this._els.errorText.textContent = `${msg} — Retrying (${this._retryCount}/${MAX_RETRIES})…`;
            this._els.errorWrap.classList.add('vplayer__error--active');

            this._retryTimer = setTimeout(() => {
                if (!this._isMounted || !this._currentInfo) return;
                this._els.errorWrap.classList.remove('vplayer__error--active');
                this._loadSource(this._currentInfo.url);
            }, RETRY_DELAY);
            return;
        }

        // Non-recoverable or retries exhausted — show final error
        console.warn(`[VideoPlayer] Playback failed: ${msg} (code ${code})`);
        console.log(`[VideoPlayer] URL: ${this._currentInfo.url}`);
        this._els.errorText.textContent = msg;
        this._els.errorWrap.classList.add('vplayer__error--active');
        this._dispatchEvent('player:error', { code, message: msg });
    }

    // ─── Progress Loop (rAF for smooth bar, minimal DOM) ────

    _startProgressLoop() {
        this._stopProgressLoop();
        const tick = () => {
            this._updateProgress();
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    }

    _stopProgressLoop() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    _updateProgress() {
        const v = this._els.video;
        if (!v.duration || !isFinite(v.duration)) return;

        const pct = (v.currentTime / v.duration) * 100;
        this._els.progressFill.style.width = pct + '%';

        // Throttle text updates to once/sec — no visual difference, saves allocations
        const sec = Math.floor(v.currentTime);
        if (sec !== this._lastTimeSec) {
            this._lastTimeSec = sec;
            this._els.timeCurrent.textContent = this._formatTime(v.currentTime);
        }
    }

    _onMetadataReady() {
        // Successful load — reset retry counter
        this._retryCount = 0;
        clearTimeout(this._retryTimer);
        this._els.errorWrap.classList.remove('vplayer__error--active');
        this._showLoading(false);

        const v = this._els.video;
        if (!this._isLive && v.duration && isFinite(v.duration)) {
            this._els.root.classList.remove('vplayer--live');
            this._els.timeTotal.textContent = this._formatTime(v.duration);
        } else {
            // Live stream — hide progress/time, show LIVE badge
            this._isLive = true;
            this._els.root.classList.add('vplayer--live');
        }
    }

    // ─── Overlay ─────────────────────────────────────────────

    _showOverlay() {
        this._els.overlay.classList.add('vplayer__overlay--visible');
        if (this._isPlaying) this._startProgressLoop();
        clearTimeout(this._overlayTimer);

        if (this._isPlaying) {
            this._overlayTimer = setTimeout(() => {
                this._els.overlay.classList.remove('vplayer__overlay--visible');
                this._stopProgressLoop();
            }, OVERLAY_TIMEOUT);
        }
    }

    // ─── Loading ─────────────────────────────────────────────

    _showLoading(show) {
        if (!this._els.loading) return;
        this._els.loading.classList.toggle('vplayer__loading--active', show);
        if (!show) clearTimeout(this._loadingTimer);
    }

    // ─── Helpers ─────────────────────────────────────────────

    _setVisible(visible) {
        this._els.root.style.display = visible ? '' : 'none';
    }

    _formatTime(sec) {
        const s = Math.floor(sec);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        }
        return `${m}:${String(ss).padStart(2, '0')}`;
    }

    _dispatchEvent(name, detail = {}) {
        if (!this._container) return;
        this._container.dispatchEvent(
            new CustomEvent(name, { detail, bubbles: true })
        );
    }
}

export default VideoPlayer;
