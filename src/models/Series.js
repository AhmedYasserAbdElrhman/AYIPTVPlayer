/**
 * Data model for a TV Series item.
 * Pure data transformation — no business logic, no side effects.
 */
class Series {
    /**
     * @param {Object} raw - Raw series object from API
     */
    constructor(raw = {}) {
        this.id = raw.series_id || 0;
        this.name = raw.name || '';
        this.cover = raw.cover || '';
        this.plot = raw.plot || '';
        this.cast = raw.cast || '';
        this.director = raw.director || '';
        this.genre = raw.genre || '';
        this.releaseDate = raw.releaseDate || raw.release_date || '';
        this.rating = parseFloat(raw.rating) || 0;
        this.rating5Based = parseFloat(raw.rating_5based) || 0;
        this.categoryId = raw.category_id || '';
        this.categoryName = raw.category_name || '';
        this.youtubeTrailer = raw.youtube_trailer || '';
        this.tmdbId = raw.tmdb_id || '';
        this.backdropPath = raw.backdrop_path || [];
        this.lastModified = raw.last_modified || '';

        /** @type {Object<string, Object>} - Keyed by season number */
        this.seasons = {};
        /** @type {Object<string, Episode[]>} - Keyed by season number */
        this.episodes = {};
    }

    /**
     * Creates a Series from a raw API listing object.
     * @param {Object} raw
     * @returns {Series}
     */
    static fromApi(raw) {
        return new Series(raw);
    }

    /**
     * Creates a fully detailed Series from get_series_info response.
     * Includes seasons and episodes.
     * @param {Object} infoResponse
     * @returns {Series}
     */
    static fromInfoApi(infoResponse) {
        const info = infoResponse.info || {};
        const series = new Series(info);

        // Build a lookup from the seasons array for metadata
        const seasonMeta = {};
        if (Array.isArray(infoResponse.seasons)) {
            for (const s of infoResponse.seasons) {
                seasonMeta[s.season_number] = s;
            }
        }

        // Build seasons and episodes from the episodes keys
        if (infoResponse.episodes) {
            for (const [seasonNum, episodeList] of Object.entries(infoResponse.episodes)) {
                const meta = seasonMeta[seasonNum] || {};

                series.episodes[seasonNum] = Array.isArray(episodeList)
                    ? episodeList.map(ep => Episode.fromApi(ep))
                    : [];

                series.seasons[seasonNum] = {
                    id: meta.id || null,
                    name: meta.name || `Season ${seasonNum}`,
                    cover: meta.cover || series.cover,
                    coverBig: meta.cover_big || '',
                    overview: meta.overview || '',
                    airDate: meta.air_date || '',
                    episodeCount: series.episodes[seasonNum].length,
                };
            }
        }

        return series;
    }

    /**
     * Creates an array of Series from raw API data.
     * @param {Array<Object>} rawList
     * @returns {Series[]}
     */
    static fromApiList(rawList) {
        if (!Array.isArray(rawList)) return [];
        return rawList.map(item => Series.fromApi(item));
    }
}

/**
 * Data model for a single episode within a series.
 */
class Episode {
    /**
     * @param {Object} raw
     */
    constructor(raw = {}) {
        this.id = raw.id || '';
        this.episodeNum = Number(raw.episode_num) || 0;
        this.title = raw.title || '';
        this.containerExtension = raw.container_extension || 'mp4';
        this.duration = raw.duration || '';
        this.durationSecs = Number(raw.duration_secs) || 0;
        this.plot = raw.info?.plot || raw.plot || '';
        this.rating = parseFloat(raw.info?.rating || raw.rating) || 0;
        this.releaseDate = raw.info?.releasedate || raw.releasedate || '';
        this.coverBig = raw.info?.movie_image || raw.info?.cover_big || '';
        this.added = raw.added ? new Date(Number(raw.added) * 1000) : null;
        this.season = Number(raw.season) || 0;
    }

    /**
     * Creates an Episode from a raw API object.
     * @param {Object} raw
     * @returns {Episode}
     */
    static fromApi(raw) {
        return new Episode(raw);
    }
}

export { Series, Episode };
export default Series;
