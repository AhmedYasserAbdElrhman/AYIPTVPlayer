import Settings from '../../config/settings.js';
import XtreamAuth from '../../api/XtreamAuth.js';
import TemplateEngine from '../../utils/templateEngine.js';

/**
 * Login page controller.
 * Pure behavior — no HTML, no CSS.
 */
class LoginPage {
    constructor() {
        this._container = null;
        this._focusIndex = 0;
        this._focusables = [];
        this._isLoading = false;
        this._keyHandler = this._onKeyDown.bind(this);
        this._els = {};
    }

    // ─── Lifecycle ─────────────────────────────────────────────

    async mount(container) {
        this._container = container;

        // Uses bundled template — no file:// fetch needed
        await TemplateEngine.load('pages/login/login.html', this._container);

        this._cacheDom();
        this._bindEvents();
        this._loadSavedCredentials();
        this._setFocus(0);
    }

    destroy() {
        document.removeEventListener('keydown', this._keyHandler);

        if (this._container) {
            this._container.innerHTML = '';
        }

        this._focusables = [];
        this._els = {};
        this._container = null;
    }

    // ─── DOM References ────────────────────────────────────────

    _cacheDom() {
        this._els = {
            form:     this._container.querySelector('#login-form'),
            host:     this._container.querySelector('#input-host'),
            port:     this._container.querySelector('#input-port'),
            username: this._container.querySelector('#input-username'),
            password: this._container.querySelector('#input-password'),
            ssl:      this._container.querySelector('#toggle-ssl'),
            button:   this._container.querySelector('#btn-login'),
            status:   this._container.querySelector('#login-status'),
            groups: {
                host:     this._container.querySelector('#group-host'),
                port:     this._container.querySelector('#group-port'),
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
            el.addEventListener('focus', () => this._setFocus(index));
            el.addEventListener('click', () => {
                if (el === this._els.ssl) this._toggleSSL();
            });
        });
    }

    // ─── TV Remote Navigation ──────────────────────────────────

    _onKeyDown(e) {
        if (this._isLoading) return;

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                this._moveFocus(-1);
                break;
            case 'ArrowDown':
                e.preventDefault();
                this._moveFocus(1);
                break;
            case 'Enter':
                e.preventDefault();
                this._handleEnter();
                break;
            default:
                break;
        }
    }

    _moveFocus(direction) {
        const nextIndex = this._focusIndex + direction;
        if (nextIndex < 0 || nextIndex >= this._focusables.length) return;
        this._setFocus(nextIndex);
    }

    _setFocus(index) {
        this._focusables.forEach(el => el.classList.remove('focused'));
        this._focusIndex = index;
        const target = this._focusables[index];
        target.classList.add('focused');

        if (target.tagName === 'INPUT') {
            target.focus();
        }
    }

    _handleEnter() {
        const focused = this._focusables[this._focusIndex];

        if (focused === this._els.ssl) {
            this._toggleSSL();
        } else if (focused === this._els.button) {
            this._handleLogin();
        } else if (focused.tagName === 'INPUT') {
            this._moveFocus(1);
        }
    }

    // ─── SSL Toggle ────────────────────────────────────────────

    _toggleSSL() {
        const toggle = this._els.ssl;
        const isActive = toggle.classList.toggle('toggle--active');
        toggle.setAttribute('aria-checked', isActive.toString());
    }

    // ─── Validation ��───────────────────────────────────────────

    _validate() {
        let isValid = true;

        const fields = [
            { el: this._els.host, group: this._els.groups.host },
            { el: this._els.port, group: this._els.groups.port },
            { el: this._els.username, group: this._els.groups.username },
            { el: this._els.password, group: this._els.groups.password },
        ];

        fields.forEach(({ el, group }) => {
            if (!el.value.trim()) {
                group.classList.add('input-group--error');
                isValid = false;
            } else {
                group.classList.remove('input-group--error');
            }
        });

        if (!isValid) {
            const firstError = fields.findIndex(({ el }) => !el.value.trim());
            if (firstError !== -1) this._setFocus(firstError);
        }

        return isValid;
    }

    // ─── Login ─────────────────────────────────────────────────

    async _handleLogin() {
        if (this._isLoading) return;
        if (!this._validate()) return;

        const host     = this._els.host.value.trim();
        const port     = this._els.port.value.trim();
        const username = this._els.username.value.trim();
        const password = this._els.password.value;
        const useSSL   = this._els.ssl.classList.contains('toggle--active');

        this._setLoading(true);
        this._showStatus('Connecting to server...', 'loading');

        try {
            const session = await XtreamAuth.login(host, port, username, password, useSSL);

            this._showStatus('Connected successfully!', 'success');

            setTimeout(() => {
                const event = new CustomEvent('login:success', {
                    detail: { session },
                    bubbles: true,
                });
                this._container.dispatchEvent(event);
            }, 1200);

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
        const status = this._els.status;
        status.textContent = message;
        status.className = `login-status login-status--${type} login-status--visible`;
    }

    _getErrorMessage(error) {
        const msg = error.message || '';

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

        return `Connection failed: ${msg}`;
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