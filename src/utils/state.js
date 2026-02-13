/**
 * Simple reactive state management for the UI layer.
 * 
 * Purpose:
 * - Provides global reactive state for UI components
 * - Components subscribe to state changes and re-render when data updates
 * - Inspired by React's useState but for vanilla JS
 * - Lightweight — no framework dependency
 * 
 * Used by: All UI components (ChannelList, MovieList, VideoPlayer, etc.)
 * 
 * @example
 * // In a component:
 * const [getChannels, setChannels] = State.useState('channels', []);
 * const [getLoading, setLoading]   = State.useState('loading', false);
 * 
 * // Subscribe to changes:
 * State.subscribe('channels', (newChannels) => renderChannelList(newChannels));
 * 
 * // Update state (triggers all subscribers):
 * setChannels(fetchedChannels);
 */
class StateManager {
    constructor() {
        /** @type {Map<string, { value: any, listeners: Set<Function> }>} */
        this._states = new Map();
    }

    // ─── Core State API ────────────────────────────────────────────

    /**
     * Creates or retrieves a reactive state.
     * Returns a getter/setter pair — just like React's useState.
     * @param {string} key - Unique state identifier
     * @param {any} initialValue - Initial value if state doesn't exist yet
     * @returns {[() => any, (newValue: any) => void]} [getter, setter]
     * 
     * @example
     * const [getTheme, setTheme] = State.useState('theme', 'dark');
     * console.log(getTheme());  // 'dark'
     * setTheme('light');
     * console.log(getTheme());  // 'light'
     */
    useState(key, initialValue) {
        if (!this._states.has(key)) {
            this._states.set(key, {
                value: initialValue,
                listeners: new Set(),
            });
        }

        const state = this._states.get(key);

        const getter = () => state.value;

        const setter = (newValue) => {
            const oldValue = state.value;

            // Support functional updates: setState(prev => prev + 1)
            state.value = typeof newValue === 'function'
                ? newValue(oldValue)
                : newValue;

            // Only notify if value actually changed
            if (state.value !== oldValue) {
                this._notify(key, state.value, oldValue);
            }
        };

        return [getter, setter];
    }

    /**
     * Gets the current value of a state without creating it.
     * @param {string} key
     * @returns {any} Current value or undefined
     * 
     * @example
     * const channels = State.getState('channels');
     */
    getState(key) {
        return this._states.get(key)?.value;
    }

    /**
     * Sets a state value directly.
     * Creates the state if it doesn't exist.
     * @param {string} key
     * @param {any} value
     * 
     * @example
     * State.setState('loading', true);
     */
    setState(key, value) {
        const [, setter] = this.useState(key, value);
        setter(value);
    }

    // ─── Subscription API ──────────────────────────────────────────

    /**
     * Subscribes to changes for a specific state key.
     * @param {string} key
     * @param {(newValue: any, oldValue: any) => void} callback
     * @returns {() => void} Unsubscribe function (call to stop listening)
     * 
     * @example
     * const unsub = State.subscribe('channels', (channels, oldChannels) => {
     *     renderChannelList(channels);
     * });
     * 
     * // Later, to stop listening:
     * unsub();
     */
    subscribe(key, callback) {
        if (!this._states.has(key)) {
            this._states.set(key, { value: undefined, listeners: new Set() });
        }

        const state = this._states.get(key);
        state.listeners.add(callback);

        // Return unsubscribe function
        return () => state.listeners.delete(callback);
    }

    /**
     * Subscribes to multiple state keys at once.
     * Callback receives an object with all current values when ANY of them changes.
     * @param {string[]} keys
     * @param {(values: Object) => void} callback
     * @returns {() => void} Unsubscribe function for all subscriptions
     * 
     * @example
     * const unsub = State.subscribeMany(['channels', 'selectedCategory'], (values) => {
     *     console.log(values.channels, values.selectedCategory);
     * });
     */
    subscribeMany(keys, callback) {
        const unsubscribers = keys.map(key =>
            this.subscribe(key, () => {
                const values = {};
                for (const k of keys) {
                    values[k] = this.getState(k);
                }
                callback(values);
            })
        );

        // Return single unsubscribe function that removes all
        return () => unsubscribers.forEach(unsub => unsub());
    }

