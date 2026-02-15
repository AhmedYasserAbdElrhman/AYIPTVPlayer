import TemplateEngine from '../../utils/templateEngine.js';
import { mapRemoteEvent } from '../../input/RemoteKeyMapper.js';
import { RemoteActions } from '../../input/RemoteActions.js';
import LiveService from '../../api/LiveService.js';
import VideoPlayer from '../../components/VideoPlayer/VideoPlayer.js';
import VirtualList from '../../components/VirtualList/VirtualList.js';
import { EVENTS } from '../../config/AppConstants.js';

/**
 * LiveTV Page — LG WebOS TV
 *
 * Layout (fixed px):  [Sidebar 270px] [Channels 530px] [Player 580px + gaps]
 *
 * CRITICAL PERF RULES:
 *  1. Images: NEVER set img.src on creation. data-src + IntersectionObserver only
 *  2. Channels: VirtualList — only visible rows in DOM
 *  3. Fullscreen: CSS class on player-slot (position:fixed) — NO DOM moves
 *  4. Focus: direct className assignment, no transitions
 *  5. Category switch: pre-built Map, O(1) lookup
 *  6. Search: debounced, pre-lowered name cache
 *
 * Navigation regions:
 *  0 = Back button
 *  1 = Category search (highlight only, OK opens keyboard)
 *  2 = Sidebar list
 *  3 = Channel search (highlight only, OK opens keyboard)
 *  4 = Channel list (VirtualList)
 *  5 = Player panel (OK = fullscreen)
 */

const ALL_CAT_ID = '__all__';
const RECENT_CAT_ID = '__recent__';
const RECENT_DAYS = 7;
const SEARCH_DELAY = 200;
const CH_ROW_HEIGHT = 68;   // channel card height + gap
const CH_COLUMNS = 1;    // single column
const CH_BUFFER = 3;    // extra rows above/below viewport

class LiveTVPage {
    static PAGE_ID = 'livetv';

    constructor() {
        this._container = null;
        this._keyHandler = this._onKey.bind(this);
        this._clockTimer = null;
        this._el = {};

        // Focus
        this._region = 2;
        this._catIdx = 0;
        this._chIdx = 0;
        this._prev = null;
        this._inputActive = false;

        // Data
        this._cats = [];
        this._allStreams = [];
        this._catStreams = [];
        this._viewStreams = [];
        this._activeCat = ALL_CAT_ID;
        this._playingId = null;
        this._isFS = false;     // fullscreen state

        // Indexes
        this._byCat = new Map();
        this._recentList = [];
        this._nameLC = new Map();
        this._catNameLC = [];

        // DOM arrays
        this._catEls = [];
        this._visCatEls = [];
        this._chEls = [];    // flat list of channel card elements

        // Search
        this._catQ = '';
        this._chQ = '';
        this._searchTid = null;

        // Components
        this._player = new VideoPlayer();
        this._vlist = null;   // VirtualList instance
        this._imgObs = null;   // IntersectionObserver for lazy images
        this._destroyed = false;
    }

    /* ═══════════════ LIFECYCLE ═══════════════ */

    async mount(container) {
        this._container = container;
        await TemplateEngine.load('pages/livetv/livetv.html', this._container);
        this._container.tabIndex = -1;
        this._container.style.outline = 'none';

        this._cache();
        this._bind();
        this._clockStart();
        this._setupImgObserver();

        // Player mounts inside the panel slot
        this._player.mount(this._el.playerMount);
        this._loadData();
        this._focusTo(2, 0);
    }

    destroy() {
        this._destroyed = true;
        document.removeEventListener('keydown', this._keyHandler);
        clearInterval(this._clockTimer);
        clearTimeout(this._searchTid);
        if (this._vlist) { this._vlist.destroy(); this._vlist = null; }
        if (this._imgObs) { this._imgObs.disconnect(); this._imgObs = null; }
        this._player.destroy();
        if (this._container) this._container.innerHTML = '';
        this._catEls = this._visCatEls = this._chEls = [];
        this._byCat.clear();
        this._nameLC.clear();
        this._el = {};
    }

