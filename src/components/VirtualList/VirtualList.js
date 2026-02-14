/**
 * VirtualList — lightweight virtual scrolling for TV grids.
 *
 * Performance strategy:
 *  - Only renders items in the visible viewport + a buffer zone
 *  - Uses transform: translateY for positioning (GPU composited)
 *  - Items are created in chunks via requestIdleCallback / rAF
 *    to avoid blocking the main thread
 *  - Recycles DOM nodes when items scroll out of view
 *  - No third-party dependencies
 *
 * Usage:
 *   const vlist = new VirtualList({
 *       container:  scrollEl,
 *       itemHeight: 380,
 *       columns:    6,
 *       items:      dataArray,
 *       renderItem: (item, index) => domElement,
 *   });
 *   vlist.refresh(newItems);
 *   vlist.scrollToRow(rowIndex);
 *   vlist.destroy();
 */

// Use requestIdleCallback if available, else fallback to rAF
const scheduleIdle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb) => requestAnimationFrame(() => cb({ timeRemaining: () => 8 }));

const cancelIdle = typeof cancelIdleCallback === 'function'
    ? cancelIdleCallback
    : cancelAnimationFrame;

class VirtualList {
    /**
     * @param {Object} opts
     * @param {HTMLElement} opts.container   - The scrollable container element
     * @param {number}      opts.itemHeight  - Height of each row in px
     * @param {number}      opts.columns     - Number of columns per row
     * @param {Array}       opts.items       - Full data array
     * @param {Function}    opts.renderItem  - (item, index) => HTMLElement
     * @param {number}      [opts.buffer=2]  - Extra rows to render above/below viewport
     */
    constructor(opts) {
        this._container   = opts.container;
        this._itemHeight  = opts.itemHeight;
        this._columns     = opts.columns;
        this._items       = opts.items || [];
        this._renderItem  = opts.renderItem;
        this._buffer      = opts.buffer ?? 2;

        this._totalRows   = 0;
        this._visibleStart = -1;
        this._visibleEnd   = -1;
        this._nodeMap      = new Map(); // rowIndex → DOM element
        this._viewport     = null;
        this._spacer       = null;
        this._scrollHandler = this._onScroll.bind(this);
        this._idleId       = null;

        this._setup();
        this._calcRows();
        this._render();
        this._container.addEventListener('scroll', this._scrollHandler, { passive: true });
    }

    // ─── Setup ──────────────────────────────────────────────

    _setup() {
        // Viewport for rendered items
        this._viewport = document.createElement('div');
        this._viewport.className = 'vlist__viewport';
        this._viewport.style.position = 'relative';
        this._viewport.style.width = '100%';

        // Spacer sets the scrollable height
        this._spacer = document.createElement('div');
        this._spacer.className = 'vlist__spacer';
        this._spacer.style.width = '1px';
        this._spacer.style.pointerEvents = 'none';

        this._container.appendChild(this._viewport);
        this._container.appendChild(this._spacer);
    }

    // ─── Public API ─────────────────────────────────────────

    refresh(items) {
        this._items = items || [];
        this._calcRows();
        this._clearAll();
        this._visibleStart = -1;
        this._visibleEnd = -1;
        this._render();
    }

    getRowCount() {
        return this._totalRows;
    }

    getItemAtGrid(row, col) {
        const index = row * this._columns + col;
        return index < this._items.length ? this._items[index] : null;
    }

    getColumnsInRow(row) {
        const start = row * this._columns;
        const remaining = this._items.length - start;
        return Math.min(this._columns, Math.max(0, remaining));
    }

    scrollToRow(row) {
        const top = row * this._itemHeight;
        this._container.scrollTop = top;
    }

    ensureRowVisible(row) {
        const rowTop = row * this._itemHeight;
        const rowBottom = rowTop + this._itemHeight;
        const viewTop = this._container.scrollTop;
        const viewBottom = viewTop + this._container.clientHeight;

        if (rowTop < viewTop) {
            this._container.scrollTop = rowTop;
        } else if (rowBottom > viewBottom) {
            this._container.scrollTop = rowBottom - this._container.clientHeight;
        }
    }