    /**
     * Subscribes to a state change and fires ONLY ONCE, then auto-unsubscribes.
     * Useful for waiting for initial data load.
     * @param {string} key
     * @param {(newValue: any) => void} callback
     * @returns {() => void} Unsubscribe function (cancel before it fires)
     * 
     * @example
     * // Wait for first load of channels, then stop listening
     * State.subscribeOnce('channels', (channels) => {
     *     showInitialScreen(channels);
     * });
     */
    subscribeOnce(key, callback) {
        const unsub = this.subscribe(key, (newValue, oldValue) => {
            unsub();
            callback(newValue, oldValue);
        });

        return unsub;
    }

    // ─── Computed / Derived State ──────────────────────────────────

    /**
     * Creates a computed/derived state that automatically updates
     * when its dependencies change.
     * @param {string} key - Key for the computed state
     * @param {string[]} dependencies - Keys of states this depends on
     * @param {(values: Object) => any} computeFn - Function to compute the derived value
     * @returns {() => void} Cleanup function
     * 
     * @example
     * // Derived state: filtered channels based on selected category
     * State.computed('filteredChannels', ['channels', 'selectedCategory'], (values) => {
     *     const { channels, selectedCategory } = values;
     *     if (!selectedCategory) return channels;
     *     return channels.filter(ch => ch.categoryId === selectedCategory);
     * });
     * 
     * // Now 'filteredChannels' auto-updates when channels or selectedCategory changes
     * State.subscribe('filteredChannels', (filtered) => renderList(filtered));
     */
    computed(key, dependencies, computeFn) {
        const compute = () => {
            const values = {};
            for (const dep of dependencies) {
                values[dep] = this.getState(dep);
            }
            this.setState(key, computeFn(values));
        };

        // Initial computation
        compute();

        // Recompute when any dependency changes
        const unsubscribers = dependencies.map(dep =>
            this.subscribe(dep, compute)
        );

        return () => unsubscribers.forEach(unsub => unsub());
    }

    // ─── Batch Updates ─────────────────────────────────────────────

    /**
     * Batches multiple state updates into a single notification cycle.
     * Prevents unnecessary re-renders when updating multiple related states.
     * @param {() => void} updateFn - Function containing multiple setState calls
     * 
     * @example
     * // Without batch: triggers 3 separate re-renders
     * State.setState('loading', false);
     * State.setState('channels', data);
     * State.setState('error', null);
     * 
     * // With batch: triggers only 1 re-render cycle
     * State.batch(() => {
     *     State.setState('loading', false);
     *     State.setState('channels', data);
     *     State.setState('error', null);
     * });
     */
    batch(updateFn) {
        this._batching = true;
        this._batchQueue = new Map();

        try {
            updateFn();
        } finally {
            this._batching = false;

            // Flush all queued notifications
            for (const [key, { newValue, oldValue }] of this._batchQueue) {
                this._notify(key, newValue, oldValue);
            }

            this._batchQueue = null;
        }
    }

    // ─── State Lifecycle ───────────────────────────────────────────

    /**
     * Removes a state and all its listeners.
     * @param {string} key
     */
    removeState(key) {
        this._states.delete(key);
    }

    /**
     * Checks if a state exists (has been created via useState or setState).
     * @param {string} key
     * @returns {boolean}
     */
    hasState(key) {
        return this._states.has(key);
    }

    /**
     * Returns all current state keys.
     * Useful for debugging.
     * @returns {string[]}
     */
    keys() {
        return Array.from(this._states.keys());
    }

    /**
     * Returns a snapshot of all states (for debugging or serialization).
     * @returns {Object}
     * 
     * @example
     * console.log(State.snapshot());
     * // { channels: [...], loading: false, selectedCategory: '5', theme: 'dark' }
     */
    snapshot() {
        const snap = {};
        for (const [key, state] of this._states) {
            snap[key] = state.value;
        }
        return snap;
    }

    /**
     * Clears all states and listeners.
     * Use when navigating away or resetting the app.
     */
    clear() {
        this._states.clear();
    }

    // ─── Private ───────────────────────────────────────────────────

    /**
     * Notifies all listeners for a given state key.
     * Respects batch mode — queues notifications during batch.
     * @param {string} key
     * @param {any} newValue
     * @param {any} oldValue
     * @private
     */
    _notify(key, newValue, oldValue) {
        // If batching, queue the notification
        if (this._batching) {
            this._batchQueue.set(key, { newValue, oldValue });
            return;
        }

        const state = this._states.get(key);
        if (!state) return;

        for (const listener of state.listeners) {
            try {
                listener(newValue, oldValue);
            } catch (error) {
                console.error(`Error in state listener for "${key}":`, error);
            }
        }
    }
}

// Export singleton instance
export default new StateManager();