/**
 * LG WebOS remote key definitions.
 * This module is intentionally LG-specific so we can add other platforms later.
 */

/**
 * Raw LG WebOS keyCode values for common actions.
 * Reference: LG WebOS browser key events.
 *
 * Button → keyCode
 * - Left   → 37
 * - Up     → 38
 * - Right  → 39
 * - Down   → 40
 * - OK     → 13
 * - Back   → 461
 * - Red    → 403
 * - Green  → 404
 * - Yellow → 405
 * - Blue   → 406
 */
export const LG_KEY_CODES = {
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    OK: 13,
    BACK: 461,
    RED: 403,
    GREEN: 404,
    YELLOW: 405,
    BLUE: 406,
};

/**
 * Returns true if the given KeyboardEvent represents the LG "Back" key.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
export function isLgBackKey(e) {
    return e.keyCode === LG_KEY_CODES.BACK || e.key === 'Back' || e.key === 'GoBack';
}

