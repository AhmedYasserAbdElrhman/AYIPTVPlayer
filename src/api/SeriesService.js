import client from './XtreamClient.js';
import { Endpoint, Router, StreamType } from './Router.js';
import Cache from '../utils/cache.js';
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
        if (!forceRefresh && this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        const data = await client.execute(Endpoint.seriesCategories(), {
            requestId: 'series_categories',
        });

        const categories = Array.isArray(data) ? data : [];
        this._cache.set(cacheKey, categories);
        return categories;
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

        if (!forceRefresh && this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        const data = await client.execute(Endpoint.series(categoryId), {
            requestId: `series_${categoryId || 'all'}`,
        });

        const series = Array.isArray(data) ? data : [];
        this._cache.set(cacheKey, series);
        return series;
    }

    /**
     * Fetches detailed info for a specific series.
     * @param {number|string} seriesId
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<Object>}
     */
    async getInfo(seriesId, forceRefresh = false) {
        const cacheKey = `series_info_${seriesId}`;
        if (!forceRefresh && this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        const data = await client.execute(Endpoint.seriesInfo(seriesId), {
            requestId: `series_info_${seriesId}`,
        });

        if (data) {
            this._cache.set(cacheKey, data);
        }

        return data || {};
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
    clearCache() {
        this._cache.clear();
    }
}

export default new SeriesService();