    /* ═══════════════ DOM CACHE ═══════════════ */

    _cache() {
        const q = s => this._container.querySelector(s);
        this._el = {
            time: q('#topbar-time'),
            count: q('#channel-count'),
            back: q('#btn-back'),
            catList: q('#category-list'),
            chList: q('#channel-list'),
            empty: q('#grid-empty'),
            catSearch: q('#cat-search'),
            chSearch: q('#ch-search'),
            infoPanel: q('#info-panel'),
            infoName: q('#info-ch-name'),
            infoStop: q('#info-btn-stop'),
            infoFs: q('#info-btn-fullscreen'),
            playerMount: q('#player-mount'),
            playerPanel: q('#info-panel'),
        };
    }

    /* ═══════════════ LAZY IMAGE OBSERVER ═══════════════ */

    _setupImgObserver() {
        // Only load images when they scroll into view
        this._imgObs = new IntersectionObserver((entries) => {
            for (let i = 0, n = entries.length; i < n; i++) {
                const e = entries[i];
                if (e.isIntersecting) {
                    const img = e.target;
                    const src = img.dataset.src;
                    if (src) {
                        img.src = src;
                        img.removeAttribute('data-src');
                    }
                    this._imgObs.unobserve(img);
                }
            }
        }, {
            root: this._el.chList,
            rootMargin: '200px 0px',  // start loading 200px before visible
        });
    }

    /* ═══════════════ EVENTS ═══════════════ */

    _bind() {
        document.addEventListener('keydown', this._keyHandler);

        this._el.back.addEventListener('click', () => this._goBack());

        // Player panel click → fullscreen (except stop button)
        this._el.playerPanel.addEventListener('click', (e) => {
            if (e.target.closest('#info-btn-stop') || e.target.closest('#info-btn-fullscreen')) return;
            if (this._player.isActive()) this._goFullscreen();
        });

        this._el.infoStop.addEventListener('click', () => this._stop());
        this._el.infoFs.addEventListener('click', () => this._goFullscreen());

        // Player events — back from fullscreen
        this._el.playerMount.addEventListener('player:back', () => {
            if (this._isFS) {
                this._exitFullscreen();
            } else {
                this._stop();
            }
        });
        this._el.playerMount.addEventListener('player:error', () => this._stop());

        // Search inputs
        this._el.catSearch.addEventListener('input', () => {
            this._catQ = this._el.catSearch.value.toLowerCase().trim();
            this._filterCats();
        });
        this._el.chSearch.addEventListener('input', () => {
            this._chQ = this._el.chSearch.value.toLowerCase().trim();
            this._debouncedFilterCh();
        });
        this._el.catSearch.addEventListener('focus', () => { this._inputActive = true; this._region = 1; });
        this._el.chSearch.addEventListener('focus', () => { this._inputActive = true; this._region = 3; });
        this._el.catSearch.addEventListener('blur', () => { this._inputActive = false; });
        this._el.chSearch.addEventListener('blur', () => { this._inputActive = false; });
    }

    /* ═══════════════ DATA ═══════════════ */

    async _loadData() {
        try {
            const [cats, streams] = await Promise.all([
                LiveService.getCategories(),
                LiveService.getStreams(),
            ]);
            if (this._destroyed) return;

            this._cats = cats;
            this._allStreams = streams;
            this._buildIndex();

            this._catStreams = streams;
            this._viewStreams = streams;
            this._el.count.textContent = streams.length + ' channels';

            this._renderCats();
            this._renderCh();
            this._focusTo(2, 0);
        } catch (e) {
            if (this._destroyed) return;
            console.error('[LiveTV]', e);
            this._el.empty.style.display = 'flex';
            this._el.empty.querySelector('span').textContent = 'Failed to load channels';
        }
    }

