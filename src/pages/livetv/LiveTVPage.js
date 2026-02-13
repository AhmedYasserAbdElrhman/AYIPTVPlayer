import TemplateEngine from '../../utils/templateEngine.js';
import { mapRemoteEvent } from '../../input/RemoteKeyMapper.js';
import { RemoteActions } from '../../input/RemoteActions.js';
import LiveService from '../../api/LiveService.js';
import VideoPlayer from '../../components/VideoPlayer/VideoPlayer.js';

/**
 * LiveTV page controller — Smart TV remote optimised.
 *
 * Layout: Sidebar (categories) | Channel list (scrollable)
 * Plus mini player bar when a stream is active.
 *
 * Performance:
 *  - Category & channel lists use chunked rendering (rAF batches)
 *  - Focus uses border-color only (no box-shadow, no scale)
 *  - Only 2 DOM writes per keypress (remove old focus, add new)
 *  - Scroll is instant (no smooth) to avoid WebOS jank
 *  - Data loading is non-blocking with loading states
 *
 * Navigation (2D grid):
 *  Region 0 → Back button (row 0)
 *  Region 1 → Sidebar categories (col 0, multiple rows)
 *  Region 2 → Channel grid (col 1, multiple rows)
 *  Region 3 → Now-playing actions (when visible)
 */

// ─── Constants ──────────────────────────────────────────────
const CHANNEL_RENDER_CHUNK = 30;  // channels per rAF frame
const ALL_CATEGORIES_ID    = '__all__';

class LiveTVPage {
    constructor() {
        this._container    = null;
        this._keyHandler   = this._onKeyDown.bind(this);
        this._clockTimer   = null;
        this._els          = {};

        // Focus state
        this._region       = 1;  // 0=back, 1=sidebar, 2=grid, 3=nowplaying
        this._sidebarIndex = 0;
        this._gridIndex    = 0;
        this._npIndex      = 0;
        this._prevFocused  = null;

        // Data
        this._categories     = [];
        this._allStreams      = [];
        this._filteredStreams = [];
        this._activeCatId    = ALL_CATEGORIES_ID;
        this._playingStreamId = null;

        // Components
        this._player = new VideoPlayer();

        // Rendering state
        this._channelEls     = [];
        this._catEls         = [];
        this._renderRafId    = null;
        this._isDestroyed    = false;
    }

    // ─── Lifecycle ───────────────────────────────────────────

    async mount(container) {
        this._container = container;
        await TemplateEngine.load('pages/livetv/livetv.html', this._container);

        this._container.setAttribute('tabindex', '-1');
        this._container.style.outline = 'none';

        this._cacheDom();
        this._bindEvents();
        this._startClock();
        this._player.mount(this._els.playerContainer);

        // Load data off main thread
        this._loadData();

        // Initial focus on sidebar
        this._setRegionFocus(1, 0);
    }

    destroy() {
        this._isDestroyed = true;
        document.removeEventListener('keydown', this._keyHandler);
        if (this._clockTimer) clearInterval(this._clockTimer);
        if (this._renderRafId) cancelAnimationFrame(this._renderRafId);

        this._player.destroy();

        if (this._container) this._container.innerHTML = '';
        this._channelEls = [];
        this._catEls = [];
        this._els = {};
        this._container = null;
    }

    // ─── DOM Refs ────────────────────────────────────────────

    _cacheDom() {
        this._els = {
            time:           this._container.querySelector('#topbar-time'),
            channelCount:   this._container.querySelector('#channel-count'),
            btnBack:        this._container.querySelector('#btn-back'),
            categoryList:   this._container.querySelector('#category-list'),
            channelGrid:    this._container.querySelector('#channel-grid'),
            gridEmpty:      this._container.querySelector('#grid-empty'),
            nowPlaying:     this._container.querySelector('#now-playing'),
            npName:         this._container.querySelector('#np-name'),
            btnFullscreen:  this._container.querySelector('#btn-fullscreen'),
            btnStop:        this._container.querySelector('#btn-stop'),
            playerContainer: this._container.querySelector('#player-container'),
        };
    }

    // ─── Events ──────────────────────────────────────────────

