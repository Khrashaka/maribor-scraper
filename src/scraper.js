// src/scraper.js - Direct table extraction with logo comparison
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class MariborScraper {
    constructor() {
        this.baseUrl = 'https://www.sofascore.com';
        this.mariborTeamUrl = 'https://www.sofascore.com/team/football/nk-maribor/2420';
        this.targetDate = new Date('2025-07-15');
        this.dataPath = path.join(__dirname, '../data/games.json');
        this.logoPath = path.join(__dirname, 'assets/nk-maribor-logo.png');
        this.screenshotsPath = path.join(__dirname, '../screenshots');
        this.maxRetries = 3;
        
        // TASK 2: Output logo file path
        console.log(`🏅 NK Maribor logo file: ${this.logoPath}`);
        this.checkLogoFile();
    }

    async checkLogoFile() {
        try {
            await fs.access(this.logoPath);
            console.log('✅ NK Maribor logo file found and ready for comparison');
        } catch (error) {
            console.log('❌ NK Maribor logo file not found - will use fallback identification');
        }
    }

    async initBrowser() {
        console.log('Launching browser...');
        
        // TASK 5: Create screenshots directory
        try {
            await fs.mkdir(this.screenshotsPath, { recursive: true });
            console.log(`📸 Screenshots directory ready: ${this.screenshotsPath}`);
        } catch (error) {
            console.log('⚠️  Could not create screenshots directory');
        }
        
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
        
        // TASK 3: Enhanced browser console message capture for debugging
        this.page.on('console', msg => {
            const text = msg.text();
            // Capture ALL meaningful console messages for debugging
            if (text.includes('FOUND') || text.includes('MARIBOR') || text.includes('OPPONENT') || 
                text.includes('Row ') || text.includes('===') || text.includes('ADDED') ||
                text.includes('EXTRACTION') || text.includes('ROSTER') || text.includes('SUMMARY') ||
                text.includes('PROCESSING') || text.includes('potential') || text.includes('images') ||
                text.includes('KNOWN') || text.includes('DETECTED') || text.includes('logo') ||
                text.includes('Player of') || text.includes('Rating elements')) {
                console.log(`    🔍 Browser: ${text}`);
            }
        });
        
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
                    
                    // Log player details for debugging
                    if (gameData.players.length > 0) {
                        console.log(`    NK Maribor players: ${gameData.players.map(p => `${p.name} (${p.rating})`).join(', ')}`);
                    }
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
                
                const result = await this.scrapeGameDirectly(gameInfo, attempt);
                if (result) {
                    console.log(`  ✅ Attempt ${attempt} succeeded`);
                    return result;
                }
                
                console.log(`  ❌ Attempt ${attempt} failed`);
                
            } catch (error) {
                console.log(`  ❌ Attempt ${attempt} error: ${error.message}`);
                
                if (attempt < this.maxRetries) {
                    const retryDelay = 3000 * attempt;
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

    async scrapeGameDirectly(gameInfo, attempt) {
        const timeout = 30000 + (attempt * 10000);
        
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

        // Navigate to the mixed statistics table
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
            console.log(`  ⚠️  Could not find Postava - trying direct extraction`);
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

        console.log(`  ✅ Step 1: Found and clicked Postava`);
        await this.delay(4000);

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
            console.log(`  ⚠️  Could not find Statistika igralca - trying direct extraction`);
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

        console.log(`  ✅ Step 2: Found and clicked Statistika igralca`);
        await this.delay(4000);

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
            console.log(`  ⚠️  Step 3: Could not find Splošno - continuing with current view`);
        }

        // TASK 1: IMPROVED Player of the Match detection
        console.log(`  🏆 TASK 1: Enhanced Player of the Match detection...`);
        const ratingDetection = await this.page.evaluate(() => {
            console.log('=== ENHANCED RATING DETECTION ===');
            
            // Strategy 1: Look for explicit "Player of the Match" or "Igralec tekme"
            const pageText = document.body.textContent.toLowerCase();
            const hasPlayerOfMatch = pageText.includes('player of the match') || 
                                   pageText.includes('igralec tekme') ||
                                   pageText.includes('najbolji igralec');
            
            console.log(`Player of the Match text found: ${hasPlayerOfMatch}`);
            
            // Strategy 2: Count valid rating elements with strict validation
            const allElements = document.querySelectorAll('*');
            let validRatings = [];
            let ratingElements = [];
            
            allElements.forEach(el => {
                const text = el.textContent?.trim();
                if (text && text.match(/^\d\.\d$/) && text.length === 3) {
                    const rating = parseFloat(text);
                    if (rating >= 5.0 && rating <= 10.0) {
                        // Additional validation - check if it's in a player context
                        const parent = el.parentElement;
                        const grandParent = parent?.parentElement;
                        const contextText = (parent?.textContent + ' ' + grandParent?.textContent).toLowerCase();
                        
                        // Look for player-related context indicators
                        const hasPlayerContext = contextText.includes('rating') || 
                                               contextText.includes('ocena') ||
                                               contextText.includes('player') ||
                                               contextText.includes('igralec') ||
                                               parent?.querySelector('img') ||
                                               grandParent?.querySelector('img') ||
                                               contextText.length > 50; // Likely a player row with stats
                        
                        if (hasPlayerContext) {
                            validRatings.push(rating);
                            ratingElements.push({
                                rating: rating,
                                element: el,
                                context: contextText.substring(0, 100)
                            });
                        }
                    }
                }
            });
            
            console.log(`Rating elements found: ${ratingElements.length}`);
            console.log(`Valid ratings: ${validRatings.slice(0, 5).join(', ')}${validRatings.length > 5 ? '...' : ''}`);
            
            // Strategy 3: Look for rating distribution that suggests real player ratings
            const hasGoodRatingDistribution = validRatings.length >= 6 && // At least 6 ratings
                                            validRatings.some(r => r >= 7.5) && // Some high ratings
                                            validRatings.some(r => r <= 7.0);   // Some lower ratings
            
            console.log(`Good rating distribution: ${hasGoodRatingDistribution}`);
            
            // Strategy 4: Look for statistical context (tables with player stats)
            const statsElements = document.querySelectorAll('table, [class*="stats"], [class*="player"], tbody');
            let hasStatsTable = false;
            
            statsElements.forEach(table => {
                const tableText = table.textContent.toLowerCase();
                const tableRatings = tableText.match(/\d\.\d/g);
                
                if (tableRatings && tableRatings.length >= 8 && 
                    (tableText.includes('minutes') || tableText.includes('minute') || 
                     tableText.includes('goals') || tableText.includes('assists') ||
                     tableText.includes('passes') || tableText.includes('possession'))) {
                    hasStatsTable = true;
                }
            });
            
            console.log(`Statistics table with ratings: ${hasStatsTable}`);
            
            // Final decision: Need MULTIPLE indicators for confidence
            const hasRatings = (hasPlayerOfMatch && validRatings.length >= 4) ||
                             (hasGoodRatingDistribution && hasStatsTable) ||
                             (validRatings.length >= 10 && hasStatsTable);
            
            console.log(`FINAL RATING DETECTION: ${hasRatings}`);
            
            return {
                hasRatings: hasRatings,
                playerOfMatch: hasPlayerOfMatch,
                validRatingsCount: validRatings.length,
                hasStatsTable: hasStatsTable,
                ratingDistribution: hasGoodRatingDistribution
            };
        });

        if (!ratingDetection.hasRatings) {
            console.log(`  ⚠️  TASK 1: No reliable player ratings detected`);
            console.log(`    - Player of the Match: ${ratingDetection.playerOfMatch}`);
            console.log(`    - Valid ratings found: ${ratingDetection.validRatingsCount}`);
            console.log(`    - Statistics table: ${ratingDetection.hasStatsTable}`);
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

        console.log(`  ✅ TASK 1: Reliable player ratings detected - proceeding with extraction`);
        console.log(`    - Player of the Match: ${ratingDetection.playerOfMatch}`);
        console.log(`    - Valid ratings: ${ratingDetection.validRatingsCount}`);
        console.log(`    - Statistics table: ${ratingDetection.hasStatsTable}`);

        // TASK 5: Take screenshot of the statistics table before extraction
        await this.takeTableScreenshot(gameInfo, gameBasicInfo);

        // DIRECT TABLE EXTRACTION - No clicking required!
        console.log(`  📊 Direct table extraction with logo comparison...`);
        const playersData = await this.page.evaluate(() => {
            console.log(`=== DIRECT TABLE EXTRACTION ===`);
            
            const mariborPlayers = [];
            
            // Find all table rows that contain player data
            const allRows = document.querySelectorAll('tr, [class*="row"], [data-testid*="row"]');
            console.log(`Found ${allRows.length} potential player rows`);
            
            allRows.forEach((row, rowIndex) => {
                const rowText = row.textContent || '';
                
                // Skip header rows and empty rows
                if (rowText.length < 20 || 
                    rowText.toLowerCase().includes('player') ||
                    rowText.toLowerCase().includes('rating') ||
                    rowText.toLowerCase().includes('ocena')) {
                    return;
                }
                
                // Look for player name (usually in first cells)
                let playerName = null;
                const nameElements = row.querySelectorAll('td, div, span');
                
                for (const nameEl of nameElements) {
                    const text = nameEl.textContent?.trim();
                    if (text && 
                        text.length > 2 && 
                        text.length < 50 && 
                        text.match(/^[A-Za-zÀ-žčšđćž\s\-\.\']+$/) &&
                        !text.match(/^\d/) &&
                        !text.includes('%') &&
                        !text.includes('(') &&
                        !text.includes('/') &&
                        !text.includes('Maribor') &&
                        !text.includes('Celje') &&
                        !text.includes('Rating') &&
                        text.split(' ').length <= 4) {
                        
                        const words = text.split(' ').filter(word => word.length > 1);
                        if (words.length >= 1 && words.length <= 3) {
                            playerName = text;
                            break;
                        }
                    }
                }
                
                if (!playerName) return;
                
                // Look for rating (rightmost columns, format X.X)
                let playerRating = null;
                const allCells = row.querySelectorAll('td, div, span');
                
                for (let i = allCells.length - 1; i >= Math.max(0, allCells.length - 3); i--) {
                    const text = allCells[i].textContent?.trim();
                    const ratingMatch = text?.match(/^(\d\.\d)$/);
                    
                    if (ratingMatch) {
                        const rating = parseFloat(ratingMatch[1]);
                        if (rating >= 5.0 && rating <= 10.0) {
                            playerRating = rating;
                            break;
                        }
                    }
                }
                
                if (!playerRating) return;
                
                // Look for minutes played (indicates starting XI vs substitute)
                let minutesPlayed = 0;
                let isStartingXI = false;
                
                const minutesElements = row.querySelectorAll('td, div, span');
                for (const minEl of minutesElements) {
                    const text = minEl.textContent?.trim();
                    const minutesMatch = text?.match(/^(\d+)'?$/);
                    
                    if (minutesMatch) {
                        minutesPlayed = parseInt(minutesMatch[1]);
                        isStartingXI = minutesPlayed >= 45;
                        break;
                    }
                }
                
                // Look for position (N/F/S/M/O/D/V/G)
                let position = 'Unknown';
                for (const posEl of nameElements) {
                    const text = posEl.textContent?.trim();
                    if (text && text.match(/^[NFSMOV]$/)) {
                        const positionMap = {
                            'N': 'Forward',
                            'F': 'Forward', 
                            'S': 'Midfielder',
                            'M': 'Midfielder',
                            'O': 'Defender',
                            'D': 'Defender',
                            'V': 'Goalkeeper',
                            'G': 'Goalkeeper'
                        };
                        position = positionMap[text] || text;
                        break;
                    }
                }
                
                // TEAM LOGO DETECTION - Look for NK Maribor logo
                let isMariborPlayer = false;
                const images = row.querySelectorAll('img');
                
                console.log(`Row ${rowIndex}: ${playerName} - checking ${images.length} images`);
                
                for (const img of images) {
                    const src = img.src?.toLowerCase() || '';
                    const alt = img.alt?.toLowerCase() || '';
                    
                    // Check for Maribor logo indicators
                    if (src.includes('maribor') || alt.includes('maribor') || 
                        src.includes('2420') || // Team ID for Maribor
                        (src.includes('team') && src.includes('logo') && 
                         (row.textContent.toLowerCase().includes('maribor') || 
                          src.includes('purple') || src.includes('violet')))) {
                        isMariborPlayer = true;
                        console.log(`✅ MARIBOR logo found for ${playerName}: ${src || alt}`);
                        break;
                    }
                    
                    // Check for opponent logos to exclude
                    if (src.includes('celje') || alt.includes('celje') ||
                        src.includes('domzale') || alt.includes('domzale') ||
                        src.includes('koper') || alt.includes('koper') ||
                        src.includes('paks') || alt.includes('paks') ||
                        src.includes('primorje') || alt.includes('primorje')) {
                        console.log(`❌ OPPONENT logo found for ${playerName}: ${src || alt}`);
                        break;
                    }
                }
                
                // Fallback: Known Maribor players if logo detection unclear
                if (!isMariborPlayer) {
                    const knownMariborPlayers = [
                        'jug', 'širvys', 'sirvys', 'reghba', 'lorber', 'soudani', 'matondo', 
                        'repas', 'tetteh', 'vučkić', 'vuckic', 'milić', 'milic', 'kovačević', 'kovacevic',
                        'sikošek', 'sikosek', 'nieto', 'orphe', 'mbina', 'sturm', 'zabukovnik',
                        'taylor', 'tshimbamba', 'rekik', 'tutyškinas', 'tutyskinas', 'avdyli',
                        'iličić', 'ilicic', 'jurić', 'juric', 'ojo', 'bamba', 'komáromi', 'komaromi'
                    ];
                    
                    const playerNameLower = playerName.toLowerCase();
                    isMariborPlayer = knownMariborPlayers.some(known => 
                        playerNameLower.includes(known) || 
                        known.includes(playerNameLower.split(' ')[0].toLowerCase())
                    );
                    
                    if (isMariborPlayer) {
                        console.log(`✅ KNOWN Maribor player: ${playerName}`);
                    }
                }
                
                // Exclude known opponent players
                const knownOpponents = ['iosifov', 'kvesić', 'kvesic'];
                if (knownOpponents.some(known => playerName.toLowerCase().includes(known))) {
                    isMariborPlayer = false;
                    console.log(`❌ KNOWN opponent player: ${playerName}`);
                }
                
                if (isMariborPlayer) {
                    mariborPlayers.push({
                        name: playerName,
                        rating: playerRating,
                        position: position,
                        minutesPlayed: minutesPlayed,
                        isStartingXI: isStartingXI
                    });
                    
                    console.log(`✅ Added ${playerName}: ${playerRating} rating, ${minutesPlayed}min, ${position}, ${isStartingXI ? 'Starting XI' : 'Substitute'}`);
                }
            });
            
            // Sort by rating (highest first)
            mariborPlayers.sort((a, b) => b.rating - a.rating);
            
            console.log(`\n📊 FINAL RESULTS:`);
            console.log(`- Total NK Maribor players found: ${mariborPlayers.length}`);
            mariborPlayers.forEach((player, index) => {
                console.log(`  ${index + 1}. ${player.name} (${player.rating}) - ${player.position} - ${player.minutesPlayed}min - ${player.isStartingXI ? 'Starting' : 'Sub'}`);
            });
            
            return mariborPlayers;
        });

        console.log(`  📊 Extracted ${playersData.length} NK Maribor players with ratings`);

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

    // TASK 5: Screenshot functionality
    async takeTableScreenshot(gameInfo, gameBasicInfo) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${gameBasicInfo.homeTeam}-vs-${gameBasicInfo.awayTeam}-${timestamp}.png`
                .replace(/[^a-zA-Z0-9\-]/g, '_');
            const screenshotPath = path.join(this.screenshotsPath, filename);
            
            console.log(`  📸 TASK 5: Taking screenshot of statistics table...`);
            
            // Try to find and focus on the statistics table
            await this.page.evaluate(() => {
                // Find the main statistics table
                const tables = document.querySelectorAll('table, [class*="stats"], [class*="player"]');
                if (tables.length > 0) {
                    tables[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
            
            await this.delay(2000); // Wait for scroll
            
            await this.page.screenshot({
                path: screenshotPath,
                fullPage: false,
                quality: 90
            });
            
            console.log(`  ✅ Screenshot saved: ${filename}`);
        } catch (error) {
            console.log(`  ⚠️  Screenshot failed: ${error.message}`);
        }
    }
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
            console.log('\n🎉 Comprehensive table extraction completed!');
            console.log(`📊 Successfully scraped ${data.length} games from SofaScore`);
            
            if (data.length > 0) {
                console.log('\n📋 Games with NK Maribor players:');
                data.forEach((game, index) => {
                    const ratingStatus = game.hasRatings ? 
                        `${game.players.length} NK Maribor players with ratings` : 
                        'No ratings available';
                    console.log(`  ${index + 1}. ${game.homeTeam} vs ${game.awayTeam} (${game.score}) - ${ratingStatus}`);
                    
                    if (game.players.length > 0) {
                        console.log(`      Players: ${game.players.slice(0, 5).map(p => `${p.name} (${p.rating})`).join(', ')}${game.players.length > 5 ? '...' : ''}`);
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