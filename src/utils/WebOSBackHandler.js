/**
 * WebOS Back Button Handler using History API
 *
 * WebOS TV automatically handles the back button by managing the browser's
 * history stack. When users press back, a `popstate` event is fired.
 * This handler manages navigation by tracking page transitions.
 */

class WebOSBackHandler {
    constructor() {
        this._isInstalled = false;
        this._currentPage = null;
    }

    /**
     * Install the WebOS back button handler using History API
     */
    install() {
        if (this._isInstalled) return;

        console.log('[WebOSBackHandler] Installing via History API...');

        // Listen for popstate events (fired when user presses back)
        window.addEventListener('popstate', (event) => {
            console.log('[WebOSBackHandler] popstate event received:', event.state);
            this._handleBackPressed(event.state);
        });

        this._isInstalled = true;
        console.log('[WebOSBackHandler] History API listener installed');
    }

    /**
     * Register a page transition in the history stack
     * Call this when navigating to a new page
     */
    pushPageState(page, data = {}) {
        const state = { page, ...data };
        history.pushState(state, '', window.location.href);
        console.log('[WebOSBackHandler] Pushed state:', state);
    }

    /**
     * Handle back button press
     */
    _handleBackPressed(state) {
        console.log('[WebOSBackHandler] Back button handled, state:', state);
        const backEvent = new CustomEvent('webos:back', {
            bubbles: true,
            cancelable: false,
            detail: { state }
        });
        document.dispatchEvent(backEvent);
    }

    /**
     * Uninstall the handler
     */
    uninstall() {
        if (!this._isInstalled) return;
        this._isInstalled = false;
        console.log('[WebOSBackHandler] Uninstalled');
    }

    /**
     * Trigger app exit
     */
    static exitApp() {
        if (window.webOS && window.webOS.platformBack) {
            console.log('[WebOSBackHandler] Exiting app via webOS.platformBack');
            window.webOS.platformBack();
        } else {
            console.warn('[WebOSBackHandler] webOS.platformBack not available');
        }
    }
}

export default new WebOSBackHandler();
