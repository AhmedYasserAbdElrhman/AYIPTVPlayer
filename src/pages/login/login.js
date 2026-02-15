import Settings from '../../config/settings.js';
import XtreamAuth from '../../api/XtreamAuth.js';
import TemplateEngine from '../../utils/templateEngine.js';
import { validateLogin } from './LoginValidator.js';
import { getAuthErrorMessage } from './AuthErrorMapper.js';
import { mapRemoteEvent } from '../../input/RemoteKeyMapper.js';
import { RemoteActions } from '../../input/RemoteActions.js';
import { EVENTS } from '../../config/AppConstants.js';

/**
 * Login page controller — LG WebOS remote optimised.
 *
 * Navigation is intentionally simple:
 *  - Down  → focus next element (always, even while editing)
 *  - Up    → focus previous element (always, even while editing)
 *  - OK    → if input: open keyboard. if toggle: flip. if button: submit.
 *  - Back  → if editing: close keyboard. else: let platform handle.
 *
 * Inputs use `readonly` to prevent keyboard from opening on focus.
 * Only OK/Enter removes readonly and calls .focus() to trigger IME.
 * Arrow navigation ALWAYS exits edit mode first, then moves.
 */

class LoginPage {
    constructor() {
        this._container = null;
        this._focusIndex = 0;
        this._focusables = [];
        this._isLoading = false;
        this._editingInput = null;  // the input currently being typed into, or null
        this._keyHandler = this._onKeyDown.bind(this);
        this._els = {};
    }

    // ─── Lifecycle ─────────────────────────────────────────────

    async mount(container) {
        this._container = container;
        await TemplateEngine.load('pages/login/login.html', this._container);

        // Make container focusable so we can pull focus away from inputs
        this._container.setAttribute('tabindex', '-1');
        this._container.style.outline = 'none';

        this._cacheDom();
        this._bindEvents();
        this._loadSavedCredentials();
        this._setFocus(0);
    }

    destroy() {
        document.removeEventListener('keydown', this._keyHandler);
        if (this._container) this._container.innerHTML = '';
        this._focusables = [];
        this._els = {};
        this._container = null;
    }

    // ─── DOM References ────────────────────────────────────────

    _cacheDom() {
        this._els = {
            form: this._container.querySelector('#login-form'),
            host: this._container.querySelector('#input-host'),
            port: this._container.querySelector('#input-port'),
            username: this._container.querySelector('#input-username'),
            password: this._container.querySelector('#input-password'),
            ssl: this._container.querySelector('#toggle-ssl'),
            button: this._container.querySelector('#btn-login'),
            status: this._container.querySelector('#login-status'),
            groups: {
                host: this._container.querySelector('#group-host'),
                port: this._container.querySelector('#group-port'),
                username: this._container.querySelector('#group-username'),
                password: this._container.querySelector('#group-password'),
            },
        };

        this._focusables = [
            this._els.host,
            this._els.port,
            this._els.username,
            this._els.password,
            this._els.ssl,
            this._els.button,
        ];
    }

    // ─── Events ────────────────────────────────────────────────

