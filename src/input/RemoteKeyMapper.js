import { RemoteActions } from './RemoteActions.js';

/**
 * Generic remote key → action mapper.
 * Currently tuned for TV-style remotes (LG WebOS-friendly), but not hard‑wired
 * to any specific platform so it can be reused elsewhere.
 *
 * @param {KeyboardEvent} e
 * @returns {import('./RemoteActions.js').RemoteAction}
 */
export function mapRemoteEvent(e) {
    // Back / exit
    if (e.key === 'Back' || e.key === 'GoBack' || e.key === 'Escape') {
        return RemoteActions.BACK;
    }

    switch (e.key) {
        case 'ArrowUp':
            return RemoteActions.UP;
        case 'ArrowDown':
            return RemoteActions.DOWN;
        case 'ArrowLeft':
            return RemoteActions.LEFT;
        case 'ArrowRight':
            return RemoteActions.RIGHT;
        case 'Enter':
        case 'OK':
            return RemoteActions.OK;
        // Colour keys — names are browser / platform dependent
        case 'Red':
            return RemoteActions.RED;
        case 'Green':
            return RemoteActions.GREEN;
        case 'Yellow':
            return RemoteActions.YELLOW;
        case 'Blue':
            return RemoteActions.BLUE;
        default:
            return RemoteActions.OTHER;
    }
}