    _buildIndex() {
        this._byCat.clear();
        this._nameLC.clear();
        this._recentList = [];

        const cutoff = Date.now() - RECENT_DAYS * 86400000;

        for (let i = 0, n = this._allStreams.length; i < n; i++) {
            const s = this._allStreams[i];

            const cid = String(s.category_id);
            let a = this._byCat.get(cid);
            if (!a) { a = []; this._byCat.set(cid, a); }
            a.push(s);

            this._nameLC.set(s, (s.name || '').toLowerCase());

            const raw = s.added || s.date_added || s.created_at || s.timestamp;
            if (raw != null) {
                let ts = 0;
                if (typeof raw === 'number') {
                    ts = raw < 1e12 ? raw * 1000 : raw;
                } else if (typeof raw === 'string') {
                    const num = Number(raw);
                    if (!isNaN(num) && num > 0) {
                        ts = num < 1e12 ? num * 1000 : num;
                    } else {
                        ts = Date.parse(raw);
                    }
                }
                if (ts > cutoff) this._recentList.push(s);
            }
        }
    }

    /* ═══════════════ RENDER CATEGORIES ═══════════════ */

    _renderCats() {
        const list = this._el.catList;
        list.textContent = '';
        this._catEls = [];
        this._catNameLC = [];

        this._addCat(ALL_CAT_ID, 'All Channels', this._allStreams.length);
        this._addCat(RECENT_CAT_ID, '★ Recently Added', this._recentList.length);

        for (let i = 0, n = this._cats.length; i < n; i++) {
            const c = this._cats[i];
            const arr = this._byCat.get(String(c.category_id));
            this._addCat(c.category_id, c.category_name || 'Unknown', arr ? arr.length : 0);
        }

        if (this._catEls.length) this._catEls[0].className = 'cat-item cat-item--active';
        this._visCatEls = this._catEls.slice();
    }

    _addCat(id, name, count) {
        const el = document.createElement('button');
        el.className = 'cat-item';
        el.dataset.cid = String(id);

        const ns = document.createElement('span');
        ns.className = 'cat-item__name';
        ns.textContent = name;

        const cs = document.createElement('span');
        cs.className = 'cat-item__count';
        cs.textContent = count;

        el.appendChild(ns);
        el.appendChild(cs);

        el.addEventListener('click', () => {
            const idx = this._visCatEls.indexOf(el);
            if (idx >= 0) {
                this._focusTo(2, idx);
                this._pickCat(String(id));
            }
        });

        this._el.catList.appendChild(el);
        this._catEls.push(el);
        this._catNameLC.push(name.toLowerCase());
    }

    /* ═══════════════ RENDER CHANNELS — VirtualList + lazy images ═══════════════ */

    _renderCh() {
        // Destroy previous VirtualList
        if (this._vlist) {
            this._vlist.destroy();
            this._vlist = null;
        }
        this._chEls = [];

        const streams = this._viewStreams;
        if (!streams.length) {
            this._el.empty.style.display = 'flex';
            this._el.count.textContent = '0 channels';
            return;
        }
        this._el.empty.style.display = 'none';
        this._el.count.textContent = streams.length + ' channels';

        // Create VirtualList — only renders visible rows
        this._vlist = new VirtualList({
            container: this._el.chList,
            itemHeight: CH_ROW_HEIGHT,
            columns: CH_COLUMNS,
            items: streams,
            buffer: CH_BUFFER,
            renderItem: (stream, index) => this._createChCard(stream, index),
        });
    }