    _bindEvents() {
        document.addEventListener('keydown', this._keyHandler);

        this._els.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this._handleLogin();
        });

        this._focusables.forEach((el, index) => {
            el.addEventListener('click', () => {
                this._setFocus(index);
                if (el.tagName === 'INPUT') {
                    this._enterEditMode(el);
                } else if (el === this._els.ssl) {
                    this._toggleSSL();
                }
            });
        });
    }

    // ─── Key Handling — simple and flat ─────────────────────────

    _onKeyDown(e) {
        if (this._isLoading) return;

        const action = mapRemoteEvent(e);
        const isEditing = this._editingInput !== null;

        // ── ArrowDown: ALWAYS exit editing + move to next ──
        if (action === RemoteActions.DOWN) {
            e.preventDefault();
            e.stopPropagation();
            if (isEditing) this._exitEditMode();
            this._focusNext();
            return;
        }

        // ── ArrowUp: ALWAYS exit editing + move to previous ──
        if (action === RemoteActions.UP) {
            e.preventDefault();
            e.stopPropagation();
            if (isEditing) this._exitEditMode();
            this._focusPrev();
            return;
        }

        // ── Back key: exit editing if active, otherwise let platform handle ──
        if (action === RemoteActions.BACK) {
            if (isEditing) {
                e.preventDefault();
                e.stopPropagation();
                this._exitEditMode();
            }
            // If not editing, don't preventDefault — let the TV go back/exit
            return;
        }

        // ── Backspace: if editing let it type, if not editing ignore ──
        if (e.key === 'Backspace') {
            if (isEditing) return; // let the keyboard handle it
            e.preventDefault();
            return;
        }

        // ── Enter/OK: activate the focused element ──
        if (action === RemoteActions.OK) {
            e.preventDefault();
            e.stopPropagation();
            // If editing, Enter confirms input (exit edit, move next)
            if (isEditing) {
                this._exitEditMode();
                this._focusNext();
                return;
            }
            this._handleEnter();
            return;
        }

        // ── All other keys: if editing, let them through to keyboard ──
        // If not editing, ignore them
    }

    // ─── Focus Movement ────────────────────────────────────────

    _focusNext() {
        const next = this._focusIndex + 1;
        if (next < this._focusables.length) {
            this._setFocus(next);
        }
    }

    _focusPrev() {
        const prev = this._focusIndex - 1;
        if (prev >= 0) {
            this._setFocus(prev);
        }
    }

    /**
     * Visually highlights an element. Does NOT call .focus() on inputs
     * so the on-screen keyboard stays closed.
     */
    _setFocus(index) {
        // Remove all highlights
        this._focusables.forEach((el) => el.classList.remove('focused'));

        this._focusIndex = index;
        const target = this._focusables[index];
        target.classList.add('focused');

        // Keep it visible
        if (target.scrollIntoView) {
            target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    _handleEnter() {
        const focused = this._focusables[this._focusIndex];

        if (focused.tagName === 'INPUT') {
            this._enterEditMode(focused);
        } else if (focused === this._els.ssl) {
            this._toggleSSL();
        } else if (focused === this._els.button) {
            this._handleLogin();
        }
    }

    // ─── Edit Mode ─────────────────────────────────────────────

    _enterEditMode(input) {
        // If already editing another input, close it first
        if (this._editingInput) {
            this._exitEditMode();
        }

        this._editingInput = input;
        input.removeAttribute('readonly');
        input.classList.add('editing');
        input.focus();  // THIS is the only .focus() call → opens keyboard
    }

    _exitEditMode() {
        const input = this._editingInput;
        if (!input) return;

        this._editingInput = null;
        input.setAttribute('readonly', '');
        input.classList.remove('editing');
        input.blur();

        // Pull browser focus to container so arrow keys route to keydown
        this._container.focus();
    }

    // ─── SSL Toggle ────────────────────────────────────────────

    _toggleSSL() {
        const toggle = this._els.ssl;
        const isActive = toggle.classList.toggle('toggle--active');
        toggle.setAttribute('aria-checked', isActive.toString());
    }

    // ─── Validation ────────────────────────────────────────────

    _validate() {
        const values = {
            host: this._els.host.value,
            port: this._els.port.value,
            username: this._els.username.value,
            password: this._els.password.value,
        };

        const { isValid, errors } = validateLogin(values);

        const fields = [
            { key: 'host', el: this._els.host, group: this._els.groups.host },
            { key: 'port', el: this._els.port, group: this._els.groups.port },
            { key: 'username', el: this._els.username, group: this._els.groups.username },
            { key: 'password', el: this._els.password, group: this._els.groups.password },
        ];

        fields.forEach(({ key, group }) => {
            const hasError = Boolean(errors[key]);
            group.classList.toggle('input-group--error', hasError);
        });

        if (!isValid) {
            const firstErrorIndex = fields.findIndex(({ key }) => errors[key]);
            if (firstErrorIndex !== -1) {
                this._setFocus(firstErrorIndex);
            }
        }

        return isValid;
    }

    // ─── Login ─────────────────────────────────────────────────

    async _handleLogin() {
        if (this._isLoading) return;
        if (!this._validate()) return;

        const host = this._els.host.value.trim();
        const port = this._els.port.value.trim();
        const username = this._els.username.value.trim();
        const password = this._els.password.value;
        const useSSL = this._els.ssl.classList.contains('toggle--active');

        this._setLoading(true);
        this._showStatus('Connecting to server…', 'loading');

        try {
            const session = await XtreamAuth.login(host, port, username, password, useSSL);
            this._showStatus('Connected successfully!', 'success');

            setTimeout(() => {
                this._container.dispatchEvent(
                    new CustomEvent(EVENTS.LOGIN_SUCCESS, {
                        detail: { session },
                        bubbles: true,
                    })
                );
            }, 1000);

        } catch (error) {
            this._setLoading(false);
            this._showStatus(this._getErrorMessage(error), 'error');
            this._setFocus(5);
        }
    }

    // ─── UI Helpers ────────────────────────────────────────────

    _setLoading(loading) {
        this._isLoading = loading;
        this._els.button.classList.toggle('login-btn--loading', loading);
    }

    _showStatus(message, type) {
        const s = this._els.status;
        s.textContent = message;
        s.className = `login-status login-status--${type} login-status--visible`;
    }

    _getErrorMessage(error) {
        return getAuthErrorMessage(error);
    }

    // ─── Saved Credentials ─────────────────────────────────────

    _loadSavedCredentials() {
        const { server, credentials } = Settings;

        if (server.host) this._els.host.value = server.host;
        if (server.port) this._els.port.value = server.port;
        if (credentials.username) this._els.username.value = credentials.username;

        if (server.useSSL) {
            this._els.ssl.classList.add('toggle--active');
            this._els.ssl.setAttribute('aria-checked', 'true');
        }
    }
}

export default LoginPage;
