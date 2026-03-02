import client from './XtreamClient.js';
import { Endpoint, Router, StreamType } from './Router.js';
import Cache from '../utils/cache.js';
import { fetchWithCache } from '../utils/cacheHelpers.js';
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

        return fetchWithCache(this._cache, cacheKey, async () => {
            const data = await client.execute(Endpoint.liveCategories(), {
                requestId: 'live_categories',
            });
            return Array.isArray(data) ? data : [];
        }, { forceRefresh });
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

        return fetchWithCache(this._cache, cacheKey, async () => {
            const data = await client.execute(Endpoint.liveStreams(categoryId), {
                requestId: `live_streams_${categoryId || 'all'}`,
            });
            return Array.isArray(data) ? data : [];
        }, { forceRefresh });
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
    getCachedCount() {
        const data = this._cache.get('live_streams_all');
        return data ? data.length : null;
    }

    clearCache() {
        this._cache.clear();
    }
}

export default new LiveService();