    _bindEvents() {
        document.addEventListener('keydown', this._keyHandler);

        this._els.btnBack.addEventListener('click', () => this._goBack());
        this._els.btnFullscreen.addEventListener('click', () => this._player.enterFullscreen());
        this._els.btnStop.addEventListener('click', () => this._stopPlayback());

        // Player events
        this._els.playerContainer.addEventListener('player:back', () => {
            if (this._player.isFullscreen()) {
                this._player.enterMini();
                this._installKeyHandler();
            }
        });

        this._els.playerContainer.addEventListener('player:error', () => {
            this._stopPlayback();
        });
    }

    _installKeyHandler() {
        document.addEventListener('keydown', this._keyHandler);
    }

    // ─── Data Loading ────────────────────────────────────────

    async _loadData() {
        try {
            // Load categories and streams concurrently
            const [categories, streams] = await Promise.all([
                LiveService.getCategories(),
                LiveService.getStreams(),
            ]);

            if (this._isDestroyed) return;

            this._categories = categories;
            this._allStreams  = streams;
            this._filteredStreams = streams;

            this._els.channelCount.textContent =
                `${streams.length} channel${streams.length !== 1 ? 's' : ''}`;

            this._renderCategories();
            this._renderChannels();

        } catch (err) {
            if (this._isDestroyed) return;
            console.error('[LiveTV] Failed to load data:', err);
            this._els.gridEmpty.style.display = 'flex';
            this._els.gridEmpty.querySelector('span').textContent = 'Failed to load channels';
        }
    }

    // ─── Render Categories ───────────────────────────────────

    _renderCategories() {
        const list = this._els.categoryList;
        list.innerHTML = '';
        this._catEls = [];

        // "All" category
        const allItem = this._createCatItem({
            category_id: ALL_CATEGORIES_ID,
            category_name: 'All Channels',
            _count: this._allStreams.length,
        });
        allItem.classList.add('cat-item--active');
        list.appendChild(allItem);
        this._catEls.push(allItem);

        // Count channels per category
        const countMap = new Map();
        for (const s of this._allStreams) {
            const cid = s.category_id;
            countMap.set(cid, (countMap.get(cid) || 0) + 1);
        }

        for (const cat of this._categories) {
            const item = this._createCatItem({
                ...cat,
                _count: countMap.get(cat.category_id) || 0,
            });
            list.appendChild(item);
            this._catEls.push(item);
        }
    }

    _createCatItem(cat) {
        const el = document.createElement('button');
        el.className = 'cat-item focusable';
        el.dataset.catId = cat.category_id;

        const name = cat.category_name || 'Unknown';
        const count = cat._count || 0;

        el.innerHTML =
            '<span class="cat-item__name">' + _escapeHtml(name) + '</span>' +
            '<span class="cat-item__count">' + count + '</span>';

        el.addEventListener('click', () => {
            const idx = this._catEls.indexOf(el);
            if (idx >= 0) {
                this._setRegionFocus(1, idx);
                this._selectCategory(cat.category_id);
            }
        });

        return el;
    }

    // ─── Render Channels (chunked) ───────────────────────────

    _renderChannels() {
        const grid = this._els.channelGrid;

        // Clear previous
        grid.innerHTML = '';
        this._channelEls = [];

        const streams = this._filteredStreams;

        if (streams.length === 0) {
            this._els.gridEmpty.style.display = 'flex';
            return;
        }

        this._els.gridEmpty.style.display = 'none';

        // Render in chunks to avoid blocking main thread
        this._renderChannelChunk(streams, 0, grid);
    }

    _renderChannelChunk(streams, offset, grid) {
        if (this._isDestroyed) return;

        const end = Math.min(offset + CHANNEL_RENDER_CHUNK, streams.length);

        const fragment = document.createDocumentFragment();
        for (let i = offset; i < end; i++) {
            const el = this._createChannelCard(streams[i], i);
            fragment.appendChild(el);
            this._channelEls.push(el);
        }
        grid.appendChild(fragment);

        if (end < streams.length) {
            this._renderRafId = requestAnimationFrame(() => {
                this._renderChannelChunk(streams, end, grid);
            });
        }
    }

