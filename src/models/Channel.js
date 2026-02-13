/**
 * Data model for a Live TV channel.
 * Pure data transformation — no business logic, no side effects.
 */
class Channel {
    /**
     * @param {Object} raw - Raw channel object from API
     */
    constructor(raw = {}) {
        this.id = raw.stream_id || 0;
        this.name = raw.name || '';
        this.icon = raw.stream_icon || '';
        this.epgChannelId = raw.epg_channel_id || '';
        this.categoryId = raw.category_id || '';
        this.categoryName = raw.category_name || '';
        this.containerExtension = raw.container_extension || 'm3u8';
        this.isAdult = Number(raw.is_adult) === 1;
        this.added = raw.added ? new Date(Number(raw.added) * 1000) : null;
        this.customSid = raw.custom_sid || '';
        this.tvArchive = Number(raw.tv_archive) === 1;
        this.tvArchiveDuration = Number(raw.tv_archive_duration) || 0;
    }

    /**
     * Creates a Channel from a raw API object.
     * @param {Object} raw
     * @returns {Channel}
     */
    static fromApi(raw) {
        return new Channel(raw);
    }

    /**
     * Creates an array of Channels from raw API data.
     * @param {Array<Object>} rawList
     * @returns {Channel[]}
     */
    static fromApiList(rawList) {
        if (!Array.isArray(rawList)) return [];
        return rawList.map(item => Channel.fromApi(item));
    }
}

export default Channel;