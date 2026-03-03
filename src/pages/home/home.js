import TemplateEngine from '../../utils/templateEngine.js';
import { mapRemoteEvent } from '../../input/RemoteKeyMapper.js';
import { RemoteActions } from '../../input/RemoteActions.js';
import { PAGES, EVENTS } from '../../config/AppConstants.js';
import RecentCard from '../../components/RecentCard/RecentCard.js';
import WatchHistoryService from '../../services/WatchHistoryService.js';
import PlaybackProgressService from '../../services/PlaybackProgressService.js';
import LiveService from '../../api/LiveService.js';
import VodService from '../../api/VodService.js';
import SeriesService from '../../api/SeriesService.js';

/**
 * Home page controller — Smart TV remote optimised.
 *
 * Performance notes (WebOS):
 *  - Focus uses border-color ONLY (no scale, no box-shadow)
 *  - setFocus touches exactly 2 DOM elements per keypress
 *  - scrollIntoView is instant (no smooth — causes frame drops)
 *  - will-change: border-color set in CSS on all focusables
 *  - Transitions at 80ms (fast, single property, cheap)
 *
 * Navigation uses a 2D grid mapped by rows:
 *  Row 0 → category cards (Live TV, Movies, Series)
 *  Row 1 → fav toggle + recent items (horizontal)
 *  Row 2 → settings, logout
 *  ArrowDown / ArrowUp → move between rows
 *  ArrowLeft / ArrowRight → move within row
 *  Enter/OK → activate focused element
 */

class HomePage {
    static PAGE_ID = 'home';

    constructor() {
        this._container = null;
        this._keyHandler = this._onKeyDown.bind(this);
        this._clockTimer = null;
        this._els = {};

        // Focus state
        this._focusRow = 0;
        this._focusCol = 0;
        this._rows = [];
        this._recentCards = [];
        this._prevFocused = null; // cache for perf

        // Data
        this._session = null;
        this._showFavourites = false;
        this._recentItems = [];
        this._favouriteItems = [];
    }

    // ─── Lifecycle ─────────────────────────────────────────────

    async mount(container, session) {
        this._container = container;
        this._session = session;

        await TemplateEngine.load('pages/home/home.html', this._container);

        this._container.setAttribute('tabindex', '-1');
        this._container.style.outline = 'none';

        this._cacheDom();
        this._buildFocusGrid();
        this._bindEvents();
        this._startClock();
        this._populateExpiration();
        this._loadRecentItems();
        this._loadCounts();

        this._setFocus(0, 0);
    }

    destroy() {
        document.removeEventListener('keydown', this._keyHandler);
        if (this._clockTimer) clearInterval(this._clockTimer);
        if (this._container) this._container.innerHTML = '';
        this._rows = [];
        this._recentCards = [];
        this._prevFocused = null;
        this._els = {};
        this._container = null;
    }

    // ─── DOM References ────────────────────────────────────────

    _cacheDom() {
        this._els = {
            time: this._container.querySelector('#topbar-time'),
            date: this._container.querySelector('#topbar-date'),
            cardLive: this._container.querySelector('#card-livetv'),
            cardMovies: this._container.querySelector('#card-movies'),
            cardSeries: this._container.querySelector('#card-series'),
            liveCount: this._container.querySelector('#card-livetv-count'),
            moviesCount: this._container.querySelector('#card-movies-count'),
            seriesCount: this._container.querySelector('#card-series-count'),
            toggleFav: this._container.querySelector('#toggle-fav'),
            recentTitle: this._container.querySelector('#recent-title'),
            recentList: this._container.querySelector('#recent-list'),
            recentEmpty: this._container.querySelector('#recent-empty'),
            btnSettings: this._container.querySelector('#btn-settings'),
            btnLogout: this._container.querySelector('#btn-logout'),
            expDate: this._container.querySelector('#bottom-exp-date'),
            expDays: this._container.querySelector('#bottom-exp-days'),
            expWrap: this._container.querySelector('#bottom-exp'),
        };
    }

    // ─── Focus Grid ────────────────────────────────────────────

    _buildFocusGrid() {
        this._rows = [
            [this._els.cardLive, this._els.cardMovies, this._els.cardSeries],
            [this._els.toggleFav],
            [this._els.btnSettings, this._els.btnLogout],
        ];
    }