    /**
     * Get the DOM element for a specific grid cell.
     * Returns the child at column position within the row element.
     */
    getCellElement(row, col) {
        const rowEl = this._nodeMap.get(row);
        if (!rowEl) return null;
        return rowEl.children[col] || null;
    }

    destroy() {
        this._container.removeEventListener('scroll', this._scrollHandler);
        if (this._idleId) cancelIdle(this._idleId);
        this._clearAll();
        if (this._viewport?.parentNode) this._viewport.remove();
        if (this._spacer?.parentNode) this._spacer.remove();
        this._nodeMap.clear();
    }

    // ─── Internal ───────────────────────────────────────────

    _calcRows() {
        this._totalRows = Math.ceil(this._items.length / this._columns);
        const totalHeight = this._totalRows * this._itemHeight;
        this._spacer.style.height = totalHeight + 'px';
        this._viewport.style.height = totalHeight + 'px';
    }

    _onScroll() {
        // Debounce via rAF to avoid multiple reflows per frame
        if (!this._scrollRaf) {
            this._scrollRaf = requestAnimationFrame(() => {
                this._scrollRaf = null;
                this._render();
            });
        }
    }

    _render() {
        const scrollTop = this._container.scrollTop;
        const viewHeight = this._container.clientHeight;

        const startRow = Math.max(0, Math.floor(scrollTop / this._itemHeight) - this._buffer);
        const endRow = Math.min(
            this._totalRows - 1,
            Math.ceil((scrollTop + viewHeight) / this._itemHeight) + this._buffer
        );

        if (startRow === this._visibleStart && endRow === this._visibleEnd) return;

        // Remove rows that scrolled out
        for (const [rowIdx, el] of this._nodeMap) {
            if (rowIdx < startRow || rowIdx > endRow) {
                el.remove();
                this._nodeMap.delete(rowIdx);
            }
        }

        // Add rows that scrolled in — chunked to avoid jank
        const rowsToAdd = [];
        for (let r = startRow; r <= endRow; r++) {
            if (!this._nodeMap.has(r)) {
                rowsToAdd.push(r);
            }
        }

        if (rowsToAdd.length > 0) {
            this._addRowsChunked(rowsToAdd, 0);
        }

        this._visibleStart = startRow;
        this._visibleEnd = endRow;
    }

    /**
     * Add rows in small chunks to keep the main thread responsive.
     * Renders up to 4 rows per idle/rAF frame.
     */
    _addRowsChunked(rows, offset) {
        const CHUNK = 4;
        const end = Math.min(offset + CHUNK, rows.length);

        for (let i = offset; i < end; i++) {
            this._createRow(rows[i]);
        }

        if (end < rows.length) {
            this._idleId = scheduleIdle(() => {
                this._addRowsChunked(rows, end);
            });
        }
    }

    _createRow(rowIndex) {
        const rowEl = document.createElement('div');
        rowEl.className = 'vlist__row';
        rowEl.style.position = 'absolute';
        rowEl.style.top = (rowIndex * this._itemHeight) + 'px';
        rowEl.style.left = '0';
        rowEl.style.right = '0';
        rowEl.style.display = 'flex';
        rowEl.style.gap = '20px';

        const start = rowIndex * this._columns;
        const end = Math.min(start + this._columns, this._items.length);

        for (let i = start; i < end; i++) {
            const el = this._renderItem(this._items[i], i);
            rowEl.appendChild(el);
        }

        this._nodeMap.set(rowIndex, rowEl);
        this._viewport.appendChild(rowEl);
    }

    _clearAll() {
        for (const [, el] of this._nodeMap) {
            el.remove();
        }
        this._nodeMap.clear();
    }
}

export default VirtualList;
