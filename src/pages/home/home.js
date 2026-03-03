// Updating the focus grid structure in home.js to separate the Favourites toggle and recent items into different rows.

import React from 'react';
import { View, Text } from 'react-native';
import FavouritesToggle from './FavouritesToggle';
import RecentItems from './RecentItems';

const Home = () => {
    return (
        <View>
            {/* Favourites Toggle Button in its own row */}
            <View style={{ marginBottom: 20 }}>
                <FavouritesToggle />
            </View>

            {/* Recent Items in its own row */}
            <RecentItems />
        </View>
    );
};

export default Home;