    _rebuildRow1() {
        this._rows[1] = [this._els.toggleFav, ...this._recentCards];
    }

    // ─── Events ────────────────────────────────────────────────

    _bindEvents() {
        document.addEventListener('keydown', this._keyHandler);

        this._els.cardLive.addEventListener('click', () => this._navigate('livetv'));
        this._els.cardMovies.addEventListener('click', () => this._navigate('movies'));
        this._els.cardSeries.addEventListener('click', () => this._navigate('series'));
        this._els.btnSettings.addEventListener('click', () => this._navigate('settings'));
        this._els.btnLogout.addEventListener('click', () => this._handleLogout());
        this._els.toggleFav.addEventListener('click', () => this._toggleFavourites());
    }

    // ─── Key Handling ──────────────────────────────────────────

    _onKeyDown(e) {
        const action = mapRemoteEvent(e);
        let nr, nc;

        if (action === RemoteActions.DOWN) {
            e.preventDefault();
            e.stopPropagation();
            nr = this._focusRow + 1;
            if (nr < this._rows.length) {
                this._setFocus(nr, Math.min(this._focusCol, this._rows[nr].length - 1));
            }
            return;
        }

        if (action === RemoteActions.UP) {
            e.preventDefault();
            e.stopPropagation();
            nr = this._focusRow - 1;
            if (nr >= 0) {
                this._setFocus(nr, Math.min(this._focusCol, this._rows[nr].length - 1));
            }
            return;
        }

        if (action === RemoteActions.RIGHT) {
            e.preventDefault();
            e.stopPropagation();
            nc = this._focusCol + 1;
            if (nc < this._rows[this._focusRow].length) {
                this._setFocus(this._focusRow, nc);
            }
            return;
        }

        if (action === RemoteActions.LEFT) {
            e.preventDefault();
            e.stopPropagation();
            nc = this._focusCol - 1;
            if (nc >= 0) {
                this._setFocus(this._focusRow, nc);
            }
            return;
        }

        if (action === RemoteActions.OK) {
            e.preventDefault();
            e.stopPropagation();
            this._handleEnter();
            return;
        }

        // BACK: WebOS intercepted via WebOSBackHandler, no need to handle here
    }

    // ─── Focus — performance-optimised ─────────────────────────

    /**
     * Only touches 2 DOM elements per call:
     *  1. Remove .focused from previous
     *  2. Add .focused to new target
     * No looping all elements. Instant scroll (no smooth).
     */
    _setFocus(row, col) {
        const target = this._rows[row]?.[col];
        if (!target) return;

        if (this._prevFocused) {
            this._prevFocused.classList.remove('focused');
        }

        target.classList.add('focused');
        this._prevFocused = target;

        this._focusRow = row;
        this._focusCol = col;

        // Instant scroll for horizontal recent list only
        if (row === 1 && col > 0) {
            target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    _handleEnter() {
        const focused = this._rows[this._focusRow]?.[this._focusCol];
        if (!focused) return;

        if (focused === this._els.cardLive) return this._navigate('livetv');
        if (focused === this._els.cardMovies) return this._navigate('movies');
        if (focused === this._els.cardSeries) return this._navigate('series');
        if (focused === this._els.toggleFav) return this._toggleFavourites();
        if (focused === this._els.btnSettings) return this._navigate('settings');
        if (focused === this._els.btnLogout) return this._handleLogout();

        // Recent card
        if (focused.dataset.itemId) {
            this._openRecentItem(focused.dataset.itemId);
        }
    }

    // ─── Clock ─────────────────────────────────────────────────

    _startClock() {
        this._updateClock();
        this._clockTimer = setInterval(() => this._updateClock(), 30000);
    }

    _updateClock() {
        const now = new Date();

        this._els.time.textContent = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
        this._els.date.textContent = now.toLocaleDateString('en-US', options);
    }

    // ─── Expiration — full date text ───────────────────────────

    _populateExpiration() {
        if (!this._session?.userInfo) return;

        const info = this._session.userInfo;
        const expTimestamp = info.expiryTimestamp;

        if (!expTimestamp) {
            this._els.expDate.textContent = 'No expiry';
            this._els.expDays.textContent = '';
            return;
        }

        const exp = new Date(expTimestamp * 1000);
        const now = new Date();
        const diff = exp - now;
        const days = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));

        // Format: YYYY-MM-DD
        const y = exp.getFullYear();
        const m = String(exp.getMonth() + 1).padStart(2, '0');
        const d = String(exp.getDate()).padStart(2, '0');

        this._els.expDate.textContent = `${y}-${m}-${d}`;
        this._els.expDays.textContent = `(${days} day${days !== 1 ? 's' : ''} left)`;

        // Colour-code urgency
        if (days <= 3) {
            this._els.expWrap.classList.add('home-bottom__exp--critical');
        } else if (days <= 14) {
            this._els.expWrap.classList.add('home-bottom__exp--warning');
        }
    }

