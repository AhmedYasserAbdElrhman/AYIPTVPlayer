/**
 * WatchHistoryService — manages watch history persistence.
 *
 * localStorage key: 'iptv_watch_history'
 * Stores up to MAX_ENTRIES items sorted by lastWatchedAt DESC.
 */

import WatchHistoryEntry from '../models/WatchHistoryEntry.js';

const STORAGE_KEY = 'iptv_watch_history';
const MAX_ENTRIES = 50;

class WatchHistoryService {
    constructor() {
        this._cache = null;
    }

    /**
     * Adds or updates a history entry (upsert by ID).
     * Existing entries are moved to the top with updated timestamp.
     */
    add(entry) {
        const history = this._load();
        let addedAt = Date.now();
        let bestEntry = entry; // track the highest episode for this series

        if (entry.contentType === 'episode' && entry.seriesId) {
            // Remove ALL existing entries for this series (handles old episode:... IDs too)
            const sid = String(entry.seriesId);
            for (let i = history.length - 1; i >= 0; i--) {
                const item = history[i];
                if (item.seriesId === sid || item.id === entry.id) {
                    addedAt = item.addedAt || addedAt;
                    // Keep the furthest-ahead episode's metadata
                    if (this._isAhead(item, bestEntry)) {
                        bestEntry = item;
                    }
                    history.splice(i, 1);
                }
            }
        } else {
            const idx = history.findIndex(item => item.id === entry.id);
            if (idx >= 0) {
                addedAt = history[idx].addedAt || addedAt;
                history.splice(idx, 1);
            }
        }

        history.unshift(new WatchHistoryEntry({
            ...bestEntry,
            lastWatchedAt: Date.now(),
            addedAt,
        }));

        if (history.length > MAX_ENTRIES) {
            history.length = MAX_ENTRIES;
        }

        this._save(history);
    }

    /**
     * Returns the most recent N entries.
     */
    getRecent(limit = MAX_ENTRIES) {
        return this._load().slice(0, limit);
    }

    /**
     * Looks up a single entry by composite ID.
     */
    getById(id) {
        return this._load().find(item => item.id === id) || null;
    }

    /**
     * Removes an entry by ID.
     */
    remove(id) {
        const history = this._load().filter(item => item.id !== id);
        this._save(history);
    }

    /**
     * Clears all history.
     */
    clear() {
        this._save([]);
    }

    // ─── Private ───────────────────────────────────────────────

    _isAhead(a, b) {
        const sA = Number(a.season) || 0;
        const sB = Number(b.season) || 0;
        if (sA !== sB) return sA > sB;
        return (a.episodeIdx ?? 0) > (b.episodeIdx ?? 0);
    }

    _load() {
        if (this._cache) return this._cache;

        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            parsed.sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0));
            const entries = WatchHistoryEntry.fromList(parsed);

            // Migrate old episode:... IDs → series:... and deduplicate
            const seen = new Set();
            this._cache = [];
            for (const entry of entries) {
                if (entry.contentType === 'episode' && entry.seriesId) {
                    entry.id = 'series:' + entry.seriesId;
                }
                if (!seen.has(entry.id)) {
                    seen.add(entry.id);
                    this._cache.push(entry);
                }
            }
        } catch (err) {
            console.warn('[WatchHistoryService] Failed to load:', err);
            this._cache = [];
        }

        return this._cache;
    }

    _save(history) {
        this._cache = history;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
        } catch (err) {
            console.error('[WatchHistoryService] Failed to save:', err);
        }
    }
}

export default new WatchHistoryService();
