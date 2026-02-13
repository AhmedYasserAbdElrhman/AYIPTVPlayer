import client from './XtreamClient.js';
import { Endpoint, Router, StreamType } from './Router.js';
import Cache from '../utils/cache.js';
import Settings from '../config/settings.js';

/**
 * Service for all Live TV related API actions.
 * Now uses Router for clean endpoint definitions.
 */
class LiveService {
    constructor() {
        this._cache = new Cache(Settings.api.cacheTTL);
    }

    /**
     * Fetches all live channel categories.
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<Array>}
     */
    async getCategories(forceRefresh = false) {
        const cacheKey = 'live_categories';
        if (!forceRefresh && this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        const data = await client.execute(Endpoint.liveCategories(), {
            requestId: 'live_categories',
        });

        const categories = Array.isArray(data) ? data : [];
        this._cache.set(cacheKey, categories);
        return categories;
    }

    /**
     * Fetches all live streams, optionally filtered by category.
     * @param {number|string} [categoryId]
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<Array>}
     */
    async getStreams(categoryId = null, forceRefresh = false) {
        const cacheKey = categoryId
            ? `live_streams_cat_${categoryId}`
            : 'live_streams_all';

        if (!forceRefresh && this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        const data = await client.execute(Endpoint.liveStreams(categoryId), {
            requestId: `live_streams_${categoryId || 'all'}`,
        });

        const streams = Array.isArray(data) ? data : [];
        this._cache.set(cacheKey, streams);
        return streams;
    }

    /**
     * Fetches short EPG for a live stream.
     * @param {number|string} streamId
     * @param {number} [limit]
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<Object>}
     */
    async getShortEpg(streamId, limit = null, forceRefresh = false) {
        const cacheKey = `epg_short_${streamId}_${limit || 'all'}`;
        if (!forceRefresh && this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        const data = await client.execute(Endpoint.shortEpg(streamId, limit), {
            requestId: `epg_short_${streamId}`,
        });

        if (data) {
            this._cache.set(cacheKey, data);
        }

        return data || {};
    }

    /**
     * Builds a playback URL for a live stream.
     * @param {number|string} streamId
     * @param {string} [extension='m3u8']
     * @returns {string}
     */
    getStreamUrl(streamId, extension = 'm3u8') {
        return Router.stream(StreamType.live, streamId, extension);
    }

    /**
     * Builds a timeshift/catchup URL.
     * @param {number|string} streamId
     * @param {number} duration - Duration in seconds
     * @param {string} start - Format: YYYY-MM-DD:HH-MM
     * @returns {string}
     */
    getTimeshiftUrl(streamId, duration, start) {
        return Router.timeshift(streamId, duration, start);
    }

    /**
     * Clears the live service cache.
     */
    clearCache() {
        this._cache.clear();
    }
}

export default new LiveService();