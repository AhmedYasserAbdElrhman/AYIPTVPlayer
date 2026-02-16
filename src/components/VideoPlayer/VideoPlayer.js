/**
 * VideoPlayer — reusable, TV-optimised video player component.
 *
 * Features:
 *  - Mini player (picture-in-picture style) and fullscreen modes
 *  - TV remote controls: OK → play/pause, Back → exit, Left/Right → seek
 *  - Overlay auto-hides after 4s of inactivity
 *  - Minimal DOM writes for WebOS performance
 *  - No external dependencies — vanilla HTMLVideoElement
 *
 * Usage:
 *   const player = new VideoPlayer();
 *   player.mount(containerEl);
 *   player.load({ url, title, subtitle, mode: 'mini' | 'fullscreen' });
 *   player.destroy();
 */

import { mapRemoteEvent } from '../../input/RemoteKeyMapper.js';
import { RemoteActions } from '../../input/RemoteActions.js';

// ─── Constants ───────────────────────────────────────────────
const OVERLAY_TIMEOUT = 4000;
const SEEK_STEP = 10;   // seconds
const SEEK_FAST_STEP = 30;   // seconds (long-press style)
const MAX_RETRIES = 5;
const RETRY_DELAY = 2000; // ms between retries

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
        this._currentInfo = null;

        // Retry state
        this._retryCount = 0;
        this._retryTimer = null;

        // Bind event callbacks once to avoid GC churn
        this._onPlay = () => this._syncPlayState(true);
        this._onPause = () => this._syncPlayState(false);
        this._onEnded = () => this._handleEnded();
        this._onError = (e) => this._handleError(e);
        this._onTimeUpdate = () => this._updateProgress();
        this._onLoadedMeta = () => this._onMetadataReady();
    }

    // ─── Lifecycle ───────────────────────────────────────────

    mount(container) {
        if (this._isMounted) return;
        this._container = container;
        this._render();
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
        const video = this._els.video;

        // Hide any previous error
        this._els.errorWrap.style.display = 'none';

        // Set source
        video.src = info.url;
        video.load();

        // Update overlay text
        this._els.title.textContent = info.title || '';
        this._els.subtitle.textContent = info.subtitle || '';

        // Set mode
        if (info.mode === 'fullscreen') {
            this.enterFullscreen();
        } else {
            this.enterMini();
        }

        // Attempt autoplay
        video.play().catch(() => {
            // Autoplay blocked — user must press OK
            this._syncPlayState(false);
        });

        this._showOverlay();
    }

    /**
     * Stop playback and hide the player.
     */
    stop() {
        if (!this._isMounted) return;
        const video = this._els.video;
        video.pause();
        video.removeAttribute('src');
        video.load();
        this._stopProgressLoop();
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

    // ─── Render ──────────────────────────────────────────────

    _render() {
        this._container.innerHTML = `
        <div class="vplayer" style="display:none;">
            <video class="vplayer__video" playsinline></video>

            <div class="vplayer__overlay">
                <div class="vplayer__overlay-top">
                    <span class="vplayer__title"></span>
                    <span class="vplayer__subtitle"></span>
                </div>
                <div class="vplayer__overlay-bottom">
                    <div class="vplayer__progress-track">
                        <div class="vplayer__progress-fill"></div>
                    </div>
                    <div class="vplayer__time-row">
                        <span class="vplayer__time-current">0:00</span>
                        <div class="vplayer__controls-hint">
                            <span class="vplayer__play-icon">▶</span>
                        </div>
                        <span class="vplayer__time-total">0:00</span>
                    </div>
                </div>
            </div>

            <div class="vplayer__error" style="display:none;">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="none"
                     stroke="currentColor" stroke-width="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <span class="vplayer__error-text">Playback error</span>
            </div>
        </div>`;
    }

    _cacheDom() {
        const root = this._container.querySelector('.vplayer');
        this._els = {
            root,
            video: root.querySelector('.vplayer__video'),
            overlay: root.querySelector('.vplayer__overlay'),
            title: root.querySelector('.vplayer__title'),
            subtitle: root.querySelector('.vplayer__subtitle'),
            progressFill: root.querySelector('.vplayer__progress-fill'),
            timeCurrent: root.querySelector('.vplayer__time-current'),
            timeTotal: root.querySelector('.vplayer__time-total'),
            playIcon: root.querySelector('.vplayer__play-icon'),
            errorWrap: root.querySelector('.vplayer__error'),
            errorText: root.querySelector('.vplayer__error-text'),
        };
    }

    // ─── Video Events ────────────────────────────────────────

    _bindVideoEvents() {
        const v = this._els.video;
        v.addEventListener('play', this._onPlay);
        v.addEventListener('pause', this._onPause);
        v.addEventListener('ended', this._onEnded);
        v.addEventListener('error', this._onError);
        v.addEventListener('loadedmetadata', this._onLoadedMeta);
    }

    _unbindVideoEvents() {
        const v = this._els.video;
        if (!v) return;
        v.removeEventListener('play', this._onPlay);
        v.removeEventListener('pause', this._onPause);
        v.removeEventListener('ended', this._onEnded);
        v.removeEventListener('error', this._onError);
        v.removeEventListener('loadedmetadata', this._onLoadedMeta);
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

        if (action === RemoteActions.OK) {
            e.preventDefault();
            e.stopPropagation();
            this._togglePlay();
            this._showOverlay();
            return;
        }

        if (action === RemoteActions.BACK) {
            e.preventDefault();
            e.stopPropagation();
            this._dispatchEvent('player:back');
            return;
        }

        if (action === RemoteActions.RIGHT) {
            e.preventDefault();
            e.stopPropagation();
            this._seek(SEEK_STEP);
            this._showOverlay();
            return;
        }

        if (action === RemoteActions.LEFT) {
            e.preventDefault();
            e.stopPropagation();
            this._seek(-SEEK_STEP);
            this._showOverlay();
            return;
        }

        // Channel up/down → seek faster
        if (action === RemoteActions.CHANNEL_UP) {
            e.preventDefault();
            this._seek(SEEK_FAST_STEP);
            this._showOverlay();
            return;
        }

        if (action === RemoteActions.CHANNEL_DOWN) {
            e.preventDefault();
            this._seek(-SEEK_FAST_STEP);
            this._showOverlay();
            return;
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
        this._els.playIcon.textContent = playing ? '❚❚' : '▶';

        if (playing) {
            this._startProgressLoop();
            this._els.errorWrap.style.display = 'none';
        } else {
            this._stopProgressLoop();
        }
    }

    _handleEnded() {
        this._syncPlayState(false);
        this._showOverlay();
        this._dispatchEvent('player:ended');
    }

    _handleError(e) {
        this._syncPlayState(false);
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
            this._els.errorWrap.style.display = 'flex';

            this._retryTimer = setTimeout(() => {
                if (!this._isMounted || !this._currentInfo) return;
                this._els.errorWrap.style.display = 'none';

                const video = this._els.video;
                video.src = this._currentInfo.url;
                video.load();
                video.play().catch(() => this._syncPlayState(false));
            }, RETRY_DELAY);
            return;
        }

        // Non-recoverable or retries exhausted — show final error
        console.warn(`[VideoPlayer] Playback failed: ${msg} (code ${code})`);
        this._els.errorText.textContent = msg;
        this._els.errorWrap.style.display = 'flex';
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
        this._els.timeCurrent.textContent = this._formatTime(v.currentTime);
    }

    _onMetadataReady() {
        // Successful load — reset retry counter
        this._retryCount = 0;
        clearTimeout(this._retryTimer);
        this._els.errorWrap.style.display = 'none';

        const v = this._els.video;
        if (v.duration && isFinite(v.duration)) {
            this._els.timeTotal.textContent = this._formatTime(v.duration);
        } else {
            // Live stream — no duration
            this._els.timeTotal.textContent = 'LIVE';
            this._els.progressFill.style.width = '100%';
        }
    }

    // ─── Overlay ─────────────────────────────────────────────

    _showOverlay() {
        this._els.overlay.classList.add('vplayer__overlay--visible');
        clearTimeout(this._overlayTimer);

        if (this._isPlaying) {
            this._overlayTimer = setTimeout(() => {
                this._els.overlay.classList.remove('vplayer__overlay--visible');
            }, OVERLAY_TIMEOUT);
        }
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
