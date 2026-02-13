import client from './XtreamClient.js';
import { Endpoint, Router, StreamType } from './Router.js';
import Cache from '../utils/cache.js';
import { fetchWithCache } from '../utils/cacheHelpers.js';
import Settings from '../config/settings.js';

/**
 * Service for all VOD (Movies) related API actions.
 */
class VodService {
    constructor() {
        this._cache = new Cache(Settings.api.cacheTTL);
    }

    /**
     * Fetches all VOD categories.
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<Array>}
     */
    async getCategories(forceRefresh = false) {
        const cacheKey = 'vod_categories';

        return fetchWithCache(this._cache, cacheKey, async () => {
            const data = await client.execute(Endpoint.vodCategories(), {
                requestId: 'vod_categories',
            });
            return Array.isArray(data) ? data : [];
        }, { forceRefresh });
    }

    /**
     * Fetches all VOD streams, optionally filtered by category.
     * @param {number|string} [categoryId]
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<Array>}
     */
    async getStreams(categoryId = null, forceRefresh = false) {
        const cacheKey = categoryId
            ? `vod_streams_cat_${categoryId}`
            : 'vod_streams_all';

        return fetchWithCache(this._cache, cacheKey, async () => {
            const data = await client.execute(Endpoint.vodStreams(categoryId), {
                requestId: `vod_streams_${categoryId || 'all'}`,
            });
            return Array.isArray(data) ? data : [];
        }, { forceRefresh });
    }

    /**
     * Fetches detailed info for a specific movie.
     * @param {number|string} vodId
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<Object>}
     */
    async getInfo(vodId, forceRefresh = false) {
        const cacheKey = `vod_info_${vodId}`;

        return fetchWithCache(this._cache, cacheKey, async () => {
            const data = await client.execute(Endpoint.vodInfo(vodId), {
                requestId: `vod_info_${vodId}`,
            });
            return data || {};
        }, { forceRefresh });
    }

    /**
     * Builds a playback URL for a VOD stream.
     * @param {number|string} streamId
     * @param {string} containerExtension
     * @returns {string}
     */
    getStreamUrl(streamId, containerExtension) {
        return Router.stream(StreamType.vod, streamId, containerExtension);
    }

    /**
     * Clears the VOD service cache.
     */
    clearCache() {
        this._cache.clear();
    }
}

export default new VodService();