    _createChannelCard(stream, index) {
        const el = document.createElement('button');
        el.className = 'ch-card focusable';
        el.dataset.streamId = stream.stream_id || '';

        if (this._playingStreamId && String(stream.stream_id) === String(this._playingStreamId)) {
            el.classList.add('ch-card--playing');
        }

        const name = stream.name || 'Unknown Channel';
        const num  = stream.num != null ? stream.num : (index + 1);
        const logo = stream.stream_icon || '';
        const epg  = stream.epg_channel_id ? '' : ''; // EPG loaded separately if needed

        el.innerHTML =
            '<div class="ch-card__logo">' +
                (logo
                    ? '<img src="' + _escapeAttr(logo) + '" alt="" loading="lazy" decoding="async">'
                    : '<div class="ch-card__logo-placeholder">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                            'stroke-width="1.5"><rect x="2" y="7" width="20" height="15" rx="2"/>' +
                            '<polyline points="17 2 12 7 7 2"/></svg>' +
                      '</div>'
                ) +
            '</div>' +
            '<div class="ch-card__body">' +
                '<span class="ch-card__name">' + _escapeHtml(name) + '</span>' +
                '<span class="ch-card__epg">' + _escapeHtml(epg) + '</span>' +
            '</div>' +
            '<span class="ch-card__num">' + num + '</span>';

        el.addEventListener('click', () => {
            const idx = this._channelEls.indexOf(el);
            if (idx >= 0) {
                this._setRegionFocus(2, idx);
                this._playChannel(stream);
            }
        });

        return el;
    }

    // ─── Category Selection ──────────────────────────────────

    _selectCategory(catId) {
        this._activeCatId = catId;

        // Update active styles
        this._catEls.forEach((el) => {
            el.classList.toggle('cat-item--active', el.dataset.catId === String(catId));
        });

        // Filter streams
        if (catId === ALL_CATEGORIES_ID) {
            this._filteredStreams = this._allStreams;
        } else {
            this._filteredStreams = this._allStreams.filter(
                (s) => String(s.category_id) === String(catId)
            );
        }

        this._gridIndex = 0;
        this._renderChannels();
    }

    // ─── Playback ────────────────────────────────────────────

    _playChannel(stream) {
        const url = LiveService.getStreamUrl(stream.stream_id, stream.container_extension || 'm3u8');

        this._playingStreamId = stream.stream_id;
        this._els.npName.textContent = stream.name || 'Unknown';
        this._els.nowPlaying.style.display = '';

        // Mark playing card
        this._channelEls.forEach((el) => {
            el.classList.toggle(
                'ch-card--playing',
                el.dataset.streamId === String(stream.stream_id)
            );
        });

        this._player.load({
            url,
            title: stream.name || 'Live TV',
            subtitle: 'Live',
            mode: 'mini',
        });
    }

    _stopPlayback() {
        this._player.stop();
        this._playingStreamId = null;
        this._els.nowPlaying.style.display = 'none';

        this._channelEls.forEach((el) => {
            el.classList.remove('ch-card--playing');
        });
    }

    // ─── Key Handling ────────────────────────────────────────

    _onKeyDown(e) {
        // If player is fullscreen, let the player handle keys
        if (this._player.isFullscreen()) return;

        const action = mapRemoteEvent(e);

        if (action === RemoteActions.BACK) {
            e.preventDefault();
            e.stopPropagation();
            if (this._player.isActive()) {
                this._stopPlayback();
            } else {
                this._goBack();
            }
            return;
        }

        if (action === RemoteActions.OK) {
            e.preventDefault();
            e.stopPropagation();
            this._handleEnter();
            return;
        }

        if (action === RemoteActions.DOWN) {
            e.preventDefault();
            e.stopPropagation();
            this._moveDown();
            return;
        }

        if (action === RemoteActions.UP) {
            e.preventDefault();
            e.stopPropagation();
            this._moveUp();
            return;
        }

        if (action === RemoteActions.RIGHT) {
            e.preventDefault();
            e.stopPropagation();
            this._moveRight();
            return;
        }

        if (action === RemoteActions.LEFT) {
            e.preventDefault();
            e.stopPropagation();
            this._moveLeft();
            return;
        }
    }

