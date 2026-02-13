/**
 * Data model for an EPG (Electronic Program Guide) entry.
 * Pure data transformation — no business logic, no side effects.
 */
class EpgEntry {
    /**
     * @param {Object} raw - Raw EPG listing object from API
     */
    constructor(raw = {}) {
        this.id = raw.id || '';
        this.epgId = raw.epg_id || '';
        this.channelId = raw.channel_id || '';
        this.title = raw.title || '';
        this.lang = raw.lang || '';
        this.description = raw.description || '';
        this.start = raw.start || '';
        this.end = raw.end || '';
        this.startTimestamp = raw.start_timestamp
            ? new Date(raw.start_timestamp * 1000)
            : this._parseDate(raw.start);
        this.stopTimestamp = raw.stop_timestamp
            ? new Date(raw.stop_timestamp * 1000)
            : this._parseDate(raw.end);
    }

    /**
     * Checks if this program is currently airing.
     * @returns {boolean}
     */
    isLive() {
        const now = Date.now();
        const start = this.startTimestamp ? this.startTimestamp.getTime() : 0;
        const end = this.stopTimestamp ? this.stopTimestamp.getTime() : 0;
        return now >= start && now <= end;
    }

    /**
     * Checks if this program is in the future.
     * @returns {boolean}
     */
    isUpcoming() {
        return this.startTimestamp ? this.startTimestamp.getTime() > Date.now() : false;
    }

    /**
     * Returns the duration in minutes.
     * @returns {number}
     */
    getDurationMinutes() {
        if (!this.startTimestamp || !this.stopTimestamp) return 0;
        return Math.round((this.stopTimestamp - this.startTimestamp) / 60000);
    }

    /**
     * Parses a date string. Returns null if invalid.
     * @param {string} dateStr
     * @returns {Date|null}
     * @private
     */
    _parseDate(dateStr) {
        if (!dateStr) return null;
        const parsed = new Date(dateStr);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    /**
     * Creates an EpgEntry from a raw API object.
     * @param {Object} raw
     * @returns {EpgEntry}
     */
    static fromApi(raw) {
        return new EpgEntry(raw);
    }

    /**
     * Creates an array of EpgEntries from raw EPG response.
     * @param {Object} response - The full EPG response (contains epg_listings)
     * @returns {EpgEntry[]}
     */
    static fromApiResponse(response) {
        const listings = response?.epg_listings || [];
        if (!Array.isArray(listings)) return [];
        return listings.map(item => EpgEntry.fromApi(item));
    }
}

export default EpgEntry;