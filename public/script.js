class MariborApp {
    constructor() {
        this.games = [];
        this.currentGame = null;
        this.filteredPlayers = [];
        this.positionData = {};
        this.bestFormation = {};
        this.currentPage = 'gameView';
        
        this.initializeElements();
        this.attachEventListeners();
        this.loadGames();
    }

    initializeElements() {
        // Navigation elements
        this.gameViewBtn = document.getElementById('gameViewBtn');
        this.positionViewBtn = document.getElementById('positionViewBtn');
        this.formationViewBtn = document.getElementById('formationViewBtn');
        this.gameViewPage = document.getElementById('gameViewPage');
        this.positionViewPage = document.getElementById('positionViewPage');
        this.formationViewPage = document.getElementById('formationViewPage');

        // Game view elements
        this.gameSelect = document.getElementById('gameSelect');
        this.positionFilter = document.getElementById('positionFilter');
        this.refreshBtn = document.getElementById('refreshBtn');
        this.gameInfo = document.getElementById('gameInfo');
        this.gameTitle = document.getElementById('gameTitle');
        this.gameDate = document.getElementById('gameDate');
        this.gameScore = document.getElementById('gameScore');
        this.playersTable = document.getElementById('playersTable');
        this.playersBody = document.getElementById('playersBody');
        this.loading = document.getElementById('loading');
        this.noData = document.getElementById('noData');

        // Position view elements
        this.positionSelect = document.getElementById('positionSelect');
        this.sortBy = document.getElementById('sortBy');
        this.positionInfo = document.getElementById('positionInfo');
        this.positionTitle = document.getElementById('positionTitle');
        this.playerCount = document.getElementById('playerCount');
        this.avgRating = document.getElementById('avgRating');
        this.positionPlayersTable = document.getElementById('positionPlayersTable');
        this.positionPlayersBody = document.getElementById('positionPlayersBody');
        this.positionLoading = document.getElementById('positionLoading');
        this.positionNoData = document.getElementById('positionNoData');

        // Formation view elements
        this.formationAvgRating = document.getElementById('formationAvgRating');
        this.formationTotalGames = document.getElementById('formationTotalGames');
        this.formationLoading = document.getElementById('formationLoading');
        this.formationNoData = document.getElementById('formationNoData');
    }

    attachEventListeners() {
        // Page navigation
        this.gameViewBtn.addEventListener('click', () => this.switchPage('gameView'));
        this.positionViewBtn.addEventListener('click', () => this.switchPage('positionView'));
        this.formationViewBtn.addEventListener('click', () => this.switchPage('formationView'));

        // Game view listeners
        this.gameSelect.addEventListener('change', (e) => {
            this.selectGame(e.target.value);
        });

        this.positionFilter.addEventListener('change', (e) => {
            this.filterPlayers(e.target.value);
        });

        this.refreshBtn.addEventListener('click', () => {
            this.refreshData();
        });

        // Position view listeners
        this.positionSelect.addEventListener('change', (e) => {
            this.renderPositionView();
        });

        this.sortBy.addEventListener('change', (e) => {
            this.renderPositionView();
        });
    }

    switchPage(page) {
        this.currentPage = page;

        // Update navigation buttons
        this.gameViewBtn.classList.toggle('active', page === 'gameView');
        this.positionViewBtn.classList.toggle('active', page === 'positionView');
        this.formationViewBtn.classList.toggle('active', page === 'formationView');

        // Update page visibility
        this.gameViewPage.classList.toggle('active', page === 'gameView');
        this.positionViewPage.classList.toggle('active', page === 'positionView');
        this.formationViewPage.classList.toggle('active', page === 'formationView');

        if (page === 'positionView') {
            this.calculatePositionData();
            this.renderPositionView();
        } else if (page === 'formationView') {
            this.calculatePositionData();
            this.calculateBestFormation();
            this.renderFormationView();
        }
    }

    async loadGames() {
        try {
            this.showLoading();
            const response = await fetch('/api/games');
            
            if (response.ok) {
                this.games = await response.json();
                this.populateGameSelect();
                if (this.games.length > 0) {
                    this.selectGame(this.games[0].id);
                }
                this.calculatePositionData();
            } else {
                this.showNoData();
            }
        } catch (error) {
            console.error('Error loading games:', error);
            this.showNoData();
        }
    }

    calculatePositionData() {
        this.positionData = {};

        // Aggregate all players across all games by position
        this.games.forEach(game => {
            if (game.players && game.players.length > 0) {
                game.players.forEach(player => {
                    const key = `${player.name}_${player.position}`;
                    
                    if (!this.positionData[key]) {
                        this.positionData[key] = {
                            name: player.name,
                            position: player.position,
                            ratings: [],
                            games: []
                        };
                    }
                    
                    this.positionData[key].ratings.push(player.rating);
                    this.positionData[key].games.push({
                        opponent: game.awayTeam === 'NK Maribor' ? game.homeTeam : game.awayTeam,
                        date: game.date,
                        rating: player.rating
                    });
                });
            }
        });

        // Calculate averages and additional stats
        Object.keys(this.positionData).forEach(key => {
            const playerData = this.positionData[key];
            const validRatings = playerData.ratings.filter(r => r !== null && r !== undefined);
            
            if (validRatings.length > 0) {
                const sum = validRatings.reduce((a, b) => a + b, 0);
                playerData.averageRating = Math.round((sum / validRatings.length) * 10) / 10;
                playerData.gamesPlayed = validRatings.length;
                playerData.bestRating = Math.max(...validRatings);
                playerData.worstRating = Math.min(...validRatings);
            } else {
                playerData.averageRating = 0;
                playerData.gamesPlayed = 0;
                playerData.bestRating = 0;
                playerData.worstRating = 0;
            }
        });
    }

    calculateBestFormation() {
        // Get all unique players and their best positions
        const playerBestPositions = {};
        
        Object.values(this.positionData).forEach(playerData => {
            const playerName = playerData.name;
            
            if (!playerBestPositions[playerName] || 
                playerData.averageRating > playerBestPositions[playerName].averageRating) {
                playerBestPositions[playerName] = {
                    name: playerName,
                    position: playerData.position,
                    averageRating: playerData.averageRating,
                    gamesPlayed: playerData.gamesPlayed,
                    bestRating: playerData.bestRating
                };
            }
        });

        // Group players by their best positions
        const playersByPosition = {
            'Goalkeeper': [],
            'Defender': [],
            'Midfielder': [],
            'Forward': []
        };

        Object.values(playerBestPositions).forEach(player => {
            if (playersByPosition[player.position] && player.averageRating > 0) {
                playersByPosition[player.position].push(player);
            }
        });

        // Sort each position by average rating (descending)
        Object.keys(playersByPosition).forEach(position => {
            playersByPosition[position].sort((a, b) => b.averageRating - a.averageRating);
        });

        // Select best formation (4-4-2)
        this.bestFormation = {
            'GK': playersByPosition['Goalkeeper'][0] || null,
            'LB': playersByPosition['Defender'][0] || null,
            'LCB': playersByPosition['Defender'][1] || null,
            'RCB': playersByPosition['Defender'][2] || null,
            'RB': playersByPosition['Defender'][3] || null,
            'LM': playersByPosition['Midfielder'][0] || null,
            'LCM': playersByPosition['Midfielder'][1] || null,
            'RCM': playersByPosition['Midfielder'][2] || null,
            'RM': playersByPosition['Midfielder'][3] || null,
            'LF': playersByPosition['Forward'][0] || null,
            'RF': playersByPosition['Forward'][1] || null
        };
    }

    renderFormationView() {
        const positions = ['GK', 'LB', 'LCB', 'RCB', 'RB', 'LM', 'LCM', 'RCM', 'RM', 'LF', 'RF'];
        
        let totalRating = 0;
        let totalGames = 0;
        let playersWithData = 0;

        positions.forEach(positionId => {
            const positionElement = document.getElementById(positionId);
            const player = this.bestFormation[positionId];
            
            if (player && positionElement) {
                const nameElement = positionElement.querySelector('.player-name');
                const ratingElement = positionElement.querySelector('.player-rating');
                
                // Truncate long names
                const displayName = player.name.length > 12 ? 
                    player.name.substring(0, 12) + '...' : player.name;
                
                nameElement.textContent = displayName;
                nameElement.title = player.name; // Full name on hover
                ratingElement.textContent = player.averageRating.toFixed(1);
                
                // Color-code the rating
                ratingElement.className = 'player-rating';
                if (player.averageRating >= 8.0) {
                    ratingElement.classList.add('rating-excellent');
                } else if (player.averageRating >= 7.0) {
                    ratingElement.classList.add('rating-good');
                } else if (player.averageRating >= 6.0) {
                    ratingElement.classList.add('rating-average');
                } else {
                    ratingElement.classList.add('rating-poor');
                }
                
                totalRating += player.averageRating;
                totalGames += player.gamesPlayed;
                playersWithData++;
            } else if (positionElement) {
                const nameElement = positionElement.querySelector('.player-name');
                const ratingElement = positionElement.querySelector('.player-rating');
                
                nameElement.textContent = '-';
                nameElement.title = 'No player available';
                ratingElement.textContent = '0.0';
                ratingElement.className = 'player-rating rating-none';
            }
        });

        // Update formation stats
        const avgRating = playersWithData > 0 ? totalRating / playersWithData : 0;
        this.formationAvgRating.textContent = `Team Avg: ${avgRating.toFixed(1)}`;
        this.formationTotalGames.textContent = `Total Games: ${totalGames}`;

        // Show/hide appropriate elements
        if (playersWithData >= 8) { // Need at least 8 players for a reasonable formation
            this.formationLoading.style.display = 'none';
            this.formationNoData.style.display = 'none';
        } else {
            this.formationNoData.style.display = 'block';
            this.formationLoading.style.display = 'none';
        }
    }

    renderPositionView() {
        const selectedPosition = this.positionSelect.value;
        const sortBy = this.sortBy.value;

        // Update position info header
        const positionEmojis = {
            'Forward': '⚡',
            'Midfielder': '🔄',
            'Defender': '🛡️',
            'Goalkeeper': '🥅'
        };

        this.positionTitle.textContent = `${positionEmojis[selectedPosition]} ${selectedPosition} Players`;

        // Filter players by selected position
        const positionPlayers = Object.values(this.positionData)
            .filter(player => player.position === selectedPosition && player.gamesPlayed > 0);

        // Update stats
        this.playerCount.textContent = `${positionPlayers.length} players`;
        
        if (positionPlayers.length > 0) {
            const avgRating = positionPlayers.reduce((sum, p) => sum + p.averageRating, 0) / positionPlayers.length;
            this.avgRating.textContent = `Avg: ${(Math.round(avgRating * 10) / 10).toFixed(1)}`;
        } else {
            this.avgRating.textContent = 'Avg: 0.0';
        }

        // Sort players
        positionPlayers.sort((a, b) => {
            switch (sortBy) {
                case 'rating':
                    return b.averageRating - a.averageRating;
                case 'games':
                    return b.gamesPlayed - a.gamesPlayed;
                case 'name':
                    return a.name.localeCompare(b.name);
                default:
                    return b.averageRating - a.averageRating;
            }
        });

        // Render table
        this.positionPlayersBody.innerHTML = '';

        if (positionPlayers.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="5" style="text-align: center; color: #666;">No players found for this position</td>';
            this.positionPlayersBody.appendChild(row);
            return;
        }

        positionPlayers.forEach(player => {
            const row = document.createElement('tr');
            
            const nameCell = document.createElement('td');
            nameCell.textContent = player.name;
            
            const avgRatingCell = document.createElement('td');
            const avgRatingSpan = this.createRatingElement(player.averageRating);
            avgRatingCell.appendChild(avgRatingSpan);
            
            const gamesCell = document.createElement('td');
            gamesCell.textContent = player.gamesPlayed;
            gamesCell.style.textAlign = 'center';
            
            const bestRatingCell = document.createElement('td');
            const bestRatingSpan = this.createRatingElement(player.bestRating, true);
            bestRatingCell.appendChild(bestRatingSpan);
            
            const performanceCell = document.createElement('td');
            performanceCell.innerHTML = this.getPerformanceText(player.averageRating);
            performanceCell.className = 'performance';
            
            row.appendChild(nameCell);
            row.appendChild(avgRatingCell);
            row.appendChild(gamesCell);
            row.appendChild(bestRatingCell);
            row.appendChild(performanceCell);
            
            this.positionPlayersBody.appendChild(row);
        });
    }

    populateGameSelect() {
        this.gameSelect.innerHTML = '<option value="">Select a game...</option>';
        
        this.games.forEach(game => {
            const option = document.createElement('option');
            option.value = game.id;
            option.textContent = `${game.date} - ${game.homeTeam} vs ${game.awayTeam}`;
            this.gameSelect.appendChild(option);
        });
    }

    selectGame(gameId) {
        if (!gameId) {
            this.hideGame();
            return;
        }

        this.currentGame = this.games.find(game => game.id === gameId);
        if (this.currentGame) {
            this.displayGame();
            this.filterPlayers(this.positionFilter.value);
        }
    }

    displayGame() {
        this.gameTitle.textContent = `${this.currentGame.homeTeam} vs ${this.currentGame.awayTeam}`;
        this.gameDate.textContent = `📅 ${this.currentGame.date}`;
        this.gameScore.textContent = `⚽ ${this.currentGame.score}`;
        
        this.gameInfo.style.display = 'block';
        this.playersTable.style.display = 'table';
        this.loading.style.display = 'none';
        this.noData.style.display = 'none';
    }

    hideGame() {
        this.gameInfo.style.display = 'none';
        this.playersTable.style.display = 'none';
    }

    filterPlayers(filterType) {
        if (!this.currentGame || !this.currentGame.players) return;

        let filtered = [...this.currentGame.players];

        switch (filterType) {
            case 'starting':
                filtered = filtered.filter(player => player.isStartingXI);
                break;
            case 'substitutes':
                filtered = filtered.filter(player => !player.isStartingXI);
                break;
            case 'all':
            default:
                break;
        }

        // Sort by rating (highest first), then by name
        filtered.sort((a, b) => {
            if (a.rating && b.rating) {
                return b.rating - a.rating;
            } else if (a.rating) {
                return -1;
            } else if (b.rating) {
                return 1;
            } else {
                return a.name.localeCompare(b.name);
            }
        });

        this.filteredPlayers = filtered;
        this.renderPlayersTable();
    }

    renderPlayersTable() {
        this.playersBody.innerHTML = '';

        if (this.filteredPlayers.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="5" style="text-align: center; color: #666;">No players found for selected filter</td>';
            this.playersBody.appendChild(row);
            return;
        }

        this.filteredPlayers.forEach(player => {
            const row = document.createElement('tr');
            
            const nameCell = document.createElement('td');
            nameCell.textContent = player.name;
            
            const ratingCell = document.createElement('td');
            const ratingSpan = this.createRatingElement(player.rating);
            ratingCell.appendChild(ratingSpan);
            
            const positionCell = document.createElement('td');
            const positionBadge = this.createPositionBadge(player.position);
            positionCell.appendChild(positionBadge);
            
            const statusCell = document.createElement('td');
            const statusBadge = this.createStatusBadge(player.isStartingXI);
            statusCell.appendChild(statusBadge);
            
            const performanceCell = document.createElement('td');
            performanceCell.innerHTML = this.getPerformanceText(player.rating);
            performanceCell.className = 'performance';
            
            row.appendChild(nameCell);
            row.appendChild(ratingCell);
            row.appendChild(positionCell);
            row.appendChild(statusCell);
            row.appendChild(performanceCell);
            
            this.playersBody.appendChild(row);
        });
    }

    createRatingElement(rating, isSmall = false) {
        const span = document.createElement('span');
        span.className = 'rating';
        if (isSmall) span.className += ' rating-small';
        
        if (rating === null || rating === undefined || rating === 0) {
            span.textContent = 'N/A';
            span.className += ' rating-none';
        } else {
            span.textContent = rating.toFixed(1);
            if (rating >= 8.0) {
                span.className += ' rating-excellent';
            } else if (rating >= 7.0) {
                span.className += ' rating-good';
            } else if (rating >= 6.0) {
                span.className += ' rating-average';
            } else {
                span.className += ' rating-poor';
            }
        }
        
        return span;
    }

    createPositionBadge(position) {
        const badge = document.createElement('span');
        badge.className = 'position-badge';
        badge.textContent = position || 'Unknown';
        
        // Add position-specific styling
        const pos = (position || '').toLowerCase();
        if (pos.includes('forward') || pos.includes('striker')) {
            badge.className += ' position-forward';
        } else if (pos.includes('midfielder') || pos.includes('midfield')) {
            badge.className += ' position-midfielder';
        } else if (pos.includes('defender') || pos.includes('defence')) {
            badge.className += ' position-defender';
        } else if (pos.includes('goalkeeper') || pos.includes('keeper')) {
            badge.className += ' position-goalkeeper';
        } else {
            badge.className += ' position-unknown';
        }
        
        return badge;
    }

    createStatusBadge(isStartingXI) {
        const badge = document.createElement('span');
        badge.className = 'status-badge';
        
        if (isStartingXI) {
            badge.textContent = 'Starting XI';
            badge.className += ' starting-xi';
        } else {
            badge.textContent = 'Substitute';
            badge.className += ' substitute';
        }
        
        return badge;
    }

    getPerformanceText(rating) {
        if (rating === null || rating === undefined || rating === 0) {
            return '<span style="color: #6c757d;">Not Rated</span>';
        } else if (rating >= 8.0) {
            return '<span style="color: #28a745;">Excellent</span>';
        } else if (rating >= 7.0) {
            return '<span style="color: #17a2b8;">Good</span>';
        } else if (rating >= 6.0) {
            return '<span style="color: #ffc107;">Average</span>';
        } else {
            return '<span style="color: #dc3545;">Poor</span>';
        }
    }

    async refreshData() {
        this.refreshBtn.disabled = true;
        this.refreshBtn.textContent = '🔄 Scraping...';
        
        try {
            const response = await fetch('/api/scrape', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                alert(`Successfully scraped ${result.gamesCount} games!`);
                await this.loadGames();
            } else {
                const error = await response.json();
                alert(`Scraping failed: ${error.details || error.error}`);
            }
        } catch (error) {
            console.error('Refresh error:', error);
            alert('Failed to refresh data. Please try again.');
        } finally {
            this.refreshBtn.disabled = false;
            this.refreshBtn.textContent = '🔄 Refresh Data';
        }
    }

    showLoading() {
        this.loading.style.display = 'block';
        this.playersTable.style.display = 'none';
        this.gameInfo.style.display = 'none';
        this.noData.style.display = 'none';
    }

    showNoData() {
        this.loading.style.display = 'none';
        this.playersTable.style.display = 'none';
        this.gameInfo.style.display = 'none';
        this.noData.style.display = 'block';
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new MariborApp();
});