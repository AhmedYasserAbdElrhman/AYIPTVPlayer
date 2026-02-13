/**
 * Maps low-level auth / network errors to user-facing messages.
 * Pure function, no DOM or logging.
 */

/**
 * Returns a user-friendly error message for login failures.
 *
 * @param {Error & { statusCode?: number }} error
 * @returns {string}
 */
export function getAuthErrorMessage(error) {
    const msg = error?.message || '';

    if (msg.includes('timed out') || msg.includes('abort')) {
        return 'Connection timed out. Check the server address and port.';
    }

    if (msg.includes('Authentication failed') || msg.includes('invalid credentials')) {
        return 'Invalid username or password.';
    }

    if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed')) {
        return 'Cannot reach server. Check your connection.';
    }

    if (msg.includes('Invalid server response')) {
        return 'Server returned an unexpected response.';
    }

    // Fallback to a generic message with the original error text.
    return `Connection failed: ${msg}`;
}

