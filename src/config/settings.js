import SettingsStorage from './SettingsStorage.js';

/**
 * Application settings with reactive state management.
 * Supports event listeners for UI updates when settings change.
 */
class Settings {
    constructor() {
        this._listeners = new Set();
        
        this.server = {
            host: '',
            port: '',
            useSSL: false,
        };
        
        this.credentials = {
            username: '',
            password: '',
        };
        
        this.api = {
            timeout: 10000,       // 10 seconds
            retryAttempts: 2,
            retryDelay: 1000,     // 1 second between retries
            cacheTTL: 300000,     // 5 minutes default cache TTL
        };

        this.ui = {
            theme: 'dark',
            language: 'en',
            itemsPerPage: 20,
            autoplay: false,
        };

        this._initialized = false;
    }

    /**
     * Loads settings from encrypted storage.
     * Must be called once during startup before reading credentials.
     */
    async init() {
        if (this._initialized) return;
        await this._loadFromStorage();
        this._initialized = true;
    }

    /**
     * Updates server connection details.
     * @param {string} host
     * @param {string} port
     * @param {boolean} [useSSL=false]
     */
    setServer(host, port, useSSL = false) {
        this.server.host = host.replace(/\/+$/, ''); // strip trailing slashes
        this.server.port = port;
        this.server.useSSL = useSSL;
        this._saveToStorage();
        this._notify('server', this.server);
    }

    /**
     * Updates user credentials.
     * @param {string} username
     * @param {string} password
     */
    setCredentials(username, password) {
        this.credentials.username = username;
        this.credentials.password = password;
        this._saveToStorage();
        this._notify('credentials', this.credentials);
    }

    /**
     * Updates API configuration.
     * @param {Partial<typeof this.api>} apiConfig
     */
    setApiConfig(apiConfig) {
        this.api = { ...this.api, ...apiConfig };
        this._saveToStorage();
        this._notify('api', this.api);
    }

    /**
     * Updates UI preferences.
     * @param {Partial<typeof this.ui>} uiConfig
     */
    setUiConfig(uiConfig) {
        this.ui = { ...this.ui, ...uiConfig };
        this._saveToStorage();
        this._notify('ui', this.ui);
    }

    /**
     * Returns the full base URL for the Xtream server.
     * @returns {string}
     */
    getBaseUrl() {
        const protocol = this.server.useSSL ? 'https' : 'http';
        return `${protocol}://${this.server.host}:${this.server.port}`;
    }

    /**
     * Validates that all required connection details are set.
     * @returns {{ valid: boolean, missing: string[] }}
     */
    validate() {
        const missing = [];
        if (!this.server.host) missing.push('host');
        if (!this.server.port) missing.push('port');
        if (!this.credentials.username) missing.push('username');
        if (!this.credentials.password) missing.push('password');
        return { valid: missing.length === 0, missing };
    }

    /**
     * Exports all settings as a JSON object.
     * @param {boolean} [includeCredentials=false] - Whether to include sensitive data
     * @returns {Object}
     */
    export(includeCredentials = false) {
        const exported = {
            server: { ...this.server },
            api: { ...this.api },
            ui: { ...this.ui },
        };
        
        if (includeCredentials) {
            exported.credentials = { ...this.credentials };
        }
        
        return exported;
    }

    /**
     * Imports settings from a JSON object.
     * @param {Object} data
     */
    import(data) {
        if (data.server) {
            this.server = { ...this.server, ...data.server };
        }
        if (data.credentials) {
            this.credentials = { ...this.credentials, ...data.credentials };
        }
        if (data.api) {
            this.api = { ...this.api, ...data.api };
        }
        if (data.ui) {
            this.ui = { ...this.ui, ...data.ui };
        }
        if (!this._importing) {
            this._saveToStorage();
        }
        this._notify('import', this.export(false));
    }

    /**
     * Subscribes to settings changes.
     * @param {(key: string, value: any) => void} callback
     * @returns {() => void} Unsubscribe function
     */
    subscribe(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    /**
     * Clears all settings and removes from storage.
     */
    reset() {
        this.server = { host: '', port: '', useSSL: false };
        this.credentials = { username: '', password: '' };
        this.ui = { theme: 'dark', language: 'en', itemsPerPage: 20, autoplay: false };
        SettingsStorage.clear();
        this._notify('reset', null);
    }

    /**
     * Loads settings from encrypted storage.
     * @private
     */
    async _loadFromStorage() {
        const data = await SettingsStorage.load();
        if (data) {
            this._importing = true;
            this.import(data);
            this._importing = false;
        }
    }

    /**
     * Saves settings to encrypted storage (fire-and-forget).
     * @private
     */
    _saveToStorage() {
        const data = this.export(true); // include credentials for persistent login
        SettingsStorage.save(data).catch(err =>
            console.error('[Settings] Save failed:', err),
        );
    }

    /**
     * Notifies all subscribers of a change.
     * @param {string} key
     * @param {any} value
     * @private
     */
    _notify(key, value) {
        for (const callback of this._listeners) {
            try {
                callback(key, value);
            } catch (error) {
                console.error('Error in settings listener:', error);
            }
        }
    }
}

// Export singleton instance
export default new Settings();