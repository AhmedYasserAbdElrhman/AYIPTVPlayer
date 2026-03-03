// Function to build focus grid for the home page
function _buildFocusGrid() {
    const grid = [];
    // Row 0: categories
    grid[0] = createCategoriesRow();
    // Row 1: toggle favorite alone
    grid[1] = createToggleFavoriteRow();
    // Row 2: empty array for recent items
    grid[2] = [];  // Represents recent items
    // Row 3: settings/logout
    grid[3] = createSettingsLogoutRow();
    return grid;
}

// Renamed _rebuildRow1 to _rebuildRow2 and updated it
function _rebuildRow2() {
    // Logic to populate rows[2] with recent items
    const recentItems = getRecentItems();
    rows[2] = recentItems;
}

// Updated _setFocus() to check for row === 2
function _setFocus(row) {
    if (row === 2) {
        // Logic to handle focus for recent items
    } else if (row === 1) {
        // Logic to handle focus for toggle favorite
    }
}

// Updated _renderList() to call _rebuildRow2()
function _renderList() {
    _rebuildRow2(); // now populates recent items
    // Updated index checks
    for (let i = 0; i < rows.length; i++) {
        if (i === 2) {
            renderRecentItems(rows[i]);
        }
    }
}

/**
 * Navigation: Updated for the new 4-row structure
 * 1. Row 0: Categories
 * 2. Row 1: Toggle Favorite Alone
 * 3. Row 2: Recent Items
 * 4. Row 3: Settings/Logout
 */