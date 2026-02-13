/**
 * Application Constants
 * Centralized configuration for events, page names, and app-wide constants
 */

// Page Types
export const PAGES = {
    LOGIN: 'login',
    HOME: 'home',
    LIVETV: 'livetv',
    MOVIES: 'movies',
    SERIES: 'series',
};

// Custom Events
export const EVENTS = {
    // Login events
    LOGIN_SUCCESS: 'login:success',
    HOME_LOGOUT: 'home:logout',

    // Navigation events
    HOME_NAVIGATE: 'home:navigate',
    HOME_OPEN_ITEM: 'home:open',

    // Player events
    PLAYER_BACK: 'player:back',
    PLAYER_ERROR: 'player:error',
    PLAYER_FULLSCREEN: 'player:fullscreen',
    PLAYER_MINI: 'player:mini',
    PLAYER_MINIMIZE_REQUEST: 'player:minimize-request',

    // WebOS back button
    WEBOS_BACK: 'webos:back',
};

// CSS Classes
export const CSS_CLASSES = {
    PLAYER_FULLSCREEN: 'vplayer--fullscreen',
    PLAYER_MINI: 'vplayer--mini',
};

// Selectors
export const SELECTORS = {
    FULLSCREEN_PLAYER: `.${CSS_CLASSES.PLAYER_FULLSCREEN}`,
    APP_CONTAINER: '#app',
};

export default {
    PAGES,
    EVENTS,
    CSS_CLASSES,
    SELECTORS,
};
