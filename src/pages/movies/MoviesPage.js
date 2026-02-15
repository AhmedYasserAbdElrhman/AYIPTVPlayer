import TemplateEngine from '../../utils/templateEngine.js';
import { mapRemoteEvent } from '../../input/RemoteKeyMapper.js';
import { RemoteActions } from '../../input/RemoteActions.js';
import VodService from '../../api/VodService.js';
import MediaCard from '../../components/MediaCard/MediaCard.js';
import VirtualList from '../../components/VirtualList/VirtualList.js';
import { EVENTS } from '../../config/AppConstants.js';

/**
 * Movies Page — LG WebOS optimised
 *
 * Layout: Sidebar (270px) | Grid (VirtualList, 6 columns)
 *
 * PERFORMANCE (same patterns as LiveTV):
 *  1. VirtualList — only visible grid rows in DOM
 *  2. Lazy images — IntersectionObserver, data-src (NOT img.src)
 *  3. Pre-built Map — category switch is O(1), no .filter()
 *  4. Direct className — no classList.toggle in loops
 *  5. Manual scrollTop — no scrollIntoView reflows
 *  6. textContent = '' — no innerHTML clearing
 *  7. Indexed for-loops — no for-of on hot paths
 *  8. Search — debounced, pre-lowered name cache
 *
 * Navigation regions:
 *  0 = Back button
 *  1 = Search input (highlight, OK opens keyboard)
 *  2 = Sidebar categories
 *  3 = Content grid (2D: row/col via VirtualList)
 *  4 = Detail modal actions
 */

const GRID_COLUMNS = 6;
const GRID_ROW_HEIGHT = 380;  // card height + gap
const GRID_BUFFER = 2;
const ALL_CATEGORIES_ID = '__all__';
const SEARCH_DELAY = 200;

class MoviesPage {
    constructor() {
        this._container = null;
        this._keyHandler = this._onKey.bind(this);
        this._clockTimer = null;
        this._els = {};

        // Focus
        this._region = 2;   // 0=back, 1=search, 2=sidebar, 3=grid, 4=detail
        this._sidebarIdx = 0;
        this._gridRow = 0;
        this._gridCol = 0;
        this._detailIdx = 0;
        this._prev = null;
        this._inputActive = false;

        // Data
        this._categories = [];
        this._allItems = [];
        this._catItems = [];   // current category items
        this._viewItems = [];   // after search filter
        this._activeCatId = ALL_CATEGORIES_ID;

        // Indexes (pre-built for O(1) lookups)
        this._byCat = new Map();
        this._nameLC = new Map();
        this._catNameLC = [];

        // DOM arrays
        this._catEls = [];
        this._visCatEls = [];

        // Rendering
        this._vlist = null;
        this._imgObs = null;
        this._isDestroyed = false;

        // Search
        this._searchQ = '';
        this._searchTid = null;

        // Detail
        this._detailOpen = false;
        this._detailItem = null;
        this._detailEl = null;
        this._detailBtns = [];
    }

    /* ═══════════════ LIFECYCLE ═══════════════ */

    async mount(container) {
        this._container = container;
        await TemplateEngine.load('pages/movies/movies.html', this._container);
        this._container.tabIndex = -1;
        this._container.style.outline = 'none';

        this._cacheDom();
        this._bindEvents();
        this._startClock();
        this._setupImgObserver();

        this._showLoading(true);
        this._loadData();
        this._setFocus(2, 0);
    }

    destroy() {
        this._isDestroyed = true;
        document.removeEventListener('keydown', this._keyHandler);
        if (this._clockTimer) clearInterval(this._clockTimer);
        clearTimeout(this._searchTid);
        if (this._vlist) { this._vlist.destroy(); this._vlist = null; }
        if (this._imgObs) { this._imgObs.disconnect(); this._imgObs = null; }
        this._closeDetail();
        if (this._container) this._container.innerHTML = '';
        this._catEls = this._visCatEls = [];
        this._byCat.clear();
        this._nameLC.clear();
        this._els = {};
        this._container = null;
    }

    /* ═══════════════ DOM CACHE ═══════════════ */

