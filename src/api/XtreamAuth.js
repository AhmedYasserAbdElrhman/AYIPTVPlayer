import client from './XtreamClient.js';
import { Endpoint } from './Router.js';
import Settings from '../config/settings.js';
import AuthResponse from '../models/AuthResponse.js';

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
     * @returns {Promise<AuthResponse>}
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

        const authResponse = AuthResponse.fromApi(data);

        if (!authResponse.userInfo.isAuthenticated()) {
            throw new Error('Authentication failed: invalid credentials');
        }

        this._session = authResponse;

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
        return this._session.userInfo.isExpired();
    }

    getAccountStatus() {
        if (!this._session) return 'Not connected';
        return this._session.userInfo.status || 'Unknown';
    }

    getMaxConnections() {
        if (!this._session) return 0;
        return this._session.userInfo.maxConnections || 0;
    }

    getActiveConnections() {
        if (!this._session) return 0;
        return this._session.userInfo.activeConnections || 0;
    }

    logout() {
        this._session = null;
    }

    /**
     * Attempts to restore session from cached credentials.
     * @returns {Promise<AuthResponse|null>} Returns session if successful, null otherwise
     */
    async restoreSession() {
        try {
            const { host, port, useSSL } = Settings.server;
            const { username, password } = Settings.credentials;

            if (!host || !port || !username || !password) {
                return null;
            }

            return await this.login(host, port, username, password, useSSL);
        } catch (error) {
            console.warn('[XtreamAuth] Failed to restore session:', error.message);
            return null;
        }
    }
}

export default new XtreamAuth();