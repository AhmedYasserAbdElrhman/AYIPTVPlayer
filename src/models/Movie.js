/**
 * Data model for a VOD (Movie) item.
 * Pure data transformation — no business logic, no side effects.
 */
class Movie {
    /**
     * @param {Object} raw - Raw VOD object from API
     */
    constructor(raw = {}) {
        this.id = raw.stream_id || 0;
        this.name = raw.name || '';
        this.icon = raw.stream_icon || '';
        this.categoryId = raw.category_id || '';
        this.categoryName = raw.category_name || '';
        this.containerExtension = raw.container_extension || 'mp4';
        this.rating = parseFloat(raw.rating) || 0;
        this.rating5Based = parseFloat(raw.rating_5based) || 0;
        this.added = raw.added ? new Date(Number(raw.added) * 1000) : null;
        this.isAdult = Number(raw.is_adult) === 1;
        this.plot = raw.plot || '';
        this.cast = raw.cast || '';
        this.director = raw.director || '';
        this.genre = raw.genre || '';
        this.releaseDate = raw.releaseDate || raw.release_date || '';
        this.duration = raw.episode_run_time || raw.duration || '';
        this.youtubeTrailer = raw.youtube_trailer || '';
        this.tmdbId = raw.tmdb_id || '';
    }

    /**
     * Creates a Movie from a raw API object.
     * @param {Object} raw
     * @returns {Movie}
     */
    static fromApi(raw) {
        return new Movie(raw);
    }

    /**
     * Creates a Movie from detailed VOD info response.
     * Merges stream data with info metadata.
     * @param {Object} infoResponse - Full get_vod_info response
     * @returns {Movie}
     */
    static fromInfoApi(infoResponse) {
        const info = infoResponse.info || {};
        const movieData = infoResponse.movie_data || {};
        return new Movie({ ...movieData, ...info });
    }

    /**
     * Creates an array of Movies from raw API data.
     * @param {Array<Object>} rawList
     * @returns {Movie[]}
     */
    static fromApiList(rawList) {
        if (!Array.isArray(rawList)) return [];
        return rawList.map(item => Movie.fromApi(item));
    }
}

export default Movie;