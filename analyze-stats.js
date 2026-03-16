const mongoose = require('mongoose');
require('dotenv').config();

async function analyzeDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const GameState = require('./models/GameState');
    const UserDashboard = require('./models/UserDashboard');

    console.log('=== DATABASE ANALYSIS ===');

    // Count all GameState records
    const totalGameStates = await GameState.countDocuments();
    console.log('Total GameState records:', totalGameStates);

    // Count active games
    const activeGames = await GameState.countDocuments({ currentPlayer: { $ne: null } });
    console.log('Active games (currentPlayer != null):', activeGames);

    // Count completed games
    const completedGames = await GameState.countDocuments({ currentPlayer: null });
    console.log('Completed games (currentPlayer = null):', completedGames);

    // Sample some GameState records
    const sampleGames = await GameState.find({}, 'matchId currentPlayer playerColors createdAt').limit(10);
    console.log('\nSample GameState records:');
    sampleGames.forEach(game => {
      console.log(`- MatchId: ${game.matchId}, CurrentPlayer: ${game.currentPlayer}, Created: ${game.createdAt}`);
    });

    // Count UserDashboard records and total games played
    const userDashboards = await UserDashboard.find({}, 'username gameHistory');
    console.log('\n=== USER DASHBOARD ANALYSIS ===');
    console.log('Total user dashboards:', userDashboards.length);

    let totalGamesFromUsers = 0;
    userDashboards.forEach(dashboard => {
      const gameCount = dashboard.gameHistory ? dashboard.gameHistory.length : 0;
      totalGamesFromUsers += gameCount;
      console.log(`- User: ${dashboard.username}, Games in history: ${gameCount}`);

      // Show details of first few games for analysis
      if (dashboard.gameHistory && dashboard.gameHistory.length > 0) {
        console.log(`  Sample games for ${dashboard.username}:`);
        dashboard.gameHistory.slice(0, 3).forEach((game, index) => {
          console.log(`    Game ${index + 1}: result=${game.result}, difficulty=${game.difficulty}, matchId=${game.matchId || 'null'}, date=${game.date}`);
        });
        if (dashboard.gameHistory.length > 3) {
          console.log(`    ... and ${dashboard.gameHistory.length - 3} more games`);
        }
      }
    });

    console.log('\nSUMMARY:');
    console.log('- GameState records:', totalGameStates);
    console.log('- Games tracked in user dashboards:', totalGamesFromUsers);
    console.log('- Difference:', totalGameStates - totalGamesFromUsers);

    // Check for duplicate matchIds in GameState
    const allMatchIds = await GameState.distinct('matchId');
    console.log('\n=== MATCH ID ANALYSIS ===');
    console.log('Unique match IDs:', allMatchIds.length);
    console.log('Total GameState records:', totalGameStates);

    if (allMatchIds.length !== totalGameStates) {
      console.log('*** WARNING: Duplicate matchIds detected! ***');

      // Find duplicates
      const matchIdCounts = {};
      const allGames = await GameState.find({}, 'matchId currentPlayer');
      allGames.forEach(game => {
        matchIdCounts[game.matchId] = (matchIdCounts[game.matchId] || 0) + 1;
      });

      const duplicates = Object.entries(matchIdCounts).filter(([_, count]) => count > 1);
      console.log('Duplicate matchIds:', duplicates.slice(0, 5)); // Show first 5
    }

  } catch (error) {
    console.error('Error analyzing database:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  }
}

analyzeDatabase();