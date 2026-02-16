import Settings from '../config/settings.js';

/**
 * Alamofire-style API Router.
 * Each endpoint is defined as an enum-like object with all its configuration.
 * Supports clean, type-safe URL construction with automatic authentication.
 */

/**
 * API Endpoint definitions (like Swift enums with associated values)
 */
const Endpoint = {
    // Authentication
    serverInfo: () => ({ action: null, params: {} }),

    // Live TV
    liveCategories: () => ({ action: 'get_live_categories', params: {} }),
    liveStreams: (categoryId = null) => ({
        action: 'get_live_streams',
        params: categoryId ? { category_id: categoryId } : {},
    }),
    shortEpg: (streamId, limit = null) => ({
        action: 'get_short_epg',
        params: { stream_id: streamId, ...(limit && { limit }) },
    }),
    simpleEpg: (streamId) => ({
        action: 'get_simple_data_table',
        params: { stream_id: streamId },
    }),

    // VOD (Movies)
    vodCategories: () => ({ action: 'get_vod_categories', params: {} }),
    vodStreams: (categoryId = null) => ({
        action: 'get_vod_streams',
        params: categoryId ? { category_id: categoryId } : {},
    }),
    vodInfo: (vodId) => ({
        action: 'get_vod_info',
        params: { vod_id: vodId },
    }),

    // Series
    seriesCategories: () => ({ action: 'get_series_categories', params: {} }),
    series: (categoryId = null) => ({
        action: 'get_series',
        params: categoryId ? { category_id: categoryId } : {},
    }),
    seriesInfo: (seriesId) => ({
        action: 'get_series_info',
        params: { series_id: seriesId },
    }),

    // EPG
    fullEpg: (streamId) => ({
        action: 'get_simple_all_epg',
        params: { stream_id: streamId },
    }),
};

/**
 * Stream URL types (for playback)
 */
const StreamType = {
    live: 'live',
    vod: 'movie',
    series: 'series',
};

/**
 * Main Router class - analogous to Alamofire's URLRequestConvertible
 */
class Router {
    /**
     * Builds a complete URL request for an API endpoint.
     * @param {Object} endpoint - Endpoint definition from Endpoint enum
     * @returns {URLRequest}
     */
    static request(endpoint) {
        const { action, params } = endpoint;
        return new URLRequest(this._buildApiUrl(action, params), 'GET');
    }

    /**
     * Builds a stream playback URL.
     * @param {string} type - StreamType (live, vod, series)
     * @param {number|string} streamId
     * @param {string} extension - File extension (m3u8, ts, mp4, mkv, etc.)
     * @returns {string}
     */
    static stream(type, streamId, extension) {
        const base = Settings.getBaseUrl();
        const { username, password } = Settings.credentials;

        if (!Object.values(StreamType).includes(type)) {
            throw new Error(`Invalid stream type: ${type}`);
        }

        return `${base}/${type}/${username}/${password}/${streamId}.${extension}`;
    }

    /**
     * Builds the XMLTV EPG URL.
     * @returns {string}
     */
    static xmltv() {
        const base = Settings.getBaseUrl();
        const { username, password } = Settings.credentials;
        return `${base}/xmltv.php?username=${username}&password=${password}`;
    }

    /**
     * Builds a timeshift/catchup URL.
     * @param {number|string} streamId
     * @param {number} duration - Duration in seconds
     * @param {string} start - Format: YYYY-MM-DD:HH-MM
     * @returns {string}
     */
    static timeshift(streamId, duration, start) {
        const base = Settings.getBaseUrl();
        const { username, password } = Settings.credentials;
        return `${base}/timeshift/${username}/${password}/${duration}/${start}/${streamId}.ts`;
    }

    /**
     * Private: Builds player_api.php URL with authentication.
     * @param {string|null} action
     * @param {Object} params
     * @returns {string}
     * @private
     */
    static _buildApiUrl(action, params) {
        const base = Settings.getBaseUrl();
        const { username, password } = Settings.credentials;

        const query = new URLSearchParams({ username, password });

        if (action) {
            query.append('action', action);
        }

        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                query.append(key, value);
            }
        }

        return `${base}/player_api.php?${query.toString()}`;
    }
}

/**
 * URLRequest wrapper - holds URL, method, headers, etc.
 * Analogous to Alamofire's URLRequest
 */
class URLRequest {
    /**
     * @param {string} url
     * @param {string} method - HTTP method (GET, POST, etc.)
     * @param {Object} [headers={}]
     * @param {any} [body=null]
     */
    constructor(url, method = 'GET', headers = {}, body = null) {
        this.url = url;
        this.method = method;
        this.headers = headers;
        this.body = body;
    }

    /**
     * Converts to a fetch() options object.
     * @returns {{ method: string, headers: Object, body?: any }}
     */
    toFetchOptions() {
        const options = {
            method: this.method,
            headers: this.headers,
        };

        if (this.body) {
            options.body = this.body;
        }

        return options;
    }

    /**
     * Returns the full URL string.
     * @returns {string}
     */
    toString() {
        return this.url;
    }
}

export { Router, Endpoint, StreamType, URLRequest };
export default Router;