    _cacheDom() {
        const q = s => this._container.querySelector(s);
        this._els = {
            time: q('#topbar-time'),
            itemCount: q('#item-count'),
            btnBack: q('#btn-back'),
            search: q('#grid-search'),
            categoryList: q('#category-list'),
            contentGrid: q('#content-grid'),
            gridEmpty: q('#grid-empty'),
            gridLoading: q('#grid-loading'),
        };
    }

    /* ═══════════════ LAZY IMAGE OBSERVER ═══════════════ */

    _setupImgObserver() {
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
            root: this._els.contentGrid,
            rootMargin: '300px 0px',
        });
    }

    /* ═══════════════ EVENTS ═══════════════ */

    _bindEvents() {
        document.addEventListener('keydown', this._keyHandler);
        this._els.btnBack.addEventListener('click', () => this._goBack());

        // Search input
        if (this._els.search) {
            this._els.search.addEventListener('input', () => {
                this._searchQ = this._els.search.value.toLowerCase().trim();
                this._debouncedFilter();
            });
            this._els.search.addEventListener('focus', () => { this._inputActive = true; this._region = 1; });
            this._els.search.addEventListener('blur', () => { this._inputActive = false; });
        }
    }

    /* ═══════════════ DATA ═══════════════ */

    async _loadData() {
        try {
            const [categories, items] = await Promise.all([
                VodService.getCategories(),
                VodService.getStreams(),
            ]);
            if (this._isDestroyed) return;

            this._categories = categories;
            this._allItems = items;
            this._buildIndex();

            this._catItems = items;
            this._viewItems = items;
            this._updateCount();
            this._renderCategories();
            this._renderGrid();
            this._showLoading(false);
        } catch (err) {
            if (this._isDestroyed) return;
            console.error('[Movies] Load failed:', err);
            this._showLoading(false);
            this._els.gridEmpty.style.display = 'flex';
            this._els.gridEmpty.querySelector('span').textContent = 'Failed to load movies';
        }
    }

    /** Pre-build category Map + name cache — O(1) category switch, zero-alloc search */
    _buildIndex() {
        this._byCat.clear();
        this._nameLC.clear();

        for (let i = 0, n = this._allItems.length; i < n; i++) {
            const item = this._allItems[i];
            const cid = String(item.category_id);
            let arr = this._byCat.get(cid);
            if (!arr) { arr = []; this._byCat.set(cid, arr); }
            arr.push(item);
            this._nameLC.set(item, (item.name || '').toLowerCase());
        }
    }

    /* ═══════════════ RENDER CATEGORIES ═══════════════ */

    _renderCategories() {
        const list = this._els.categoryList;
        list.textContent = '';   // NOT innerHTML
        this._catEls = [];
        this._catNameLC = [];

        // "All" category
        this._addCat(ALL_CATEGORIES_ID, 'All Movies', this._allItems.length);

        // Per-category counts from pre-built index
        for (let i = 0, n = this._categories.length; i < n; i++) {
            const c = this._categories[i];
            const arr = this._byCat.get(String(c.category_id));
            this._addCat(c.category_id, c.category_name || 'Unknown', arr ? arr.length : 0);
        }

        if (this._catEls.length) this._catEls[0].className = 'cat-item cat-item--active';
        this._visCatEls = this._catEls.slice();
    }

    _addCat(id, name, count) {
        const el = document.createElement('button');
        el.className = 'cat-item';
        el.dataset.catId = String(id);

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
            if (idx >= 0) { this._setFocus(2, idx); this._selectCategory(String(id)); }
        });

        this._els.categoryList.appendChild(el);
        this._catEls.push(el);
        this._catNameLC.push(name.toLowerCase());
    }

    /* ═══════════════ RENDER GRID — VirtualList ═══════════════ */

    _renderGrid() {
        if (this._vlist) { this._vlist.destroy(); this._vlist = null; }

        const items = this._viewItems;
        if (!items.length) {
            this._els.gridEmpty.style.display = 'flex';
            this._updateCount();
            return;
        }
        this._els.gridEmpty.style.display = 'none';
        this._updateCount();

        this._vlist = new VirtualList({
            container: this._els.contentGrid,
            itemHeight: GRID_ROW_HEIGHT,
            columns: GRID_COLUMNS,
            items: items,
            buffer: GRID_BUFFER,
            renderItem: (item, index) => this._createCard(item, index),
        });
    }

    _createCard(item, index) {
        const card = MediaCard.create(item, 'movie');
        const el = card.el;

        // Lazy-load poster image: find img, swap src → data-src
        const img = el.querySelector('img');
        if (img && img.src) {
            img.dataset.src = img.src;
            img.removeAttribute('src');
            img.decoding = 'async';
            img.onerror = function () { this.style.display = 'none'; };
            if (this._imgObs) this._imgObs.observe(img);
        }

        el.addEventListener('click', () => {
            this._gridRow = Math.floor(index / GRID_COLUMNS);
            this._gridCol = index % GRID_COLUMNS;
            this._setFocus(3);
            this._openDetail(item);
        });

        return el;
    }

    /* ═══════════════ CATEGORY SELECTION — O(1) via Map ═══════════════ */

    _selectCategory(catId) {
        if (this._activeCatId === catId) return;
        this._activeCatId = catId;

        // Direct className — no classList.toggle
        const active = String(catId);
        for (let i = 0, n = this._catEls.length; i < n; i++) {
            this._catEls[i].className =
                this._catEls[i].dataset.catId === active ? 'cat-item cat-item--active' : 'cat-item';
        }
        if (this._region === 2 && this._visCatEls[this._sidebarIdx]) {
            this._visCatEls[this._sidebarIdx].className += ' focused';
        }

        // O(1) lookup from pre-built Map
        if (catId === ALL_CATEGORIES_ID) {
            this._catItems = this._allItems;
        } else {
            this._catItems = this._byCat.get(catId) || [];
        }

        this._searchQ = '';
        if (this._els.search) this._els.search.value = '';
        this._viewItems = this._catItems;
        this._gridRow = 0;
        this._gridCol = 0;
        this._renderGrid();
    }

    /* ═══════════════ SEARCH ═══════════════ */

    _debouncedFilter() {
        clearTimeout(this._searchTid);
        this._searchTid = setTimeout(() => this._filterItems(), SEARCH_DELAY);
    }

    _filterItems() {
        const q = this._searchQ;
        if (!q) {
            this._viewItems = this._catItems;
        } else {
            const out = [];
            for (let i = 0, n = this._catItems.length; i < n; i++) {
                if (this._nameLC.get(this._catItems[i]).includes(q)) out.push(this._catItems[i]);
            }
            this._viewItems = out;
        }
        this._gridRow = 0;
        this._gridCol = 0;
        this._renderGrid();
    }

    /* ═══════════════ DETAIL MODAL ═══════════════ */

    async _openDetail(item) {
        if (this._detailOpen) this._closeDetail();

        this._detailOpen = true;
        this._detailItem = item;
        this._detailIdx = 0;

        let info = item;
        try {
            const full = await VodService.getInfo(item.stream_id || item.id);
            if (full && full.info) info = { ...item, ...full.info, movie_data: full.movie_data };
        } catch { /* use basic */ }

        if (this._isDestroyed || !this._detailOpen) return;

        const overlay = document.createElement('div');
        overlay.className = 'media-detail';

        const cover = info.cover || info.stream_icon || item.cover || item.stream_icon || '';
        const name = info.name || item.name || 'Untitled';
        const year = info.year || info.releasedate || '';
        const rating = info.rating || '';
        const genre = info.genre || '';
        const plot = info.plot || info.description || '';
        const duration = info.duration || '';

        overlay.innerHTML =
            '<div class="media-detail__card">' +
            '<div class="media-detail__poster">' +
            (cover ? '<img src="' + _escapeAttr(cover) + '" alt="">' : '') +
            '</div>' +
            '<div class="media-detail__info">' +
            '<h2 class="media-detail__title">' + _escapeHtml(name) + '</h2>' +
            '<div class="media-detail__meta">' +
            (year ? '<span>' + _escapeHtml(String(year)) + '</span>' : '') +
            (duration ? '<span>' + _escapeHtml(duration) + '</span>' : '') +
            (genre ? '<span>' + _escapeHtml(genre) + '</span>' : '') +
            (rating ? '<span class="media-detail__rating">★ ' + _escapeHtml(String(rating)) + '</span>' : '') +
            '</div>' +
            (plot ? '<p class="media-detail__plot">' + _escapeHtml(plot) + '</p>' : '') +
            '<div class="media-detail__actions">' +
            '<button class="media-detail__btn" id="detail-play">' +
            '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>' +
            'Play' +
            '</button>' +
            '<button class="media-detail__btn media-detail__btn--secondary" id="detail-close">Close</button>' +
            '</div>' +
            '</div>' +
            '</div>';

        this._container.appendChild(overlay);
        this._detailEl = overlay;
        this._detailBtns = [
            overlay.querySelector('#detail-play'),
            overlay.querySelector('#detail-close'),
        ];
        this._detailBtns[0].addEventListener('click', () => this._playItem(item));
        this._detailBtns[1].addEventListener('click', () => this._closeDetail());

        this._region = 4;
        this._detailIdx = 0;
        this._setDetailFocus(0);
    }

    _closeDetail() {
        if (this._detailEl) { this._detailEl.remove(); this._detailEl = null; }
        this._detailOpen = false;
        this._detailItem = null;
        this._detailBtns = [];
        this._region = 3;
        this._setFocus(3);
    }

    _setDetailFocus(index) {
        if (this._prev) {
            const c = this._prev.className;
            if (c.includes(' focused')) this._prev.className = c.replace(' focused', '');
        }
        this._detailIdx = index;
        const target = this._detailBtns[index];
        if (target) {
            target.className += ' focused';
            this._prev = target;
        }
    }

    /* ═══════════════ PLAYBACK ═══════════════ */

    _playItem(item) {
        this._closeDetail();
        const ext = item.container_extension || 'mp4';
        const url = VodService.getStreamUrl(item.stream_id || item.id, ext);
        this._container.dispatchEvent(
            new CustomEvent(EVENTS.PLAY_REQUEST, {
                detail: {
                    url,
                    title: item.name || 'Movie',
                    subtitle: item.year ? String(item.year) : '',
                },
                bubbles: true,
            })
        );
    }

    /* ═══════════════ KEY HANDLER ═══════════════ */

    _onKey(e) {
        const action = mapRemoteEvent(e);
        if (!action) return;

        // Keyboard open
        if (this._inputActive) {
            if (action === RemoteActions.BACK) {
                e.preventDefault();
                this._closeInput();
                return;
            }
            if (action === RemoteActions.DOWN) {
                e.preventDefault();
                this._closeInput();
                this._setFocus(2, this._sidebarIdx);
                return;
            }
            return; // let typing pass
        }

        e.preventDefault();
        e.stopPropagation();

        switch (action) {
            case RemoteActions.BACK:
                if (this._detailOpen) this._closeDetail();
                else this._goBack();
                break;
            case RemoteActions.OK: this._enter(); break;
            case RemoteActions.UP: this._up(); break;
            case RemoteActions.DOWN: this._down(); break;
            case RemoteActions.LEFT: this._left(); break;
            case RemoteActions.RIGHT: this._right(); break;
        }
    }

    _closeInput() {
        this._inputActive = false;
        if (this._els.search) this._els.search.blur();
        if (!this._searchQ) { this._viewItems = this._catItems; this._renderGrid(); }
    }

    /* ═══════════════ NAVIGATION ═══════════════ */

    _up() {
        if (this._region === 4) return;
        if (this._region === 2) {
            if (this._sidebarIdx > 0) this._setFocus(2, this._sidebarIdx - 1);
            else if (this._els.search) this._setFocus(1, 0);
            else this._setFocus(0, 0);
        } else if (this._region === 3) {
            if (this._gridRow > 0) {
                this._gridRow--;
                this._setFocus(3);
            } else {
                this._setFocus(0, 0);
            }
        }
    }

    _down() {
        if (this._region === 4) return;
        if (this._region === 0) this._setFocus(2, this._sidebarIdx);
        else if (this._region === 1) {
            if (this._els.search) this._els.search.blur();
            this._setFocus(2, 0);
        } else if (this._region === 2) {
            if (this._sidebarIdx < this._visCatEls.length - 1) this._setFocus(2, this._sidebarIdx + 1);
        } else if (this._region === 3) {
            const totalRows = this._vlist ? this._vlist.getRowCount() : 0;
            if (this._gridRow + 1 < totalRows) {
                this._gridRow++;
                const cols = this._vlist.getColumnsInRow(this._gridRow);
                this._gridCol = Math.min(this._gridCol, cols - 1);
                this._setFocus(3);
            }
        }
    }

    _right() {
        if (this._region === 4) {
            if (this._detailIdx + 1 < this._detailBtns.length) this._setDetailFocus(this._detailIdx + 1);
            return;
        }
        if (this._region === 0 || this._region === 1 || this._region === 2) {
            if (this._viewItems.length > 0) this._setFocus(3);
        } else if (this._region === 3) {
            const cols = this._vlist ? this._vlist.getColumnsInRow(this._gridRow) : 0;
            if (this._gridCol + 1 < cols) { this._gridCol++; this._setFocus(3); }
        }
    }

    _left() {
        if (this._region === 4) {
            if (this._detailIdx > 0) this._setDetailFocus(this._detailIdx - 1);
            return;
        }
        if (this._region === 3) {
            if (this._gridCol > 0) { this._gridCol--; this._setFocus(3); }
            else this._setFocus(2, this._sidebarIdx);
        }
    }

    _enter() {
        if (this._region === 0) this._goBack();
        else if (this._region === 1) {
            if (this._els.search) { this._els.search.focus(); this._inputActive = true; }
        } else if (this._region === 2) {
            const el = this._visCatEls[this._sidebarIdx];
            if (el) this._selectCategory(el.dataset.catId);
        } else if (this._region === 3) {
            const idx = this._gridRow * GRID_COLUMNS + this._gridCol;
            const item = this._viewItems[idx];
            if (item) this._openDetail(item);
        } else if (this._region === 4) {
            if (this._detailIdx === 0) this._playItem(this._detailItem);
            else this._closeDetail();
        }
    }

    /* ═══════════════ FOCUS — max 2 DOM writes ═══════════════ */

    _setFocus(region, index) {
        // Remove old
        if (this._prev) {
            const c = this._prev.className;
            if (c.includes(' focused')) this._prev.className = c.replace(' focused', '');
        }

        this._region = region;
        let target = null;

        switch (region) {
            case 0:
                target = this._els.btnBack;
                break;
            case 1:
                target = this._els.search ? this._els.search.parentElement : null;
                break;
            case 2:
                this._sidebarIdx = Math.max(0, Math.min(index || 0, this._visCatEls.length - 1));
                target = this._visCatEls[this._sidebarIdx];
                break;
            case 3: {
                if (this._vlist) {
                    this._vlist.ensureRowVisible(this._gridRow);
                    target = this._vlist.getCellElement(this._gridRow, this._gridCol);
                }
                break;
            }
        }

        if (target) {
            target.className += ' focused';
            if (region === 2) this._scrollCat(target);
            this._prev = target;
        }
    }

    _scrollCat(el) {
        const box = this._els.categoryList;
        if (!box) return;
        const bt = box.getBoundingClientRect();
        const et = el.getBoundingClientRect();
        if (et.top < bt.top + 4) box.scrollTop -= (bt.top - et.top + 12);
        else if (et.bottom > bt.bottom - 4) box.scrollTop += (et.bottom - bt.bottom + 12);
    }

    /* ═══════════════ HELPERS ═══════════════ */

    _updateCount() {
        const n = this._viewItems.length;
        this._els.itemCount.textContent = n + ' movie' + (n !== 1 ? 's' : '');
    }

    _showLoading(show) {
        this._els.gridLoading.style.display = show ? 'flex' : 'none';
    }

    _startClock() {
        this._updateClock();
        this._clockTimer = setInterval(() => this._updateClock(), 30000);
    }
    _updateClock() {
        this._els.time.textContent = new Date().toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: true,
        });
    }

    _goBack() { window.history.back(); }
}

function _escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default MoviesPage;
