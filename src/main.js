// CSS imports — Vite bundles these into app.css
import './styles/global.css';
import './pages/login/login.css';
import './pages/home/home.css';
import './pages/livetv/livetv.css';
import './pages/movies/media.css';
import './components/VideoPlayer/VideoPlayer.css';
import './components/MediaCard/MediaCard.css';
import './pages/details/details.css';
import './pages/player/player.css';

import LoginPage from './pages/login/login.js';
import HomePage from './pages/home/home.js';
import XtreamAuth from './api/XtreamAuth.js';
import LiveTVPage from './pages/livetv/LiveTVPage.js';
import MoviesPage from './pages/movies/MoviesPage.js';
import SeriesPage from './pages/series/SeriesPage.js';
import MediaDetailsPage from './pages/details/MediaDetailsPage.js';
import PlayerPage from './pages/player/PlayerPage.js';
import TemplateEngine from './utils/templateEngine.js';
import templates from 'virtual:templates';
import WebOSBackHandler from './utils/WebOSBackHandler.js';
import { PAGES, EVENTS, SELECTORS } from './config/AppConstants.js';

class App {
    constructor() {
        this._container = null;
        this._currentPage = null;
    }

    async init() {
        this._container = document.querySelector(SELECTORS.APP_CONTAINER);

        if (!this._container) {
            console.error('[App] #app element not found');
            return;
        }

        // Register bundled templates
        TemplateEngine.registerTemplates(templates);

        // Install WebOS back button handler to prevent platform exit prompts
        WebOSBackHandler.install();

        this._bindGlobalEvents();

        // Try to restore session from cached credentials
        const session = await XtreamAuth.restoreSession();
        if (session) {
            await this._showHome(session);
        } else {
            await this._showLogin();
        }
    }

    async _showLogin(skipPush) {
        this._destroyCurrent();
        this._currentPage = new LoginPage();
        await this._currentPage.mount(this._container);
        if (!skipPush) WebOSBackHandler.pushPageState(PAGES.LOGIN);
    }

    async _showHome(session, skipPush) {
        this._destroyCurrent();
        this._currentPage = new HomePage();
        await this._currentPage.mount(this._container, session);
        if (!skipPush) WebOSBackHandler.pushPageState(PAGES.HOME);
    }

    async _showLiveTV(skipPush) {
        this._destroyCurrent();
        this._currentPage = new LiveTVPage();
        await this._currentPage.mount(this._container);
        if (!skipPush) WebOSBackHandler.pushPageState(PAGES.LIVETV);
    }

    async _showMovies(skipPush) {
        this._destroyCurrent();
        this._currentPage = new MoviesPage();
        await this._currentPage.mount(this._container);
        if (!skipPush) WebOSBackHandler.pushPageState(PAGES.MOVIES);
    }

    async _showSeries(skipPush) {
        this._destroyCurrent();
        this._currentPage = new SeriesPage();
        await this._currentPage.mount(this._container);
        if (!skipPush) WebOSBackHandler.pushPageState(PAGES.SERIES);
    }

    async _showDetails(itemInfo, skipPush) {
        this._destroyCurrent();
        this._currentPage = new MediaDetailsPage();
        await this._currentPage.mount(this._container, itemInfo);
        if (!skipPush) WebOSBackHandler.pushPageState(PAGES.DETAILS, { itemInfo });
    }

    async _showPlayer(streamInfo) {
        this._destroyCurrent();
        this._currentPage = new PlayerPage();
        await this._currentPage.mount(this._container, streamInfo);
        WebOSBackHandler.pushPageState(PAGES.PLAYER);
    }

    _bindGlobalEvents() {
        this._container.addEventListener(EVENTS.LOGIN_SUCCESS, async (e) => {
            const { session } = e.detail;
            await this._showHome(session);
        });

        this._container.addEventListener(EVENTS.HOME_LOGOUT, () => {
            XtreamAuth.logout();
            this._showLogin();
        });

        this._container.addEventListener(EVENTS.HOME_NAVIGATE, (e) => {
            const { target } = e.detail;
            if (target === PAGES.LIVETV) {
                this._showLiveTV();
            } else if (target === PAGES.MOVIES) {
                this._showMovies();
            } else if (target === PAGES.SERIES) {
                this._showSeries();
            } else if (target === 'settings') {
                // TODO: Handle navigation to settings
            }
        });

        this._container.addEventListener(EVENTS.HOME_OPEN_ITEM, (e) => {
            const { itemId } = e.detail;
            // TODO: Handle opening a recent/favourite item
        });

        // Listen for detail page requests
        this._container.addEventListener(EVENTS.SHOW_DETAILS, (e) => {
            this._showDetails(e.detail);
        });

        // Any page can request playback — navigate to PlayerPage
        this._container.addEventListener(EVENTS.PLAY_REQUEST, (e) => {
            this._showPlayer(e.detail);
        });

        // Handle WebOS back button via History API popstate
        document.addEventListener(EVENTS.WEBOS_BACK, async (e) => {
            console.log('[App] Back button pressed, state:', e.detail.state);

            const state = e.detail.state;

            // If we have a recorded state, handle it
            if (state && state.page) {
                // If we're already on this page (e.g. exiting fullscreen),
                // let the page handle it instead of re-creating it.
                if (this._currentPage?.constructor?.PAGE_ID === state.page) {
                    if (typeof this._currentPage.onHistoryBack === 'function') {
                        this._currentPage.onHistoryBack(state);
                    }
                    return;
                }

                switch (state.page) {
                    case PAGES.HOME:
                        await this._showHome(XtreamAuth.getSession(), true);
                        break;
                    case PAGES.LIVETV:
                        this._showLiveTV(true);
                        break;
                    case PAGES.MOVIES:
                        this._showMovies(true);
                        break;
                    case PAGES.SERIES:
                        this._showSeries(true);
                        break;
                    case PAGES.DETAILS:
                        if (state.itemInfo) {
                            this._showDetails(state.itemInfo, true);
                        } else {
                            window.history.back();
                        }
                        break;
                    case PAGES.LOGIN:
                        this._showLogin(true);
                        break;
                }
            } else if (!state) {
                // Empty history - check if on home page, if so trigger exit
                console.log('[App] History empty');
                // Check if current page is HomePage
                if (this._currentPage && this._currentPage.constructor.PAGE_ID === 'home') {
                    console.log('[App] On home page, triggering exit');
                    if (window.webOS && window.webOS.platformBack) {
                        window.webOS.platformBack();
                    } else if (window.PalmSystem && window.PalmSystem.platformBack) {
                        window.PalmSystem.platformBack();
                    }
                } else {
                    // On other page, go back to home
                    const session = XtreamAuth.getSession();
                    if (session) {
                        await this._showHome(session, true);
                    } else {
                        this._showLogin(true);
                    }
                }
            }
        });
    }

    _destroyCurrent() {
        if (this._currentPage?.destroy) {
            this._currentPage.destroy();
        }
        this._currentPage = null;
    }
}

// Wait for DOM to be ready before initializing
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const app = new App();
        app.init();
    });
} else {
    // DOM already ready
    const app = new App();
    app.init();
}