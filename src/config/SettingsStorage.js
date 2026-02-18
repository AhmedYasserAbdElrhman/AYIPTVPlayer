/**
 * Local storage adapter for application settings.
 *
 * Credentials are encrypted at rest using AES-256-GCM (Web Crypto API)
 * per WebOS Privacy Guideline and NIST SP 800-131A Rev 2.
 *
 * Storage format v2: credentials field is a base64-encoded ciphertext.
 * Legacy v1 (plain text) is auto-migrated on first load.
 */

import CryptoHelper from '../utils/CryptoHelper.js';

const STORAGE_KEY = 'iptv_settings';
const STORAGE_VERSION = 2;

class SettingsStorage {
    /**
     * Loads settings from storage, decrypting credentials.
     * @returns {Promise<Object|null>}
     */
    static async load() {
        if (typeof localStorage === 'undefined') return null;

        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return null;

            const data = JSON.parse(stored);

            if (data._version >= STORAGE_VERSION && typeof data.credentials === 'string') {
                data.credentials = JSON.parse(
                    await CryptoHelper.decrypt(data.credentials),
                );
            }
            // else: legacy plain-text credentials — re-encrypted on next save

            delete data._version;
            return data;
        } catch (error) {
            console.error('[SettingsStorage] Failed to load settings:', error);
            return null;
        }
    }

    /**
     * Persists settings to storage, encrypting credentials.
     * @param {Object} data
     * @returns {Promise<void>}
     */
    static async save(data) {
        if (typeof localStorage === 'undefined') return;

        try {
            const toStore = { ...data, _version: STORAGE_VERSION };

            if (toStore.credentials) {
                toStore.credentials = await CryptoHelper.encrypt(
                    JSON.stringify(toStore.credentials),
                );
            }

            localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
        } catch (error) {
            console.error('[SettingsStorage] Failed to save settings:', error);
        }
    }

    /**
     * Clears settings from storage.
     */
    static clear() {
        if (typeof localStorage === 'undefined') return;

        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            console.error('[SettingsStorage] Failed to clear settings:', error);
        }
    }
}

export default SettingsStorage;
