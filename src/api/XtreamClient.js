import Settings from '../config/settings.js';
import { Router } from './Router.js';

/**
 * Low-level HTTP client for Xtream Codes API.
 * Now uses Router for all URL construction.
 */
class XtreamClient {
    constructor() {
        this._abortControllers = new Map();
    }

    /**
     * Executes a request using a Router endpoint.
     * @param {Object} endpoint - Endpoint from Router.Endpoint
     * @param {Object} [options={}]
     * @param {string} [options.requestId] - Unique ID to allow aborting
     * @returns {Promise<any>} Parsed JSON response
     */
    async execute(endpoint, options = {}) {
        const urlRequest = Router.request(endpoint);
        return this._performRequest(urlRequest, options);
    }

    /**
     * Executes a raw URL request (for custom endpoints).
     * @param {URLRequest} urlRequest
     * @param {Object} [options={}]
     * @returns {Promise<any>}
     */
    async executeRequest(urlRequest, options = {}) {
        return this._performRequest(urlRequest, options);
    }

    /**
     * Core request execution with timeout, retries, and error handling.
     * @param {URLRequest} urlRequest
     * @param {Object} options
     * @returns {Promise<any>}
     * @private
     */
    async _performRequest(urlRequest, options = {}) {
        const { timeout, retryAttempts, retryDelay } = Settings.api;
        const { requestId } = options;

        let lastError = null;

        for (let attempt = 0; attempt <= retryAttempts; attempt++) {
            const controller = new AbortController();

            if (requestId) {
                this.abort(requestId);
                this._abortControllers.set(requestId, controller);
            }

            const timeoutId = setTimeout(() => controller.abort(), timeout);

            try {
                const fetchOptions = {
                    ...urlRequest.toFetchOptions(),
                    signal: controller.signal,
                };

                const response = await fetch(urlRequest.url, fetchOptions);

                clearTimeout(timeoutId);
                this._abortControllers.delete(requestId);

                if (!response.ok) {
                    throw new XtreamApiError(
                        `HTTP ${response.status}: ${response.statusText}`,
                        response.status,
                        urlRequest.url
                    );
                }

                const data = await response.json();
                return data;

            } catch (error) {
                clearTimeout(timeoutId);
                this._abortControllers.delete(requestId);

                if (error.name === 'AbortError') {
                    throw new XtreamApiError('Request timed out or was aborted', 0, urlRequest.url);
                }

                lastError = error instanceof XtreamApiError
                    ? error
                    : new XtreamApiError(error.message, 0, urlRequest.url);

                // Don't retry on client errors (4xx)
                if (lastError.statusCode >= 400 && lastError.statusCode < 500) {
                    throw lastError;
                }

                // Wait before retrying
                if (attempt < retryAttempts) {
                    await this._delay(retryDelay * (attempt + 1));
                }
            }
        }

        throw lastError;
    }

    /**
     * Aborts an in-flight request by its ID.
     * @param {string} requestId
     */
    abort(requestId) {
        const controller = this._abortControllers.get(requestId);
        if (controller) {
            controller.abort();
            this._abortControllers.delete(requestId);
        }
    }

    /**
     * Aborts all in-flight requests.
     */
    abortAll() {
        for (const controller of this._abortControllers.values()) {
            controller.abort();
        }
        this._abortControllers.clear();
    }

    /**
     * @param {number} ms
     * @returns {Promise<void>}
     * @private
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Custom error class for Xtream API errors.
 */
class XtreamApiError extends Error {
    /**
     * @param {string} message
     * @param {number} statusCode
     * @param {string} url
     */
    constructor(message, statusCode = 0, url = '') {
        super(message);
        this.name = 'XtreamApiError';
        this.statusCode = statusCode;
        this.url = url;
    }
}

export { XtreamClient, XtreamApiError };
export default new XtreamClient();