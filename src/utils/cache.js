/**
 * Simple in-memory cache with TTL (Time To Live) support.
 * 
 * Purpose:
 * - Prevents redundant API calls for data that rarely changes
 * - Categories, EPG data, and stream lists are cached
 * - Each service gets its own Cache instance for isolation
 * 
 * Used by: LiveService, VodService, SeriesService, EpgService
 */
class Cache {
    /**
     * @param {number} [defaultTTL=300000] - Default time to live in ms (5 minutes)
     */
    constructor(defaultTTL = 300000) {
        /** @type {Map<string, { data: any, expiresAt: number, createdAt: number }>} */
        this._store = new Map();
        this._defaultTTL = defaultTTL;
        this._hits = 0;
        this._misses = 0;
    }

    /**
     * Retrieves a cached value if it exists and hasn't expired.
     * @param {string} key
     * @returns {any|null} Cached data or null if missing/expired
     * 
     * @example
     * const categories = cache.get('live_categories');
     * if (categories) {
     *     return categories; // skip API call
     * }
     */
    get(key) {
        const entry = this._store.get(key);

        if (!entry) {
            this._misses++;
            return null;
        }

        if (Date.now() > entry.expiresAt) {
            this._store.delete(key);
            this._misses++;
            return null;
        }

        this._hits++;
        return entry.data;
    }

    /**
     * Stores a value in the cache with optional custom TTL.
     * @param {string} key
     * @param {any} data
     * @param {number} [ttl] - Custom TTL in ms, uses default if omitted
     * 
     * @example
     * cache.set('live_categories', categories);
     * cache.set('epg_data', epgData, 60000); // 1 minute TTL
     */
    set(key, data, ttl = this._defaultTTL) {
        const now = Date.now();
        this._store.set(key, {
            data,
            expiresAt: now + ttl,
            createdAt: now,
        });
    }

    /**
     * Checks if a non-expired entry exists for the given key.
     * Does NOT count as a hit/miss for stats.
     * @param {string} key
     * @returns {boolean}
     * 
     * @example
     * if (!cache.has('live_streams_all')) {
     *     const streams = await fetchStreams();
     *     cache.set('live_streams_all', streams);
     * }
     */
    has(key) {
        const entry = this._store.get(key);

        if (!entry) return false;

        if (Date.now() > entry.expiresAt) {
            this._store.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Removes a specific entry from the cache.
     * @param {string} key
     * @returns {boolean} True if entry existed and was removed
     */
    delete(key) {
        return this._store.delete(key);
    }

    /**
     * Removes all entries matching a prefix.
     * Useful for invalidating related cached data.
     * @param {string} prefix
     * @returns {number} Number of entries removed
     * 
     * @example
     * // Invalidate all VOD stream caches when category changes
     * cache.deleteByPrefix('vod_streams_');
     */
    deleteByPrefix(prefix) {
        let count = 0;

        for (const key of this._store.keys()) {
            if (key.startsWith(prefix)) {
                this._store.delete(key);
                count++;
            }
        }

        return count;
    }

    /**
     * Clears all cached entries.
     */
    clear() {
        this._store.clear();
        this._hits = 0;
        this._misses = 0;
    }

    /**
     * Removes all expired entries without waiting for access.
     * Call periodically to free memory on low-resource TV hardware.
     * @returns {number} Number of expired entries removed
     * 
     * @example
     * // Run cleanup every 10 minutes
     * setInterval(() => cache.cleanup(), 600000);
     */
    cleanup() {
        const now = Date.now();
        let count = 0;

        for (const [key, entry] of this._store.entries()) {
            if (now > entry.expiresAt) {
                this._store.delete(key);
                count++;
            }
        }

        return count;
    }

    /**
     * Returns the current number of entries (including potentially expired ones).
     * @returns {number}
     */
    get size() {
        return this._store.size;
    }

    /**
     * Returns cache performance statistics.
     * Useful for debugging and monitoring.
     * @returns {{ size: number, hits: number, misses: number, hitRate: string }}
     * 
     * @example
     * console.log(cache.stats);
     * // { size: 12, hits: 48, misses: 6, hitRate: '88.9%' }
     */
    get stats() {
        const total = this._hits + this._misses;
        const hitRate = total === 0 ? '0%' : `${((this._hits / total) * 100).toFixed(1)}%`;

        return {
            size: this._store.size,
            hits: this._hits,
            misses: this._misses,
            hitRate,
        };
    }

    /**
     * Returns remaining TTL for a cached entry in milliseconds.
     * @param {string} key
     * @returns {number} Remaining TTL in ms, 0 if expired or not found
     */
    getTTL(key) {
        const entry = this._store.get(key);

        if (!entry) return 0;

        const remaining = entry.expiresAt - Date.now();
        return remaining > 0 ? remaining : 0;
    }

    /**
     * Returns all valid (non-expired) cache keys.
     * @returns {string[]}
     */
    keys() {
        const now = Date.now();
        const validKeys = [];

        for (const [key, entry] of this._store.entries()) {
            if (now <= entry.expiresAt) {
                validKeys.push(key);
            }
        }

        return validKeys;
    }
}

export default Cache;