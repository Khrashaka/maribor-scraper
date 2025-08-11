class MariborApp {
    constructor() {
        this.games = [];
        this.currentGame = null;
        this.filteredPlayers = [];
        
        this.initializeElements();
        this.attachEventListeners();
        this.loadGames();
    }

    initializeElements() {
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
    }

    attachEventListeners() {
        this.gameSelect.addEventListener('change', (e) => {
            this.selectGame(e.target.value);
        });

        this.positionFilter.addEventListener('change', (e) => {
            this.filterPlayers(e.target.value);
        });

        this.refreshBtn.addEventListener('click', () => {
            this.refreshData();
        });
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
            } else {
                this.showNoData();
            }
        } catch (error) {
            console.error('Error loading games:', error);
            this.showNoData();
        }
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
            row.innerHTML = '<td colspan="4" style="text-align: center; color: #666;">No players found for selected filter</td>';
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
            const positionBadge = this.createPositionBadge(player.isStartingXI);
            positionCell.appendChild(positionBadge);
            
            const performanceCell = document.createElement('td');
            performanceCell.innerHTML = this.getPerformanceText(player.rating);
            performanceCell.className = 'performance';
            
            row.appendChild(nameCell);
            row.appendChild(ratingCell);
            row.appendChild(positionCell);
            row.appendChild(performanceCell);
            
            this.playersBody.appendChild(row);
        });
    }

    createRatingElement(rating) {
        const span = document.createElement('span');
        span.className = 'rating';
        
        if (rating === null || rating === undefined) {
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

    createPositionBadge(isStartingXI) {
        const badge = document.createElement('span');
        badge.className = 'position-badge';
        
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
        if (rating === null || rating === undefined) {
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