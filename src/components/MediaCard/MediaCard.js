/**
 * MediaCard — reusable card component for Movies & Series.
 *
 * TV Performance strategy:
 *  - Cards are created once with createElement (no innerHTML on scroll)
 *  - Images use loading="lazy" and a placeholder until loaded
 *  - Focus uses border-color only (will-change in CSS)
 *  - Cards are recycled in the VirtualGrid, not recreated
 *
 * Usage:
 *   const card = MediaCard.create(item, 'movie');
 *   container.appendChild(card.el);
 *   card.setFocused(true);
 */

const PLACEHOLDER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
    <line x1="7" y1="2" x2="7" y2="22"/>
    <line x1="17" y1="2" x2="17" y2="22"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
</svg>`;

class MediaCard {
    /**
     * @param {HTMLElement} el - The card DOM element
     * @param {Object} data - The item data
     */
    constructor(el, data) {
        this.el = el;
        this.data = data;
        this._img = el.querySelector('.mcard__poster-img');
    }

    /**
     * Create a media card element.
     * @param {Object} item - { id, name, cover, year, rating, categoryName, containerExtension }
     * @param {'movie'|'series'} type
     * @returns {MediaCard}
     */
    static create(item, type) {
        const card = document.createElement('button');
        card.className = 'mcard focusable';
        card.dataset.id = item.stream_id || item.series_id || item.id || '';
        card.dataset.type = type;

        const name = item.name || 'Untitled';
        const year = item.year || '';
        const rating = item.rating || item.rating_5based
            ? (item.rating_5based ? `★ ${item.rating_5based}` : `★ ${item.rating}`)
            : '';

        // Build DOM — single innerHTML, then cache references
        // NOTE: Images use data-src (NOT src) to prevent eager browser fetching.
        // The IntersectionObserver or ImageCache loads them when visible.
        card.innerHTML =
            '<div class="mcard__poster">' +
            '<div class="mcard__poster-placeholder">' + PLACEHOLDER_SVG + '</div>' +
            (item.cover || item.stream_icon
                ? '<img class="mcard__poster-img" data-src="' +
                _escapeAttr(item.cover || item.stream_icon) +
                '" alt="" decoding="async">'
                : '') +
            '</div>' +
            '<div class="mcard__info">' +
            '<span class="mcard__name">' + _escapeHtml(name) + '</span>' +
            '<div class="mcard__meta">' +
            (year ? '<span class="mcard__year">' + _escapeHtml(year) + '</span>' : '') +
            (rating ? '<span class="mcard__rating">' + _escapeHtml(rating) + '</span>' : '') +
            '</div>' +
            '</div>';

        // Handle image error (load is handled by caller's ImageCache/Observer)
        const img = card.querySelector('.mcard__poster-img');
        if (img) {
            img.addEventListener('error', () => {
                img.style.display = 'none';
            }, { once: true });
        }

        return new MediaCard(card, item);
    }

    setFocused(focused) {
        if (focused) {
            this.el.classList.add('focused');
        } else {
            this.el.classList.remove('focused');
        }
    }

    getId() {
        return this.el.dataset.id;
    }

    getType() {
        return this.el.dataset.type;
    }
}

// ─── Utility (module-scoped, not exported) ──────────────────

function _escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default MediaCard;
