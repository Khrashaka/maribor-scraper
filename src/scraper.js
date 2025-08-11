// src/scraper.js - Fixed detection with proper retry logic
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class MariborScraper {
    constructor() {
        this.baseUrl = 'https://www.sofascore.com';
        this.mariborTeamUrl = 'https://www.sofascore.com/team/football/nk-maribor/2420';
        this.targetDate = new Date('2025-07-15');
        this.dataPath = path.join(__dirname, '../data/games.json');
        this.maxRetries = 3;
    }

    async initBrowser() {
        console.log('Launching browser...');
        this.browser = await puppeteer.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ]
        });
        
        this.page = await this.browser.newPage();
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await this.page.setViewport({ width: 1366, height: 768 });
        this.page.setDefaultTimeout(45000);
    }

    parseGameDate(dateString) {
        if (!dateString) return null;
        
        const cleanDate = dateString.replace(/[^\d\/]/g, '').substring(0, 8);
        
        if (cleanDate.match(/^\d{2}\/\d{2}\/\d{2}$/)) {
            const [day, month, year] = cleanDate.split('/');
            const fullYear = parseInt(year) + 2000;
            const parsedDate = new Date(fullYear, parseInt(month) - 1, parseInt(day));
            return parsedDate;
        }
        
        return null;
    }

    async scrapeGames() {
        try {
            await this.initBrowser();
            console.log('Starting to scrape NK Maribor games from SofaScore...');
            console.log(`Target date: ${this.targetDate.toDateString()}`);

            await this.page.goto(this.mariborTeamUrl, { 
                waitUntil: 'networkidle0',
                timeout: 40000 
            });

            await this.delay(5000);

            // Click on results tab
            try {
                console.log('Looking for "All" or "Results" tab...');
                await this.page.evaluate(() => {
                    const elements = Array.from(document.querySelectorAll('*')).filter(el => 
                        el.textContent && (
                            el.textContent.toLowerCase().includes('all') ||
                            el.textContent.toLowerCase().includes('results')
                        )
                    );
                    if (elements.length > 0) {
                        elements[0].click();
                        return true;
                    }
                    return false;
                });
                await this.delay(3000);
            } catch (error) {
                console.log('Could not find All/Results tab');
            }

            // Scroll to load matches
            for (let i = 0; i < 5; i++) {
                await this.page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                });
                await this.delay(1500);
            }

            // Get qualified games
            const gameLinks = await this.page.evaluate((targetDateStr) => {
                const targetDate = new Date(targetDateStr);
                const links = [];
                const matchLinks = document.querySelectorAll('a[href*="/match/"]');
                
                matchLinks.forEach((link) => {
                    const href = link.href;
                    const linkParent = link.closest('[class*="event"], [data-testid*="event"], [class*="match"], [data-testid*="match"]');
                    
                    if (href && href.includes('/match/') && linkParent) {
                        const fullText = linkParent.textContent || '';
                        const teams = link.textContent.trim() || 'Unknown match';
                        
                        const cleanDate = fullText.replace(/[^\d\/]/g, '').substring(0, 8);
                        let gameDate = null;
                        
                        if (cleanDate.match(/^\d{2}\/\d{2}\/\d{2}$/)) {
                            const [day, month, year] = cleanDate.split('/');
                            const fullYear = parseInt(year) + 2000;
                            gameDate = new Date(fullYear, parseInt(month) - 1, parseInt(day));
                        }
                        
                        const isCompleted = fullText.includes('FT');
                        const isAfterTargetDate = gameDate && gameDate >= targetDate;
                        const isNotFuture = gameDate && gameDate <= new Date();
                        
                        if (isCompleted && isAfterTargetDate && isNotFuture) {
                            links.push({
                                url: href,
                                teams: teams,
                                fullText: fullText,
                                date: gameDate,
                                dateString: gameDate ? gameDate.toLocaleDateString() : 'Unknown'
                            });
                        }
                    }
                });
                
                return links;
            }, this.targetDate.toISOString());

            console.log(`\nFound ${gameLinks.length} qualified games:`);
            gameLinks.forEach((game, index) => {
                console.log(`  ${index + 1}. ${game.teams} (${game.dateString})`);
            });

            if (gameLinks.length === 0) {
                await this.saveData([]);
                return [];
            }

            // Sort by date (newest first)
            gameLinks.sort((a, b) => {
                if (a.date && b.date) {
                    return b.date - a.date;
                }
                return 0;
            });

            const gamesData = [];
            
            for (let i = 0; i < gameLinks.length; i++) {
                console.log(`\n🎯 Processing game ${i + 1}/${gameLinks.length}: ${gameLinks[i].teams}`);
                
                const gameData = await this.scrapeGameWithRetries(gameLinks[i]);
                if (gameData) {
                    gamesData.push(gameData);
                    const ratingInfo = gameData.players.length > 0 ? 
                        `${gameData.players.length} players with ratings` : 
                        'No player ratings available';
                    console.log(`  ✅ FINAL SUCCESS: ${gameData.homeTeam} vs ${gameData.awayTeam} (${gameData.score}) - ${ratingInfo}`);
                } else {
                    console.log(`  ❌ FINAL FAILURE: Could not process game after all retries`);
                }
                
                await this.delay(4000);
            }

            await this.saveData(gamesData);
            console.log(`\n✅ Successfully scraped ${gamesData.length} real games from SofaScore`);

            return gamesData;

        } catch (error) {
            console.error('❌ Error scraping games:', error);
            await this.saveData([]);
            throw error;
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }
    }

    async scrapeGameWithRetries(gameInfo) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`  📄 Attempt ${attempt}/${this.maxRetries}: Navigating to ${gameInfo.url}`);
                
                const result = await this.scrapeGameWithCorrectNavigation(gameInfo, attempt);
                if (result) {
                    console.log(`  ✅ Attempt ${attempt} succeeded`);
                    return result;
                }
                
                console.log(`  ❌ Attempt ${attempt} failed`);
                
            } catch (error) {
                console.log(`  ❌ Attempt ${attempt} error: ${error.message}`);
                
                if (attempt < this.maxRetries) {
                    const retryDelay = 3000 * attempt; // Increasing delay
                    console.log(`  🔄 Retrying in ${retryDelay/1000}s...`);
                    await this.delay(retryDelay);
                } else {
                    console.log(`  ❌ All ${this.maxRetries} attempts failed`);
                    return null;
                }
            }
        }
        
        return null;
    }

    async scrapeGameWithCorrectNavigation(gameInfo, attempt) {
        const timeout = 30000 + (attempt * 10000); // Progressive timeout
        
        await this.page.goto(gameInfo.url, { 
            waitUntil: 'networkidle0',
            timeout: timeout
        });
        
        await this.delay(5000 + (attempt * 1000));

        // Extract basic game info
        const gameBasicInfo = await this.page.evaluate(() => {
            let homeTeam = 'Unknown Home';
            let awayTeam = 'Unknown Away';
            let score = '0-0';

            const title = document.title || '';
            if (title.includes(' vs ')) {
                const titleParts = title.split(' vs ');
                if (titleParts.length >= 2) {
                    homeTeam = titleParts[0].trim();
                    awayTeam = titleParts[1].split(' live score')[0].split(' |')[0].trim();
                }
            }

            // Look for score
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
                const text = el.textContent?.trim();
                if (text && text.match(/^\d+\s*[-:]\s*\d+$/) && text.length <= 10) {
                    score = text;
                    break;
                }
            }

            return { homeTeam, awayTeam, score };
        });

        console.log(`  📊 Teams: ${gameBasicInfo.homeTeam} vs ${gameBasicInfo.awayTeam} (${gameBasicInfo.score})`);

        // IMPROVED PLAYER RATINGS DETECTION
        console.log(`  🏆 Quick Check: Looking for actual player ratings...`);
        const hasRealRatings = await this.page.evaluate(() => {
            // Strategy 1: Look for actual rating badges/numbers in a structured way
            const ratingElements = document.querySelectorAll('*');
            let ratingsCount = 0;
            const foundRatings = [];
            
            ratingElements.forEach(el => {
                const text = el.textContent?.trim();
                // Look for exact rating format (X.X)
                if (text && text.match(/^\d\.\d$/) && text.length === 3) {
                    const rating = parseFloat(text);
                    if (rating >= 5.0 && rating <= 10.0) {
                        // Check if this rating is in a player context
                        const parent = el.parentElement;
                        const grandParent = parent?.parentElement;
                        const contextText = (parent?.textContent + ' ' + grandParent?.textContent).toLowerCase();
                        
                        // Look for player-related context
                        if (contextText.includes('rating') || 
                            contextText.includes('ocena') ||
                            contextText.includes('player') ||
                            contextText.includes('igralec') ||
                            parent?.querySelector('img') || // Player photos
                            grandParent?.querySelector('img')) {
                            ratingsCount++;
                            foundRatings.push(rating);
                        }
                    }
                }
            });
            
            console.log(`Found ${ratingsCount} potential player ratings: ${foundRatings.slice(0, 5).join(', ')}${foundRatings.length > 5 ? '...' : ''}`);
            
            // Strategy 2: Look for "Player of the Game" or "Igralec tekme" with actual rating
            const pageText = document.body.textContent.toLowerCase();
            const hasPlayerOfGame = pageText.includes('player of the game') || 
                                   pageText.includes('igralec tekme') ||
                                   pageText.includes('najbolji igralec');
            
            // Strategy 3: Look for statistics tables with ratings
            const tables = document.querySelectorAll('table, [class*="table"], [class*="stats"]');
            let hasStatsTable = false;
            
            tables.forEach(table => {
                const tableText = table.textContent.toLowerCase();
                if (tableText.includes('rating') || tableText.includes('ocena')) {
                    const ratingMatches = tableText.match(/\d\.\d/g);
                    if (ratingMatches && ratingMatches.length > 3) {
                        hasStatsTable = true;
                    }
                }
            });
            
            console.log(`Detection results:`);
            console.log(`- Player ratings found: ${ratingsCount > 0}`);
            console.log(`- Player of the game: ${hasPlayerOfGame}`);
            console.log(`- Stats table with ratings: ${hasStatsTable}`);
            
            // Only consider it has ratings if we find actual rating numbers (not just text mentions)
            return ratingsCount >= 5; // Need at least 5 player ratings to consider it valid
        });

        if (!hasRealRatings) {
            console.log(`  ⚠️  No real player ratings detected - skipping navigation`);
            return {
                id: this.generateGameId(gameInfo.url),
                url: gameInfo.url,
                date: gameInfo.dateString,
                homeTeam: gameBasicInfo.homeTeam,
                awayTeam: gameBasicInfo.awayTeam,
                score: gameBasicInfo.score,
                players: [],
                hasRatings: false,
                scrapedAt: new Date().toISOString()
            };
        }

        console.log(`  ✅ Real player ratings detected - proceeding with navigation`);

        // STEP 1: Click "Postava" (Lineups) with retry
        console.log(`  🔗 Step 1: Looking for "Postava" (Lineups)...`);
        const postavaClicked = await this.clickElementWithRetry([
            () => this.page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('a, button, div'));
                for (const el of elements) {
                    const text = el.textContent?.toLowerCase() || '';
                    if ((text.includes('postava') || text.includes('lineup')) && el.click) {
                        el.click();
                        return true;
                    }
                }
                return false;
            }),
            () => this.page.evaluate(() => {
                const lineupsLinks = document.querySelectorAll('a[href*="lineups"]');
                if (lineupsLinks.length > 0) {
                    lineupsLinks[0].click();
                    return true;
                }
                return false;
            })
        ], 'Postava/Lineups');

        if (!postavaClicked) {
            throw new Error('Could not find or click Postava/Lineups tab');
        }

        console.log(`  ✅ Step 1: Found and clicked Postava`);
        await this.delay(4000);

        // STEP 2: Click "Statistika igralca" (Player stats) with retry
        console.log(`  📊 Step 2: Looking for "Statistika igralca" (Player stats)...`);
        const statistikaClicked = await this.clickElementWithRetry([
            () => this.page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('*'));
                for (const el of elements) {
                    const text = el.textContent?.toLowerCase() || '';
                    if ((text.includes('statistika igralca') || 
                         text.includes('player stat') ||
                         (text.includes('statistika') && text.includes('igralca'))) && el.click) {
                        el.click();
                        return true;
                    }
                }
                return false;
            })
        ], 'Statistika igralca');

        if (!statistikaClicked) {
            throw new Error('Could not find or click Statistika igralca');
        }

        console.log(`  ✅ Step 2: Found and clicked Statistika igralca`);
        await this.delay(4000);

        // STEP 3: Click "Splošno" (General) with retry
        console.log(`  📋 Step 3: Looking for "Splošno" (General)...`);
        const splosnoClicked = await this.clickElementWithRetry([
            () => this.page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('*'));
                for (const el of elements) {
                    const text = el.textContent?.toLowerCase() || '';
                    if ((text.includes('splošno') || 
                         text.includes('general') ||
                         text.includes('splošno')) && el.click) {
                        el.click();
                        return true;
                    }
                }
                return false;
            })
        ], 'Splošno');

        if (splosnoClicked) {
            console.log(`  ✅ Step 3: Found and clicked Splošno`);
            await this.delay(3000);
        } else {
            console.log(`  ⚠️  Step 3: Could not find Splošno - continuing anyway`);
        }

        // STEP 4: Click NK Maribor logo with retry
        console.log(`  🟢 Step 4: Looking for NK Maribor logo...`);
        const mariborLogoClicked = await this.clickElementWithRetry([
            () => this.page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('img, div, span, button'));
                for (const el of elements) {
                    const text = el.textContent?.toLowerCase() || '';
                    const alt = el.alt?.toLowerCase() || '';
                    const title = el.title?.toLowerCase() || '';
                    
                    if ((text.includes('maribor') || 
                         alt.includes('maribor') ||
                         title.includes('maribor')) && el.click) {
                        el.click();
                        return true;
                    }
                }
                return false;
            }),
            () => this.page.evaluate(() => {
                const images = document.querySelectorAll('img');
                for (const img of images) {
                    const src = img.src?.toLowerCase() || '';
                    if (src.includes('maribor') && img.click) {
                        img.click();
                        return true;
                    }
                }
                return false;
            })
        ], 'NK Maribor logo');

        if (mariborLogoClicked) {
            console.log(`  ✅ Step 4: Found and clicked NK Maribor logo`);
            await this.delay(5000);
        } else {
            console.log(`  ⚠️  Step 4: Could not find NK Maribor logo - extracting all data`);
        }

        // STEP 5: Extract player data from the table
        console.log(`  📊 Step 5: Extracting player data from table...`);
        const playersData = await this.page.evaluate(() => {
            const players = [];
            
            console.log('=== Extracting from Statistika table ===');
            
            // Strategy 1: Look for NK Maribor specific table/section
            let mariborTable = null;
            
            // Look for tables or sections that might contain only Maribor players
            const tables = document.querySelectorAll('table, [class*="table"], [class*="stats"]');
            
            for (const table of tables) {
                const tableText = table.textContent.toLowerCase();
                // Check if this table has multiple ratings and might be player-specific
                const ratingMatches = tableText.match(/\d\.\d/g);
                if (ratingMatches && ratingMatches.length > 8) {
                    // Check if it contains known Maribor players or Maribor reference
                    if (tableText.includes('jug') || tableText.includes('širvys') || 
                        tableText.includes('maribor') || tableText.includes('reghba')) {
                        mariborTable = table;
                        console.log('Found Maribor-specific table');
                        break;
                    }
                }
            }
            
            // Strategy 2: If no specific table found, look in all visible rows but filter for Maribor players
            const searchArea = mariborTable || document;
            const tableRows = searchArea.querySelectorAll('tr, [class*="row"], [data-testid*="row"]');
            console.log(`Found ${tableRows.length} potential table rows in search area`);
            
            // Common Maribor player names to help identify the right section
            const knownMariborPlayers = [
                'jug', 'širvys', 'iosifov', 'reghba', 'lorber', 'soudani', 'matondo', 
                'repas', 'tetteh', 'vučkić', 'milić', 'kovačević', 'sikošek'
            ];
            
            tableRows.forEach((row, index) => {
                const rowText = row.textContent || '';
                const rowTextLower = rowText.toLowerCase();
                
                // Look for player name in the row
                let playerName = null;
                const nameElements = row.querySelectorAll('td, div, span');
                
                for (const nameEl of nameElements) {
                    const text = nameEl.textContent?.trim();
                    if (text && 
                        text.length > 2 && 
                        text.length < 50 && 
                        text.match(/^[A-Za-zÀ-žčšđćž\s\-\.\']+$/) &&
                        !text.match(/^\d/) && // Not starting with number
                        !text.includes('%') &&
                        !text.includes('(') &&
                        !text.includes('Maribor') && // Skip team name itself
                        !text.includes('Celje') && // Skip opponent team name
                        text.split(' ').length <= 4) {
                        
                        playerName = text;
                        break;
                    }
                }
                
                // Look for rating in the same row (rightmost column usually)
                let playerRating = null;
                const ratingElements = row.querySelectorAll('td, div, span');
                
                // Check the last few elements for ratings (usually rightmost)
                for (let i = ratingElements.length - 1; i >= Math.max(0, ratingElements.length - 5); i--) {
                    const text = ratingElements[i].textContent?.trim();
                    const ratingMatch = text?.match(/^(\d\.\d)$/);
                    
                    if (ratingMatch) {
                        const rating = parseFloat(ratingMatch[1]);
                        if (rating >= 5.0 && rating <= 10.0) {
                            playerRating = rating;
                            break;
                        }
                    }
                }
                
                if (playerName && playerRating) {
                    // Additional filtering: if we have a mix of teams, try to identify Maribor players
                    const playerNameLower = playerName.toLowerCase();
                    const isLikelyMariborPlayer = knownMariborPlayers.some(known => 
                        playerNameLower.includes(known)
                    );
                    
                    // If we already have players, check consistency
                    if (players.length === 0 || isLikelyMariborPlayer || 
                        !rowTextLower.includes('celje')) { // Avoid Celje players if possible
                        
                        // Avoid duplicates
                        const alreadyExists = players.some(p => 
                            p.name.toLowerCase() === playerNameLower
                        );
                        
                        if (!alreadyExists) {
                            players.push({
                                name: playerName,
                                rating: playerRating,
                                position: players.length < 11 ? 'starting_xi' : 'substitute',
                                isStartingXI: players.length < 11
                            });
                            console.log(`Found: ${playerName} - ${playerRating}`);
                        }
                    }
                }
            });
            
            // If we still have mixed teams, try to filter out non-Maribor players
            if (players.length > 0) {
                const filteredPlayers = players.filter(player => {
                    const playerNameLower = player.name.toLowerCase();
                    
                    // Keep players that are likely Maribor players
                    const isKnownMaribor = knownMariborPlayers.some(known => 
                        playerNameLower.includes(known)
                    );
                    
                    // Keep players that don't seem to be from Celje
                    const notCeljePlayer = !playerNameLower.includes('iosifov') || 
                                          playerNameLower.includes('nikita'); // Nikita Iosifov is actually from Celje
                    
                    return isKnownMaribor || (players.length <= 11 ? true : notCeljePlayer);
                });
                
                if (filteredPlayers.length >= 5) {
                    console.log(`Filtered to ${filteredPlayers.length} likely Maribor players`);
                    return filteredPlayers.map((player, index) => ({
                        ...player,
                        position: index < 11 ? 'starting_xi' : 'substitute',
                        isStartingXI: index < 11
                    }));
                }
            }
            
            console.log(`Total players extracted: ${players.length}`);
            return players;
        });

        console.log(`  📊 Extracted ${playersData.length} players with ratings`);

        const gameData = {
            id: this.generateGameId(gameInfo.url),
            url: gameInfo.url,
            date: gameInfo.dateString,
            homeTeam: gameBasicInfo.homeTeam,
            awayTeam: gameBasicInfo.awayTeam,
            score: gameBasicInfo.score,
            players: playersData,
            hasRatings: playersData.length > 0,
            scrapedAt: new Date().toISOString()
        };

        return gameData;
    }

    async clickElementWithRetry(strategies, elementName) {
        for (let strategy of strategies) {
            try {
                const result = await strategy();
                if (result) {
                    return true;
                }
            } catch (error) {
                console.log(`    Strategy failed for ${elementName}: ${error.message}`);
            }
            await this.delay(1000);
        }
        return false;
    }

    generateGameId(url) {
        const parts = url.split('/');
        return parts[parts.length - 1] || Date.now().toString();
    }

    async saveData(data) {
        try {
            const dataDir = path.dirname(this.dataPath);
            await fs.mkdir(dataDir, { recursive: true });
            await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2));
            console.log(`\n💾 Data saved to ${this.dataPath}`);
        } catch (error) {
            console.error('Error saving data:', error);
            throw error;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Run scraper if called directly
if (require.main === module) {
    const scraper = new MariborScraper();
    scraper.scrapeGames()
        .then(data => {
            console.log('\n🎉 Fixed detection scraping completed!');
            console.log(`📊 Successfully scraped ${data.length} games from SofaScore`);
            
            if (data.length > 0) {
                console.log('\n📋 Real games scraped:');
                data.forEach((game, index) => {
                    const ratingStatus = game.hasRatings ? 
                        `${game.players.length} players with ratings` : 
                        'No ratings available (correctly detected)';
                    console.log(`  ${index + 1}. ${game.homeTeam} vs ${game.awayTeam} (${game.score}) - ${ratingStatus}`);
                    
                    if (game.players.length > 0) {
                        console.log(`      Players: ${game.players.slice(0, 3).map(p => `${p.name} (${p.rating})`).join(', ')}${game.players.length > 3 ? '...' : ''}`);
                    }
                });
                console.log('\n🚀 Your app is ready! Run: npm start');
            }
            
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Scraping failed:', error.message);
            process.exit(1);
        });
}

module.exports = MariborScraper;