/**
 * Data models for the Xtream Codes authentication / server-info response.
 * Responsible only for shaping and mildly normalising raw API data.
 */

class AuthUserInfo {
    /**
     * @param {Object} raw - Raw user_info object from API
     */
    constructor(raw = {}) {
        this.username = raw.username || '';
        this.password = raw.password || '';
        this.message = raw.message || '';

        // Normalised numeric / boolean flags
        this.auth = Number(raw.auth ?? 0);
        this.status = raw.status || '';

        this.expiryTimestamp = raw.exp_date != null ? Number(raw.exp_date) : null; // seconds since epoch
        this.isTrial = raw.is_trial === '1' || raw.is_trial === 1;

        this.activeConnections = Number(raw.active_cons ?? 0);
        this.maxConnections = Number(raw.max_connections ?? 0);

        this.createdTimestamp = raw.created_at != null ? Number(raw.created_at) : null; // seconds since epoch

        this.allowedOutputFormats = Array.isArray(raw.allowed_output_formats)
            ? raw.allowed_output_formats
            : [];
    }

    /**
     * Convenience: returns true if auth flag indicates success.
     * @returns {boolean}
     */
    isAuthenticated() {
        return this.auth === 1;
    }

    /**
     * Returns true if the account appears to be expired relative to now.
     * If expiryTimestamp is missing, returns false (treat as non‑expiring).
     * @param {number} [nowSeconds] - Optional current time in seconds.
     * @returns {boolean}
     */
    isExpired(nowSeconds = Date.now() / 1000) {
        if (this.expiryTimestamp == null) return false;
        return nowSeconds > this.expiryTimestamp;
    }
}

class AuthServerInfo {
    /**
     * @param {Object} raw - Raw server_info object from API
     */
    constructor(raw = {}) {
        this.url = raw.url || '';
        this.port = raw.port || '';
        this.httpsPort = raw.https_port || '';
        this.serverProtocol = raw.server_protocol || '';
        this.rtmpPort = raw.rtmp_port || '';
        this.timezone = raw.timezone || '';

        this.timestampNow = typeof raw.timestamp_now === 'number'
            ? raw.timestamp_now
            : null;

        this.timeNow = raw.time_now || '';

        // Some panels send boolean, others 0/1
        this.process = typeof raw.process === 'boolean'
            ? raw.process
            : raw.process === 1 || raw.process === '1';
    }
}

class AuthResponse {
    /**
     * @param {AuthUserInfo} userInfo
     * @param {AuthServerInfo} serverInfo
     */
    constructor(userInfo, serverInfo) {
        this.userInfo = userInfo;
        this.serverInfo = serverInfo;
    }

    /**
     * Builds an AuthResponse from the full serverInfo endpoint payload.
     * @param {Object} raw - Full JSON response from serverInfo()
     * @returns {AuthResponse}
     */
    static fromApi(raw = {}) {
        const userInfo = new AuthUserInfo(raw.user_info || {});
        const serverInfo = new AuthServerInfo(raw.server_info || {});
        return new AuthResponse(userInfo, serverInfo);
    }
}

export { AuthResponse, AuthUserInfo, AuthServerInfo };
export default AuthResponse;

