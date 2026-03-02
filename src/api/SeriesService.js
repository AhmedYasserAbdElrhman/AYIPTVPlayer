import client from './XtreamClient.js';
import { Endpoint, Router, StreamType } from './Router.js';
import Cache from '../utils/cache.js';
import { fetchWithCache } from '../utils/cacheHelpers.js';
import Settings from '../config/settings.js';

/**
 * Service for all TV Series related API actions.
 */
class SeriesService {
    constructor() {
        this._cache = new Cache(Settings.api.cacheTTL);
    }

    /**
     * Fetches all series categories.
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<Array>}
     */
    async getCategories(forceRefresh = false) {
        const cacheKey = 'series_categories';

        return fetchWithCache(this._cache, cacheKey, async () => {
            const data = await client.execute(Endpoint.seriesCategories(), {
                requestId: 'series_categories',
            });
            return Array.isArray(data) ? data : [];
        }, { forceRefresh });
    }

    /**
     * Fetches all series, optionally filtered by category.
     * @param {number|string} [categoryId]
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<Array>}
     */
    async getSeries(categoryId = null, forceRefresh = false) {
        const cacheKey = categoryId
            ? `series_cat_${categoryId}`
            : 'series_all';

        return fetchWithCache(this._cache, cacheKey, async () => {
            const data = await client.execute(Endpoint.series(categoryId), {
                requestId: `series_${categoryId || 'all'}`,
            });
            return Array.isArray(data) ? data : [];
        }, { forceRefresh });
    }

    /**
     * Fetches detailed info for a specific series.
     * @param {number|string} seriesId
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<Object>}
     */
    async getInfo(seriesId, forceRefresh = false) {
        const cacheKey = `series_info_${seriesId}`;

        return fetchWithCache(this._cache, cacheKey, async () => {
            const data = await client.execute(Endpoint.seriesInfo(seriesId), {
                requestId: `series_info_${seriesId}`,
            });
            return data || {};
        }, { forceRefresh });
    }

    /**
     * Builds a playback URL for a series episode.
     * @param {number|string} episodeId
     * @param {string} containerExtension
     * @returns {string}
     */
    getEpisodeUrl(episodeId, containerExtension) {
        return Router.stream(StreamType.series, episodeId, containerExtension);
    }

    /**
     * Clears the series service cache.
     */
    getCachedCount() {
        const data = this._cache.get('series_all');
        return data ? data.length : null;
    }

    clearCache() {
        this._cache.clear();
    }
}

export default new SeriesService();