    // ─── Counts ────────────────────────────────────────────────

    /**
     * Update category counts externally after data loads.
     */
    setCounts(live, movies, series) {
        this._els.liveCount.textContent = `${live} channel${live !== 1 ? 's' : ''}`;
        this._els.moviesCount.textContent = `${movies} movie${movies !== 1 ? 's' : ''}`;
        this._els.seriesCount.textContent = `${series} series`;
    }

    _loadCounts() {
        const live = LiveService.getCachedCount();
        const movies = VodService.getCachedCount();
        const series = SeriesService.getCachedCount();
        if (live != null && movies != null && series != null) {
            this.setCounts(live, movies, series);
        }
    }

    // ─── Recent / Favourites ───────────────────────────────────

    _loadRecentItems() {
        // Load real watch history from service
        const entries = WatchHistoryService.getRecent(10);
        this._recentItems = entries.map(entry => {
            const progress = PlaybackProgressService.get(entry.getProgressKey());
            return entry.toRecentCard(progress);
        });

        // Favourites will be handled by a separate FavouritesManager later
        try {
            const raw = localStorage.getItem('iptv_favourites');
            this._favouriteItems = raw ? JSON.parse(raw) : [];
        } catch { this._favouriteItems = []; }

        this._renderList();
    }

    _toggleFavourites() {
        this._showFavourites = !this._showFavourites;
        const toggle = this._els.toggleFav;
        const isActive = toggle.classList.toggle('toggle--active');
        toggle.setAttribute('aria-checked', isActive.toString());

        this._els.recentTitle.textContent = this._showFavourites
            ? 'Favourites'
            : 'Latest Watched';

        this._renderList();
    }

    _renderList() {
        const items = this._showFavourites ? this._favouriteItems : this._recentItems;
        const list = this._els.recentList;

        // Clear old cards
        this._recentCards.forEach((card) => card.remove());
        this._recentCards = [];

        if (items.length === 0) {
            this._els.recentEmpty.style.display = 'flex';
            this._rebuildRow1();
            return;
        }

        this._els.recentEmpty.style.display = 'none';

        items.forEach((item) => {
            const card = this._createRecentCard(item);
            list.appendChild(card);
            this._recentCards.push(card);
        });

        this._rebuildRow1();

        // Clamp focus if needed
        if (this._focusRow === 1 && this._focusCol >= this._rows[1].length) {
            this._focusCol = this._rows[1].length - 1;
        }
    }

    _createRecentCard(item) {
        return RecentCard.create(item, {
            onClick: (id) => this._openRecentItem(id),
        });
    }

    // ─── Navigation Events ─────────────────────────────────────

    _navigate(target) {
        this._container.dispatchEvent(
            new CustomEvent(EVENTS.HOME_NAVIGATE, {
                detail: { target },
                bubbles: true,
            })
        );
    }

    _handleLogout() {
        this._container.dispatchEvent(
            new CustomEvent(EVENTS.HOME_LOGOUT, { bubbles: true })
        );
    }

    _openRecentItem(itemId) {
        if (!itemId) return;
        this._container.dispatchEvent(
            new CustomEvent(EVENTS.HOME_OPEN_ITEM, {
                detail: { itemId },
                bubbles: true,
            })
        );
    }

    // ─── Public API ────────────────────────────────────────────

    setRecentItems(items) {
        this._recentItems = items;
        if (!this._showFavourites) this._renderList();
    }

    refreshRecentItems() {
        this._loadRecentItems();
    }

    setFavouriteItems(items) {
        this._favouriteItems = items;
        try { localStorage.setItem('iptv_favourites', JSON.stringify(items)); }
        catch { /* ignore */ }
        if (this._showFavourites) this._renderList();
    }


}

export default HomePage;
