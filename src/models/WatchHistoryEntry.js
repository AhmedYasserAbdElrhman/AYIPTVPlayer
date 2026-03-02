/**
 * WatchHistoryEntry — data model for watch history items.
 *
 * Composite ID format:
 *   movie:{streamId}  |  episode:{seriesId}:{season}:{episodeId}  |  live:{streamId}
 */

class WatchHistoryEntry {
    constructor(raw = {}) {
        this.id = raw.id || '';
        this.contentId = raw.contentId || '';
        this.contentType = raw.contentType || 'movie'; // live | movie | episode

        // Display
        this.name = raw.name || '';
        this.meta = raw.meta || '';
        this.thumbnail = raw.thumbnail || '';
        this.url = raw.url || '';

        // Series-specific
        this.seriesId = raw.seriesId || null;
        this.seriesName = raw.seriesName || null;
        this.season = raw.season || null;
        this.episodeIdx = raw.episodeIdx ?? null;

        // Timestamps
        this.lastWatchedAt = raw.lastWatchedAt || Date.now();
        this.addedAt = raw.addedAt || Date.now();
    }

    /**
     * Creates an entry from an enriched PLAY_REQUEST detail object.
     */
    static fromPlayRequest(detail) {
        const entry = new WatchHistoryEntry({
            contentId: detail.contentId || '',
            contentType: detail.contentType || 'movie',
            name: detail.title || '',
            meta: detail.subtitle || '',
            thumbnail: detail.thumbnail || '',
            url: detail.url || '',
            seriesId: detail.seriesId || null,
            seriesName: detail.seriesName || detail.title || null,
            season: detail.season || null,
            episodeIdx: detail.episodeIdx ?? null,
        });

        entry.id = entry._generateId();
        return entry;
    }

    /**
     * Converts to the format expected by RecentCard / HomePage.
     * @param {{ percentage: number } | null} progress
     */
    toRecentCard(progress) {
        const isSeries = this.contentType === 'episode';
        return {
            id: this.id,
            name: isSeries ? (this.seriesName || this.name) : this.name,
            meta: isSeries ? ('S' + this.season + ' · E' + ((this.episodeIdx ?? 0) + 1)) : this.meta,
            type: isSeries ? 'series' : this.contentType,
            thumbnail: this.thumbnail,
            progress: progress?.percentage || 0,
        };
    }

    /**
     * Returns the key used for PlaybackProgressService.
     * Per-episode for series (so each episode tracks independently),
     * same as ID for movies/live.
     */
    getProgressKey() {
        if (this.contentType === 'episode') {
            return `episode:${this.seriesId}:${this.season}:${this.contentId}`;
        }
        return this.id;
    }

    static fromList(rawList) {
        if (!Array.isArray(rawList)) return [];
        return rawList.map(item => new WatchHistoryEntry(item));
    }

    // ─── Private ───────────────────────────────────────────────

    _generateId() {
        if (this.contentType === 'episode') {
            return `series:${this.seriesId}`;
        }
        return `${this.contentType}:${this.contentId}`;
    }
}

export default WatchHistoryEntry;
