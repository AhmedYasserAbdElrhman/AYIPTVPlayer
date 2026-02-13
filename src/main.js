// CSS imports — Vite bundles these into app.css
import './styles/global.css';
import './pages/login/login.css';

import LoginPage from './pages/login/login.js';
import TemplateEngine from './utils/templateEngine.js';
import templates from 'virtual:templates';

class App {
    constructor() {
        this._container = null;
        this._currentPage = null;
    }

    async init() {
        this._container = document.getElementById('app');

        if (!this._container) {
            console.error('[App] #app element not found');
            return;
        }

        // Register bundled templates
        TemplateEngine.registerTemplates(templates);

        this._bindGlobalEvents();
        await this._showLogin();
    }

    async _showLogin() {
        this._destroyCurrent();
        this._currentPage = new LoginPage();
        await this._currentPage.mount(this._container);
    }

    _bindGlobalEvents() {
        this._container.addEventListener('login:success', (e) => {
            const { session } = e.detail;
            console.log('Login successful:', session);
            // TODO: Navigate to home screen
        });
    }

    _destroyCurrent() {
        if (this._currentPage?.destroy) {
            this._currentPage.destroy();
        }
        this._currentPage = null;
    }
}

// Wait for DOM to be ready before initializing
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const app = new App();
        app.init();
    });
} else {
    // DOM already ready
    const app = new App();
    app.init();
}