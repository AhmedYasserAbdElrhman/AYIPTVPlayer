/**
 * PlaybackProgressService — tracks playback position for VOD content.
 *
 * localStorage key: 'iptv_playback_progress'
 * Storage shape: { [entryId]: { currentTime, duration, percentage, updatedAt } }
 *
 * - Throttled saves (MIN_SAVE_INTERVAL between writes)
 * - Auto-clears at COMPLETION_THRESHOLD (95%)
 * - Auto-prunes entries older than STALE_DAYS (30)
 */

const STORAGE_KEY = 'iptv_playback_progress';
const MIN_SAVE_INTERVAL = 5000;
const COMPLETION_THRESHOLD = 95;
const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

class PlaybackProgressService {
    constructor() {
        this._cache = null;
        this._lastSaveTime = {};
    }

    /**
     * Saves playback position.
     * @param {string} entryId
     * @param {number} currentTime — seconds
     * @param {number} duration — seconds
     */
    save(entryId, currentTime, duration) {
        const now = Date.now();
        if (this._lastSaveTime[entryId] && (now - this._lastSaveTime[entryId]) < MIN_SAVE_INTERVAL) {
            return;
        }

        const progress = this._load();
        const percentage = duration > 0 ? Math.floor((currentTime / duration) * 100) : 0;

        // Don't overwrite with a lower position (e.g. user replayed from beginning)
        const existing = progress[entryId];
        if (existing && currentTime < existing.currentTime && percentage < COMPLETION_THRESHOLD) {
            return;
        }

        if (percentage >= COMPLETION_THRESHOLD) {
            delete progress[entryId];
        } else {
            progress[entryId] = {
                currentTime: Math.floor(currentTime),
                duration: Math.floor(duration),
                percentage,
                updatedAt: now,
            };
        }

        this._save(progress);
        this._lastSaveTime[entryId] = now;
    }

    /**
     * Gets saved progress for an entry, or null if none / stale.
     */
    get(entryId) {
        const progress = this._load();
        const data = progress[entryId];
        if (!data) return null;

        if (Date.now() - data.updatedAt > STALE_MS) {
            delete progress[entryId];
            this._save(progress);
            return null;
        }

        return data;
    }

    /**
     * Clears progress for a single entry.
     */
    clear(entryId) {
        const progress = this._load();
        delete progress[entryId];
        this._save(progress);
    }

    /**
     * Force-saves without throttle (used on player exit).
     */
    saveImmediate(entryId, currentTime, duration) {
        this._lastSaveTime[entryId] = 0;
        this.save(entryId, currentTime, duration);
    }

    // ─── Private ───────────────────────────────────────────────

    _load() {
        if (this._cache) return this._cache;

        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            this._cache = raw ? JSON.parse(raw) : {};
        } catch (err) {
            console.warn('[PlaybackProgressService] Failed to load:', err);
            this._cache = {};
        }

        return this._cache;
    }

    _save(progress) {
        this._cache = progress;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
        } catch (err) {
            console.error('[PlaybackProgressService] Failed to save:', err);
        }
    }
}

export default new PlaybackProgressService();