    _createChCard(stream, index) {
        const el = document.createElement('button');
        const sid = String(stream.stream_id || '');
        const pid = this._playingId ? String(this._playingId) : null;

        el.className = (pid && sid === pid) ? 'ch-card ch-card--playing' : 'ch-card';
        el.dataset.sid = sid;
        el.dataset.idx = index;

        // Logo — NEVER set .src directly, use data-src for lazy loading
        const logo = document.createElement('div');
        logo.className = 'ch-card__logo';
        if (stream.stream_icon) {
            const img = document.createElement('img');
            img.dataset.src = stream.stream_icon;  // NOT img.src!
            img.alt = '';
            img.decoding = 'async';
            img.onerror = function () { this.style.display = 'none'; };
            logo.appendChild(img);
            // Observe for lazy loading
            if (this._imgObs) this._imgObs.observe(img);
        }
        el.appendChild(logo);

        // Name only — no channel number
        const nm = document.createElement('span');
        nm.className = 'ch-card__name';
        nm.textContent = stream.name || 'Unknown Channel';
        el.appendChild(nm);

        el.addEventListener('click', () => {
            this._chIdx = index;
            this._focusTo(4, index);
            if (pid && sid === pid) {
                this._goFullscreen();
            } else {
                this._play(stream);
            }
        });

        // Track in flat array for focus
        this._chEls[index] = el;

        return el;
    }

    /* ═══════════════ CATEGORY SELECTION ═══════════════ */

    _pickCat(catId) {
        if (this._activeCat === catId) return;
        this._activeCat = catId;

        const active = String(catId);
        for (let i = 0, n = this._catEls.length; i < n; i++) {
            this._catEls[i].className =
                this._catEls[i].dataset.cid === active ? 'cat-item cat-item--active' : 'cat-item';
        }
        if (this._region === 2 && this._visCatEls[this._catIdx]) {
            this._visCatEls[this._catIdx].className += ' focused';
        }

        if (catId === ALL_CAT_ID) {
            this._catStreams = this._allStreams;
        } else if (catId === RECENT_CAT_ID) {
            this._catStreams = this._recentList;
        } else {
            this._catStreams = this._byCat.get(catId) || [];
        }

        this._chQ = '';
        if (this._el.chSearch) this._el.chSearch.value = '';
        this._viewStreams = this._catStreams;
        this._chIdx = 0;
        this._renderCh();
    }

    /* ═══════════════ SEARCH ═══════════════ */

    _filterCats() {
        const q = this._catQ;
        this._visCatEls = [];

        for (let i = 0, n = this._catEls.length; i < n; i++) {
            if (!q || this._catNameLC[i].includes(q)) {
                this._catEls[i].style.display = '';
                this._visCatEls.push(this._catEls[i]);
            } else {
                this._catEls[i].style.display = 'none';
            }
        }
        if (this._region === 2) this._catIdx = 0;
    }

    _debouncedFilterCh() {
        clearTimeout(this._searchTid);
        this._searchTid = setTimeout(() => this._filterCh(), SEARCH_DELAY);
    }

    _filterCh() {
        const q = this._chQ;
        if (!q) {
            this._viewStreams = this._catStreams;
        } else {
            const out = [];
            for (let i = 0, n = this._catStreams.length; i < n; i++) {
                const s = this._catStreams[i];
                if (this._nameLC.get(s).includes(q)) out.push(s);
            }
            this._viewStreams = out;
        }
        this._chIdx = 0;
        this._renderCh();
    }

    /* ═══════════════ PLAYBACK ═══════════════ */

    _play(stream) {
        const url = LiveService.getStreamUrl(
            stream.stream_id,
            stream.container_extension || 'm3u8'
        );

        this._playingId = stream.stream_id;
        this._el.infoName.textContent = stream.name || 'Unknown';
        this._el.playerPanel.classList.add('info-panel--active');

        // Mark playing card — only update visible ones
        const sid = String(stream.stream_id);
        for (let i = 0, n = this._chEls.length; i < n; i++) {
            const el = this._chEls[i];
            if (!el) continue;
            el.className = el.dataset.sid === sid ? 'ch-card ch-card--playing' : 'ch-card';
        }
        if (this._region === 4 && this._chEls[this._chIdx]) {
            this._chEls[this._chIdx].className += ' focused';
        }

        this._player.load({
            url,
            title: stream.name || 'Live TV',
            subtitle: 'Live',
            mode: 'mini',
        });
    }

