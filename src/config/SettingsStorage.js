/**
 * Local storage adapter for application settings.
 * This module owns all direct interaction with `localStorage`.
 */

const STORAGE_KEY = 'iptv_settings';

class SettingsStorage {
    /**
     * Loads raw settings JSON from storage.
     * @returns {Object|null} Parsed settings object, or null if not found / on error.
     */
    static load() {
        if (typeof localStorage === 'undefined') return null;

        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return null;
            return JSON.parse(stored);
        } catch (error) {
            console.error('[SettingsStorage] Failed to load settings:', error);
            return null;
        }
    }

    /**
     * Persists settings JSON to storage.
     * @param {Object} data
     */
    static save(data) {
        if (typeof localStorage === 'undefined') return;

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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

