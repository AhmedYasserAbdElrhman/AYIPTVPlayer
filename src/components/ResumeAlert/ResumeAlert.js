/**
 * ResumeAlert — non-blocking overlay for playback resume prompt.
 *
 * Shows on top of a playing video (does NOT pause playback).
 * Auto-dismisses after 8 seconds, defaulting to "start from beginning".
 * Remote: Left/Right to select, OK to confirm, Back to dismiss.
 *
 * Usage:
 *   const alert = new ResumeAlert();
 *   const shouldResume = await alert.show(container, savedSeconds);
 *   if (shouldResume) video.currentTime = savedSeconds;
 */

import TemplateEngine from '../../utils/templateEngine.js';
import { mapRemoteEvent } from '../../input/RemoteKeyMapper.js';
import { RemoteActions } from '../../input/RemoteActions.js';

const AUTO_DISMISS_MS = 8000;

class ResumeAlert {
    constructor() {
        this._overlay = null;
        this._els = {};
        this._resolve = null;
        this._keyHandler = this._onKey.bind(this);
        this._dismissTimer = null;
        this._selected = 0; // 0 = Yes, 1 = No
    }

    /**
     * Shows the resume prompt.
     * @param {HTMLElement} container — parent to append overlay into
     * @param {number} savedTime — seconds to display
     * @returns {Promise<boolean>} true = resume, false = start over
     */
    show(container, savedTime) {
        return new Promise(async (resolve) => {
            this._resolve = resolve;

            // Build overlay wrapper
            const overlay = document.createElement('div');
            overlay.className = 'resume-alert-overlay';
            await TemplateEngine.load('components/ResumeAlert/ResumeAlert.html', overlay);

            this._overlay = overlay;
            this._els = {
                time: overlay.querySelector('.resume-alert__time'),
                yesBtn: overlay.querySelector('#resume-yes'),
                noBtn: overlay.querySelector('#resume-no'),
            };

            this._els.time.textContent = this._formatTime(savedTime);

            // Click handlers
            this._els.yesBtn.addEventListener('click', () => this._dismiss(true));
            this._els.noBtn.addEventListener('click', () => this._dismiss(false));

            container.appendChild(overlay);

            this._selected = 0;
            this._updateFocus();

            // Capture keys (highest priority)
            document.addEventListener('keydown', this._keyHandler, true);

            // Auto-dismiss
            this._dismissTimer = setTimeout(() => this._dismiss(false), AUTO_DISMISS_MS);
        });
    }

    // ─── Private ───────────────────────────────────────────────

    _onKey(e) {
        const action = mapRemoteEvent(e);
        if (!action) return;

        // Consume the event so VideoPlayer doesn't process it
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        switch (action) {
            case RemoteActions.LEFT:
                this._selected = 0;
                this._updateFocus();
                break;
            case RemoteActions.RIGHT:
                this._selected = 1;
                this._updateFocus();
                break;
            case RemoteActions.OK:
                this._dismiss(this._selected === 0);
                break;
            case RemoteActions.BACK:
                this._dismiss(false);
                break;
        }
    }

    _updateFocus() {
        this._els.yesBtn.classList.toggle('focused', this._selected === 0);
        this._els.noBtn.classList.toggle('focused', this._selected === 1);
    }

    _dismiss(resume) {
        clearTimeout(this._dismissTimer);
        document.removeEventListener('keydown', this._keyHandler, true);

        if (this._overlay?.parentNode) {
            this._overlay.remove();
        }

        if (this._resolve) {
            this._resolve(resume);
            this._resolve = null;
        }

        this._overlay = null;
        this._els = {};
    }

    _formatTime(sec) {
        const s = Math.floor(sec);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = s % 60;

        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        }
        return `${m}:${String(ss).padStart(2, '0')}`;
    }
}

export default ResumeAlert;