    _stop() {
        this._player.stop();
        this._playingId = null;
        this._el.playerPanel.classList.remove('info-panel--active');
        this._el.infoName.textContent = 'No channel selected';

        for (let i = 0, n = this._chEls.length; i < n; i++) {
            const el = this._chEls[i];
            if (!el) continue;
            if (el.className.includes('playing')) {
                el.className = 'ch-card';
            }
        }
    }

    /**
     * Fullscreen: let VideoPlayer handle it entirely.
     * VideoPlayer has its own fullscreen UI (title, controls, progress).
     * We just tell it to go fullscreen and hand over key control.
     */
    _goFullscreen() {
        if (!this._player.isActive()) return;
        this._isFS = true;
        this._player.enterFullscreen();
        document.removeEventListener('keydown', this._keyHandler);
        // Push a history entry so back exits fullscreen (not the page)
        history.pushState({ page: 'livetv', fullscreen: true }, '', window.location.href);
    }

    _exitFullscreen() {
        this._isFS = false;
        this._player.enterMini();
        document.addEventListener('keydown', this._keyHandler);
    }

    /**
     * Called by main.js when a back-navigation lands on this same page
     * (e.g. popping a fullscreen history entry).
     */
    onHistoryBack() {
        if (this._isFS) {
            this._exitFullscreen();
        }
    }

    /* ═══════════════ KEY HANDLER ═══════════════ */

    _onKey(e) {
        if (this._isFS) return;  // player handles keys in fullscreen

        const action = mapRemoteEvent(e);
        if (!action) return;

        // Keyboard is open — let typing pass
        if (this._inputActive) {
            const isC = this._region === 1;
            if (action === RemoteActions.BACK) {
                e.preventDefault();
                this._closeInput(isC);
                return;
            }
            if (action === RemoteActions.DOWN) {
                e.preventDefault();
                this._closeInput(isC);
                this._focusTo(isC ? 2 : 4, isC ? this._catIdx : this._chIdx);
                return;
            }
            if (action === RemoteActions.UP) {
                e.preventDefault();
                this._closeInput(isC);
                this._focusTo(0, 0);
                return;
            }
            return; // typing
        }

        e.preventDefault();
        e.stopPropagation();

        switch (action) {
            case RemoteActions.BACK:
                this._player.isActive() ? this._stop() : this._goBack();
                break;
            case RemoteActions.OK: this._enter(); break;
            case RemoteActions.UP: this._up(); break;
            case RemoteActions.DOWN: this._down(); break;
            case RemoteActions.LEFT: this._left(); break;
            case RemoteActions.RIGHT: this._right(); break;
        }
    }

    _closeInput(isCat) {
        this._inputActive = false;
        const inp = isCat ? this._el.catSearch : this._el.chSearch;
        inp.blur();
        if (isCat) {
            if (!inp.value.trim()) { this._catQ = ''; this._filterCats(); }
        } else {
            if (!inp.value.trim()) { this._chQ = ''; this._viewStreams = this._catStreams; this._renderCh(); }
        }
    }

    /* ═══════════════ NAVIGATION ═══════════════ */

    _up() {
        switch (this._region) {
            case 0: break;
            case 2:
                if (this._catIdx > 0) this._focusTo(2, this._catIdx - 1);
                else this._focusTo(1, 0);
                break;
            case 4:
                if (this._chIdx > 0) this._focusTo(4, this._chIdx - 1);
                else this._focusTo(3, 0);
                break;
            case 5:
                this._focusTo(4, this._chIdx);
                break;
        }
    }

    _down() {
        switch (this._region) {
            case 0:
                this._focusTo(2, this._catIdx);
                break;
            case 1:
                this._el.catSearch.blur();
                this._focusTo(2, 0);
                break;
            case 2:
                if (this._catIdx < this._visCatEls.length - 1) this._focusTo(2, this._catIdx + 1);
                break;
            case 3:
                this._el.chSearch.blur();
                this._focusTo(4, 0);
                break;
            case 4:
                if (this._chIdx < this._viewStreams.length - 1) this._focusTo(4, this._chIdx + 1);
                else if (this._player.isActive()) this._focusTo(5, 0);
                break;
        }
    }

