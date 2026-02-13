import client from './XtreamClient.js';
import { Endpoint, Router } from './Router.js';
import Cache from '../utils/cache.js';
import { fetchWithCache } from '../utils/cacheHelpers.js';
import Settings from '../config/settings.js';

/**
 * Service for Electronic Program Guide (EPG) related API actions.
 * Single Responsibility: short EPG, full EPG, XMLTV URL.
 * Now uses Router for clean endpoint definitions.
 */
class EpgService {
    constructor() {
        this._cache = new Cache(Settings.api.cacheTTL);
    }

    /**
     * Fetches short EPG for a specific stream.
     * @param {number|string} streamId
     * @param {number} [limit] - Max number of EPG entries to return
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<Object>}
     */
    async getShortEpg(streamId, limit = null, forceRefresh = false) {
        const cacheKey = `epg_short_${streamId}_${limit || 'all'}`;

        return fetchWithCache(this._cache, cacheKey, async () => {
            const data = await client.execute(Endpoint.shortEpg(streamId, limit), {
                requestId: `epg_short_${streamId}`,
            });
            return data || {};
        }, { forceRefresh });
    }

    /**
     * Fetches the full EPG listing for a specific stream.
     * @param {number|string} streamId
     * @param {boolean} [forceRefresh=false]
     * @returns {Promise<Object>}
     */
    async getFullEpg(streamId, forceRefresh = false) {
        const cacheKey = `epg_full_${streamId}`;

        return fetchWithCache(this._cache, cacheKey, async () => {
            const data = await client.execute(Endpoint.fullEpg(streamId), {
                requestId: `epg_full_${streamId}`,
            });
            return data || {};
        }, { forceRefresh });
    }

    /**
     * Returns the XMLTV EPG URL for external parsers.
     * @returns {string}
     */
    getXmltvUrl() {
        return Router.xmltv();
    }

    /**
     * Clears the EPG service cache.
     */
    clearCache() {
        this._cache.clear();
    }
}

export default new EpgService();