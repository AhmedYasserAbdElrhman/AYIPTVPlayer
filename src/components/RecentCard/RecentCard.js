/**
 * RecentCard — renders a recent/favourite item card.
 *
 * Produces a <button> element with thumbnail, type badge,
 * favourite indicator, optional progress bar, and info text.
 */

// ─── Helpers ────────────────────────────────────────────────

function _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function _typeClass(type) {
    if (type === 'live') return 'live';
    if (type === 'movie') return 'movie';
    return 'series';
}

// ─── Public API ─────────────────────────────────────────────

const RecentCard = {
    /**
     * Creates a recent-card button element.
     * @param {Object} item
     * @param {string}  [item.id]
     * @param {string}  [item.name]
     * @param {string}  [item.meta]
     * @param {string}  [item.type]        - 'live' | 'movie' | 'series'
     * @param {string}  [item.thumbnail]
     * @param {boolean} [item.isFavourite]
     * @param {number}  [item.progress]    - 0–100
     * @param {{ onClick?: (id: string) => void }} [opts]
     * @returns {HTMLButtonElement}
     */
    create(item, opts = {}) {
        const card = document.createElement('button');
        card.className = 'recent-card focusable';
        if (item.isFavourite) card.classList.add('recent-card--fav');
        card.dataset.itemId = item.id || '';

        const cls = _typeClass(item.type);

        card.innerHTML =
            '<div class="recent-card__thumb">' +
            (item.thumbnail
                ? '<img src="' + item.thumbnail + '" alt="" loading="lazy">'
                : '<div class="recent-card__thumb-placeholder">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
                '<polygon points="5 3 19 12 5 21 5 3"/>' +
                '</svg>' +
                '</div>'
            ) +
            '<span class="recent-card__type-badge recent-card__type-badge--' + cls + '">' +
            _escapeHtml(item.type || 'live') +
            '</span>' +
            '<div class="recent-card__fav">' +
            '<svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 ' +
            '0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 ' +
            '1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
            '</div>' +
            '</div>' +
            (item.progress !== undefined
                ? '<div class="recent-card__progress">' +
                '<div class="recent-card__progress-bar" style="width:' + item.progress + '%"></div>' +
                '</div>'
                : '') +
            '<div class="recent-card__info">' +
            '<span class="recent-card__name">' + _escapeHtml(item.name || 'Untitled') + '</span>' +
            '<span class="recent-card__meta">' + _escapeHtml(item.meta || '') + '</span>' +
            '</div>';

        if (opts.onClick) {
            card.addEventListener('click', () => opts.onClick(item.id));
        }

        return card;
    },
};

export default RecentCard;