    _right() {
        switch (this._region) {
            case 0: case 1: case 2:
                if (this._viewStreams.length) this._focusTo(4, this._chIdx);
                else if (this._player.isActive()) this._focusTo(5, 0);
                break;
            case 3: case 4:
                if (this._player.isActive()) this._focusTo(5, 0);
                break;
        }
    }

    _left() {
        switch (this._region) {
            case 3: case 4:
                this._focusTo(2, this._catIdx);
                break;
            case 5:
                if (this._viewStreams.length) this._focusTo(4, this._chIdx);
                else this._focusTo(2, this._catIdx);
                break;
        }
    }

    _enter() {
        switch (this._region) {
            case 0: this._goBack(); break;
            case 1:
                this._el.catSearch.focus();
                this._inputActive = true;
                break;
            case 2: {
                const el = this._visCatEls[this._catIdx];
                if (el) this._pickCat(el.dataset.cid);
                break;
            }
            case 3:
                this._el.chSearch.focus();
                this._inputActive = true;
                break;
            case 4: {
                const s = this._viewStreams[this._chIdx];
                if (!s) break;
                if (this._playingId && String(s.stream_id) === String(this._playingId)) {
                    this._goFullscreen();
                } else {
                    this._play(s);
                }
                break;
            }
            case 5:
                if (this._player.isActive()) this._goFullscreen();
                break;
        }
    }

    /* ═══════════════ FOCUS — 2 DOM writes max ═══════════════ */

    _focusTo(region, index) {
        // Remove old
        if (this._prev) {
            const c = this._prev.className;
            if (c.includes(' focused')) {
                this._prev.className = c.replace(' focused', '');
            }
        }

        this._region = region;
        let target = null;

        switch (region) {
            case 0:
                target = this._el.back;
                break;
            case 1:
                target = this._el.catSearch.parentElement;
                break;
            case 2:
                this._catIdx = Math.max(0, Math.min(index, this._visCatEls.length - 1));
                target = this._visCatEls[this._catIdx];
                break;
            case 3:
                target = this._el.chSearch.parentElement;
                break;
            case 4: {
                this._chIdx = Math.max(0, Math.min(index, this._viewStreams.length - 1));
                // VirtualList: ensure row is visible, then get cell element
                if (this._vlist) {
                    const row = Math.floor(this._chIdx / CH_COLUMNS);
                    const col = this._chIdx % CH_COLUMNS;
                    this._vlist.ensureRowVisible(row);
                    target = this._vlist.getCellElement(row, col);
                    if (target) this._chEls[this._chIdx] = target;
                }
                break;
            }
            case 5:
                target = this._el.playerPanel;
                break;
        }

        if (target) {
            target.className += ' focused';
            // For categories, manual scroll
            if (region === 2) this._scrollTarget(target);
            this._prev = target;
        }
    }

    _scrollTarget(el) {
        const box = this._el.catList;
        if (!box) return;
        const bt = box.getBoundingClientRect();
        const et = el.getBoundingClientRect();
        if (et.top < bt.top + 4) {
            box.scrollTop -= (bt.top - et.top + 12);
        } else if (et.bottom > bt.bottom - 4) {
            box.scrollTop += (et.bottom - bt.bottom + 12);
        }
    }

    /* ═══════════════ CLOCK ═══════════════ */

    _clockStart() {
        this._clockTick();
        this._clockTimer = setInterval(() => this._clockTick(), 30000);
    }

    _clockTick() {
        this._el.time.textContent = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: true,
        });
    }

    _goBack() {
        // Use WebOS back handler — proper history stack
        window.history.back();
    }
}

export default LiveTVPage;