    // ─── Navigation ──────────────────────────────────────────

    _moveDown() {
        if (this._region === 0) {
            // Back → sidebar
            this._setRegionFocus(1, this._sidebarIndex);
        } else if (this._region === 1) {
            const next = this._sidebarIndex + 1;
            if (next < this._catEls.length) {
                this._setRegionFocus(1, next);
            } else if (this._player.isActive()) {
                this._setRegionFocus(3, 0);
            }
        } else if (this._region === 2) {
            const next = this._gridIndex + 1;
            if (next < this._channelEls.length) {
                this._setRegionFocus(2, next);
            } else if (this._player.isActive()) {
                this._setRegionFocus(3, 0);
            }
        }
    }

    _moveUp() {
        if (this._region === 1) {
            const prev = this._sidebarIndex - 1;
            if (prev >= 0) {
                this._setRegionFocus(1, prev);
            } else {
                this._setRegionFocus(0, 0);
            }
        } else if (this._region === 2) {
            const prev = this._gridIndex - 1;
            if (prev >= 0) {
                this._setRegionFocus(2, prev);
            } else {
                this._setRegionFocus(0, 0);
            }
        } else if (this._region === 3) {
            // Now playing → back to last region
            this._setRegionFocus(2, this._gridIndex);
        }
    }

    _moveRight() {
        if (this._region === 0 || this._region === 1) {
            // Sidebar → grid
            if (this._channelEls.length > 0) {
                this._setRegionFocus(2, this._gridIndex);
            }
        } else if (this._region === 3) {
            const next = this._npIndex + 1;
            if (next <= 1) {
                this._setRegionFocus(3, next);
            }
        }
    }

    _moveLeft() {
        if (this._region === 2) {
            // Grid → sidebar
            this._setRegionFocus(1, this._sidebarIndex);
        } else if (this._region === 3) {
            const prev = this._npIndex - 1;
            if (prev >= 0) {
                this._setRegionFocus(3, prev);
            }
        }
    }

    _handleEnter() {
        if (this._region === 0) {
            this._goBack();
        } else if (this._region === 1) {
            const el = this._catEls[this._sidebarIndex];
            if (el) this._selectCategory(el.dataset.catId);
        } else if (this._region === 2) {
            const el = this._channelEls[this._gridIndex];
            if (el) {
                const stream = this._filteredStreams[this._gridIndex];
                if (stream) this._playChannel(stream);
            }
        } else if (this._region === 3) {
            if (this._npIndex === 0) {
                this._player.enterFullscreen();
                document.removeEventListener('keydown', this._keyHandler);
            } else {
                this._stopPlayback();
            }
        }
    }

    // ─── Focus System ────────────────────────────────────────

    _setRegionFocus(region, index) {
        // Remove old focus (single DOM write)
        if (this._prevFocused) {
            this._prevFocused.classList.remove('focused');
        }

        this._region = region;
        let target = null;

        if (region === 0) {
            target = this._els.btnBack;
        } else if (region === 1) {
            this._sidebarIndex = Math.min(index, this._catEls.length - 1);
            target = this._catEls[this._sidebarIndex];
        } else if (region === 2) {
            this._gridIndex = Math.min(index, this._channelEls.length - 1);
            target = this._channelEls[this._gridIndex];
        } else if (region === 3) {
            this._npIndex = index;
            target = index === 0 ? this._els.btnFullscreen : this._els.btnStop;
        }

        if (target) {
            target.classList.add('focused');
            // Instant scroll
            target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            this._prevFocused = target;
        }
    }

    // ─── Clock ───────────────────────────────────────────────

    _startClock() {
        this._updateClock();
        this._clockTimer = setInterval(() => this._updateClock(), 30000);
    }

    _updateClock() {
        const now = new Date();
        this._els.time.textContent = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });
    }

    // ─── Navigation Events ───────────────────────────────────

    _goBack() {
        this._container.dispatchEvent(
            new CustomEvent('page:back', { bubbles: true })
        );
    }
}

// ─── Module-scoped utilities ─────────────────────────────────

function _escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default LiveTVPage;
