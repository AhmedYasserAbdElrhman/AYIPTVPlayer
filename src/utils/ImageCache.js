/**
 * ImageCache — off-main-thread image loader with concurrency control + LRU cache.
 *
 * Problems solved:
 *  1. Main-thread jank — uses fetch + createImageBitmap for background decoding
 *  2. Network flooding — max 4 concurrent fetches, rest are queued
 *  3. Re-downloading — LRU cache (200 entries) serves repeat URLs instantly
 *
 * Usage:
 *   import ImageCache from '../utils/ImageCache.js';
 *   ImageCache.load(url, imgElement);
 */

const MAX_CACHE_SIZE = 400;
const MAX_CONCURRENT = 4;   // max parallel fetches

class _ImageCache {
    constructor() {
        /** @type {Map<string, string>} URL → objectURL of decoded blob */
        this._cache = new Map();
        /** @type {Map<string, Promise<string>>} URL → in-flight fetch promise */
        this._inflight = new Map();
        /** @type {Array<{url: string, img: HTMLImageElement}>} */
        this._queue = [];
        this._activeCount = 0;
    }

    /**
     * Load an image URL and apply it to an <img> element.
     * Concurrency-limited and cached.
     * @param {string} url
     * @param {HTMLImageElement} img
     */
    load(url, img) {
        if (!url || !img) return;

        // Already cached — instant apply, no async needed
        if (this._cache.has(url)) {
            this._promote(url);
            img.src = this._cache.get(url);
            img.classList.add('mcard__poster-img--loaded');
            return;
        }

        // Queue the request
        this._queue.push({ url, img });
        this._drain();
    }

    /**
     * Cancel pending loads for an image element (e.g. when it scrolls out of view).
     * @param {HTMLImageElement} img
     */
    cancel(img) {
        this._queue = this._queue.filter(entry => entry.img !== img);
    }

    /**
     * Process queued items up to concurrency limit.
     * Uses LIFO (pop) so the MOST RECENTLY requested images
     * (the ones currently on screen) load first.
     */
    _drain() {
        while (this._activeCount < MAX_CONCURRENT && this._queue.length > 0) {
            const { url, img } = this._queue.pop();  // LIFO — newest first

            // Skip images whose DOM nodes were removed by VirtualList scroll
            if (!img.isConnected) continue;

            this._processOne(url, img);
        }
    }

    async _processOne(url, img) {
        // Skip if element was removed from DOM while waiting
        if (!img.isConnected) {
            this._drain();
            return;
        }

        // Check cache again (might have been cached while queued)
        if (this._cache.has(url)) {
            this._promote(url);
            img.src = this._cache.get(url);
            img.classList.add('mcard__poster-img--loaded');
            this._drain();
            return;
        }

        // If already in-flight, piggyback on the existing fetch
        if (this._inflight.has(url)) {
            try {
                const objectUrl = await this._inflight.get(url);
                if (img.isConnected) {
                    img.src = objectUrl;
                    img.classList.add('mcard__poster-img--loaded');
                }
            } catch (_) {
                if (img.isConnected) img.style.display = 'none';
            }
            // Don't decrement activeCount — the original fetch owns the slot
            this._drain();
            return;
        }

        // New fetch — occupy a concurrency slot
        this._activeCount++;

        const promise = this._fetch(url);
        this._inflight.set(url, promise);

        try {
            const objectUrl = await promise;
            // Only apply if element is still in the DOM
            if (img.isConnected) {
                img.src = objectUrl;
                img.classList.add('mcard__poster-img--loaded');
            }
        } catch (_) {
            if (img.isConnected) img.style.display = 'none';
        } finally {
            this._inflight.delete(url);
            this._activeCount--;
            this._drain(); // kick next item in queue
        }
    }

    /**
     * @param {string} url
     * @returns {Promise<string>} objectURL
     */
    async _fetch(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();

        // Decode bitmap off main thread (where supported)
        if (typeof createImageBitmap === 'function') {
            try {
                const bmp = await createImageBitmap(blob);
                bmp.close(); // free bitmap — we only needed the decode step
            } catch (_) { /* non-image blob, objectURL still works */ }
        }

        const objectUrl = URL.createObjectURL(blob);
        this._put(url, objectUrl);
        return objectUrl;
    }

    /** Add to cache, evict LRU if over limit */
    _put(url, objectUrl) {
        if (this._cache.size >= MAX_CACHE_SIZE) {
            const oldest = this._cache.keys().next().value;
            const oldUrl = this._cache.get(oldest);
            URL.revokeObjectURL(oldUrl);
            this._cache.delete(oldest);
        }
        this._cache.set(url, objectUrl);
    }

    /** Move key to end (most recently used) */
    _promote(url) {
        const val = this._cache.get(url);
        this._cache.delete(url);
        this._cache.set(url, val);
    }

    /** Clear entire cache and cancel pending queue */
    clear() {
        this._queue.length = 0;
        for (const objectUrl of this._cache.values()) {
            URL.revokeObjectURL(objectUrl);
        }
        this._cache.clear();
        this._inflight.clear();
    }
}

export default new _ImageCache();
