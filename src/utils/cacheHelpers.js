import Cache from './cache.js';

/**
 * Fetches data using a Cache instance with standardised semantics:
 * - If not forceRefresh and a non-expired entry exists → return cached.
 * - Otherwise calls fetchFn, stores the result, and returns it.
 *
 * Normalisation (e.g. turning null into {} or []) should be done inside fetchFn
 * so that the cached value matches what callers expect to receive.
 *
 * @template T
 * @param {Cache} cache
 * @param {string} key
 * @param {() => Promise<T>} fetchFn
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<T>}
 */
export async function fetchWithCache(cache, key, fetchFn, options = {}) {
    const { forceRefresh = false } = options;

    if (!forceRefresh) {
        const cached = cache.get(key);
        // Cache.get returns null when missing/expired; empty arrays/objects are preserved.
        if (cached !== null) {
            return cached;
        }
    }

    const result = await fetchFn();
    cache.set(key, result);
    return result;
}

