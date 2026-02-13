import client from './XtreamClient.js';
import { Endpoint } from './Router.js';
import Settings from '../config/settings.js';

/**
 * Handles authentication and connection verification.
 */
class XtreamAuth {
    constructor() {
        this._session = null;
    }

    /**
     * Authenticates with the server.
     * @param {string} host
     * @param {string} port
     * @param {string} username
     * @param {string} password
     * @param {boolean} [useSSL=false]
     * @returns {Promise<{ userInfo: Object, serverInfo: Object }>}
     */
    async login(host, port, username, password, useSSL = false) {
        Settings.setServer(host, port, useSSL);
        Settings.setCredentials(username, password);

        const validation = Settings.validate();
        if (!validation.valid) {
            throw new Error(`Missing required fields: ${validation.missing.join(', ')}`);
        }

        const data = await client.execute(Endpoint.serverInfo(), {
            requestId: 'auth_login',
        });

        if (!data || !data.user_info) {
            throw new Error('Invalid server response: missing user_info');
        }

        if (data.user_info.auth === 0) {
            throw new Error('Authentication failed: invalid credentials');
        }

        this._session = {
            userInfo: data.user_info,
            serverInfo: data.server_info || {},
        };

        return this._session;
    }

    getSession() {
        return this._session;
    }

    isAuthenticated() {
        return this._session !== null;
    }

    isExpired() {
        if (!this._session) return true;
        const expiry = this._session.userInfo.exp_date;
        if (!expiry) return false;
        return Date.now() / 1000 > Number(expiry);
    }

    getAccountStatus() {
        if (!this._session) return 'Not connected';
        return this._session.userInfo.status || 'Unknown';
    }

    getMaxConnections() {
        if (!this._session) return 0;
        return Number(this._session.userInfo.max_connections) || 0;
    }

    getActiveConnections() {
        if (!this._session) return 0;
        return Number(this._session.userInfo.active_cons) || 0;
    }

    logout() {
        this._session = null;
    }
}

export default new XtreamAuth();