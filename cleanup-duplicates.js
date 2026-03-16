const mongoose = require('mongoose');
require('dotenv').config();

async function cleanupDuplicates() {
    try {
        console.log('Starting duplicate cleanup...');
        await mongoose.connect(process.env.MONGODB_URI);

        const UserDashboard = require('./models/UserDashboard');

        const userDashboards = await UserDashboard.find({}, 'username gameHistory');
        let totalDuplicatesRemoved = 0;
        let dashboardsCleaned = 0;

        console.log(`Found ${userDashboards.length} user dashboards to check`);

        for (const dashboard of userDashboards) {
            if (!dashboard.gameHistory || !Array.isArray(dashboard.gameHistory)) {
                continue;
            }

            const originalCount = dashboard.gameHistory.length;
            console.log(`Checking ${dashboard.username}: ${originalCount} games`);

            // Sort games by date for timestamp-based deduplication
            const sortedGames = dashboard.gameHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
            const uniqueGames = [];

            for (let i = 0; i < sortedGames.length; i++) {
                const currentGame = sortedGames[i];
                let isDuplicate = false;

                // Check against recently added games for timestamp proximity
                for (const uniqueGame of uniqueGames) {
                    if (currentGame.difficulty === 'multiplayer' &&
                        uniqueGame.difficulty === 'multiplayer' &&
                        Math.abs(new Date(currentGame.date) - new Date(uniqueGame.date)) < 30000) { // 30 seconds
                        // Likely the same game recorded multiple times
                        isDuplicate = true;
                        break;
                    }
                }

                if (!isDuplicate) {
                    uniqueGames.push(currentGame);
                }
            }

            const duplicatesRemoved = originalCount - uniqueGames.length;
            if (duplicatesRemoved > 0) {
                dashboard.gameHistory = uniqueGames;
                await dashboard.save();
                totalDuplicatesRemoved += duplicatesRemoved;
                dashboardsCleaned++;
                console.log(`✅ Cleaned ${duplicatesRemoved} duplicates from ${dashboard.username} (${uniqueGames.length} games remaining)`);
            } else {
                console.log(`ℹ️  No duplicates found for ${dashboard.username}`);
            }
        }

        console.log('\n=== CLEANUP SUMMARY ===');
        console.log(`Dashboards cleaned: ${dashboardsCleaned}`);
        console.log(`Total duplicates removed: ${totalDuplicatesRemoved}`);

        await mongoose.connection.close();
        console.log('Cleanup completed successfully!');

    } catch (error) {
        console.error('Error during cleanup:', error);
        await mongoose.connection.close();
    }
}

cleanupDuplicates();