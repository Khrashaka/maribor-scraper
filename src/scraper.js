// src/scraper.js - Fixed NK Maribor player scraper with position extraction
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class MariborScraper {
    constructor() {
        this.baseUrl = 'https://www.sofascore.com';
        this.mariborTeamUrl = 'https://www.sofascore.com/team/football/nk-maribor/2420';
        this.targetDate = new Date('2025-07-15');
        this.dataPath = path.join(__dirname, '../data/games.json');
        this.screenshotsPath = path.join(__dirname, '../screenshots');
        this.maxRetries = 3;
    }

    async initBrowser() {
        this.browser = await puppeteer.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        this.page = await this.browser.newPage();
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await this.page.setViewport({ width: 1366, height: 768 });
        this.page.setDefaultTimeout(45000);

        // Create screenshots directory
        await fs.mkdir(this.screenshotsPath, { recursive: true });
    }

    async scrapeGames() {
        try {
            await this.initBrowser();
            console.log('🔗 Connecting to NK Maribor SofaScore page...');

            await this.page.goto(this.mariborTeamUrl, { waitUntil: 'networkidle0' });

            // Handle cookie popup once at the beginning
            const popupHandled = await this.handleCookiePopup();
            if (popupHandled) {
                console.log('🍪 Cookie popup resolved');
                await this.delay(2000); // Wait for popup to close
            }

            // Get qualified games
            const gameLinks = await this.getQualifiedGames();
            console.log(`📅 Found ${gameLinks.length} finished matches after ${this.targetDate.toDateString()}`);

            if (gameLinks.length === 0) {
                await this.saveData([]);
                return [];
            }

            const gamesData = [];
            for (let i = 0; i < gameLinks.length; i++) {
                console.log(`\n🎯 Match ${i + 1}/${gameLinks.length}: ${gameLinks[i].teams}`);
                
                const gameData = await this.scrapeGameWithRetries(gameLinks[i]);
                if (gameData) {
                    gamesData.push(gameData);
                }
            }

            await this.saveData(gamesData);
            
            // Summary
            console.log('\n📊 EXTRACTION SUMMARY:');
            gamesData.forEach((game, index) => {
                console.log(`  ${index + 1}. ${game.homeTeam} vs ${game.awayTeam}: ${game.players.length} players`);
            });

            return gamesData;

        } catch (error) {
            console.error('❌ Scraping failed:', error.message);
            throw error;
        } finally {
            if (this.browser) await this.browser.close();
        }
    }

    async handleCookiePopup() {
        try {
            return await this.page.evaluate(() => {
                // Look for common cookie consent buttons
                const buttons = Array.from(document.querySelectorAll('button'));
                const consentButton = buttons.find(btn => 
                    btn.textContent?.toLowerCase().includes('consent') ||
                    btn.textContent?.toLowerCase().includes('accept') ||
                    btn.textContent?.toLowerCase().includes('agree')
                );
                if (consentButton) {
                    consentButton.click();
                    return true;
                }
                return false;
            });
        } catch (e) {
            return false;
        }
    }

    async getQualifiedGames() {
        // Click results tab if available
        try {
            await this.page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('*'));
                const resultsTab = elements.find(el => 
                    el.textContent && (el.textContent.toLowerCase().includes('all') || 
                                     el.textContent.toLowerCase().includes('results'))
                );
                if (resultsTab) resultsTab.click();
            });
            await this.delay(2000);
        } catch (e) {}

        // Scroll to load matches
        for (let i = 0; i < 3; i++) {
            await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await this.delay(1000);
        }

        return await this.page.evaluate((targetDateStr) => {
            const targetDate = new Date(targetDateStr);
            const links = [];
            const matchLinks = document.querySelectorAll('a[href*="/match/"]');
            
            matchLinks.forEach(link => {
                const href = link.href;
                const parent = link.closest('[class*="event"], [class*="match"]');
                
                if (href && parent) {
                    const fullText = parent.textContent || '';
                    const teams = link.textContent.trim();
                    
                    // Extract date
                    const dateMatch = fullText.match(/(\d{2})\/(\d{2})\/(\d{2})/);
                    if (dateMatch) {
                        const [, day, month, year] = dateMatch;
                        const gameDate = new Date(2000 + parseInt(year), parseInt(month) - 1, parseInt(day));
                        
                        if (fullText.includes('FT') && gameDate >= targetDate && gameDate <= new Date()) {
                            links.push({
                                url: href,
                                teams: teams,
                                date: gameDate,
                                dateString: gameDate.toLocaleDateString()
                            });
                        }
                    }
                }
            });
            
            return links.sort((a, b) => b.date - a.date);
        }, this.targetDate.toISOString());
    }

    async scrapeGameWithRetries(gameInfo) {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                console.log(`🔄 Retry ${attempt}/${this.maxRetries}`);
                
                const result = await this.scrapeGame(gameInfo);
                if (result) return result;
                
                // If we reach here, result was null/undefined
                console.log(`⚠️  Attempt ${attempt} returned no result`);
                
            } catch (error) {
                console.log(`❌ Attempt ${attempt} error: ${error.message}`);
                
                if (attempt === this.maxRetries) {
                    console.log('❌ All retries failed, going to next match');
                    return null;
                }
            }
        }
        
        console.log('❌ All retries failed, going to next match');
        return null;
    }

    async scrapeGame(gameInfo) {
        await this.page.goto(gameInfo.url, { waitUntil: 'networkidle0' });
        await this.delay(2000);

        // Extract basic game info
        const gameBasicInfo = await this.page.evaluate(() => {
            const title = document.title || '';
            let homeTeam = 'Unknown', awayTeam = 'Unknown', score = '0-0';
            
            if (title.includes(' vs ')) {
                const [home, away] = title.split(' vs ');
                homeTeam = home.trim();
                awayTeam = away.split(' live score')[0].split(' |')[0].trim();
            }
            
            // Find score
            const scoreElements = document.querySelectorAll('*');
            for (const el of scoreElements) {
                const text = el.textContent?.trim();
                if (text && text.match(/^\d+\s*[-:]\s*\d+$/) && text.length <= 10) {
                    score = text;
                    break;
                }
            }
            
            return { homeTeam, awayTeam, score };
        });

        // Check for Player of the Match with stricter validation
        const ratingDetection = await this.page.evaluate(() => {
            // Strategy 1: Look for actual player ratings (X.X format)
            const allElements = document.querySelectorAll('*');
            let validRatings = [];
            
            allElements.forEach(el => {
                const text = el.textContent?.trim();
                if (text && text.match(/^\d\.\d$/) && text.length === 3) {
                    const rating = parseFloat(text);
                    if (rating >= 5.0 && rating <= 10.0) {
                        // Check if this rating is in a player context
                        const parent = el.parentElement;
                        const grandParent = parent?.parentElement;
                        const contextText = (parent?.textContent + ' ' + grandParent?.textContent).toLowerCase();
                        
                        // Must have player context indicators
                        if (contextText.includes('rating') || 
                            contextText.includes('ocena') ||
                            parent?.querySelector('img') ||
                            grandParent?.querySelector('img') ||
                            contextText.length > 50) {
                            validRatings.push(rating);
                        }
                    }
                }
            });
            
            // Strategy 2: Look for Player of the Match text near actual ratings
            const pageText = document.body.textContent.toLowerCase();
            const hasPlayerOfMatchText = pageText.includes('player of the match') || 
                                       pageText.includes('igralec tekme') ||
                                       pageText.includes('najbolji igralec');
            
            // Strategy 3: Check for statistics table with multiple ratings
            const hasStatsTable = validRatings.length >= 8; // Need at least 8 player ratings
            
            // Strategy 4: Check for rating distribution that suggests real player data
            const hasGoodDistribution = validRatings.length >= 6 && 
                                      validRatings.some(r => r >= 7.5) && 
                                      validRatings.some(r => r <= 7.0);
            
            // Final decision: Must have BOTH text indicator AND actual ratings
            return {
                hasRatings: (hasPlayerOfMatchText && hasStatsTable) || hasGoodDistribution,
                playerOfMatchText: hasPlayerOfMatchText,
                ratingsCount: validRatings.length,
                hasStatsTable: hasStatsTable
            };
        });

        if (!ratingDetection.hasRatings) {
            console.log('⚠️  No reliable player ratings found, going to next match');
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

        console.log('✅ Reliable player ratings detected');

        // Navigate to statistics
        if (!await this.navigateToStats()) {
            throw new Error('Navigation failed');
        }

        console.log('📊 Found table');

        // Wait for table to fully load, then take screenshot
        await this.delay(2000);
        await this.takeScreenshot(gameInfo, gameBasicInfo);
        console.log('📸 Screenshot taken');

        // Extract players
        const players = await this.extractMariborPlayers();
        console.log(`👥 Extracted ${players.length} players`);
        console.log('➡️  Going to next match');

        return {
            id: this.generateGameId(gameInfo.url),
            url: gameInfo.url,
            date: gameInfo.dateString,
            homeTeam: gameBasicInfo.homeTeam,
            awayTeam: gameBasicInfo.awayTeam,
            score: gameBasicInfo.score,
            players: players,
            hasRatings: players.length > 0,
            scrapedAt: new Date().toISOString()
        };
    }

    async navigateToStats() {
        console.log('🔄 Starting navigation to player statistics...');
        
        // Step 1: Navigate to Lineups/Postava - be very specific about what we click
        console.log('🎯 Step 1: Looking for Lineup tab...');
        const lineupClicked = await this.page.evaluate(() => {
            // Strategy 1: Look for actual navigation buttons/links with specific characteristics
            const lineupCandidates = document.querySelectorAll('a, button, [role="tab"], [role="button"]');
            
            for (const element of lineupCandidates) {
                const text = element.textContent?.trim().toLowerCase() || '';
                const parentText = element.parentElement?.textContent?.trim().toLowerCase() || '';
                
                // Must be a short text element (navigation tabs are usually short)
                if (text.length > 20 || parentText.length > 100) continue;
                
                // Must contain lineup/postava
                if ((text === 'postava' || text === 'lineup' || text === 'lineups') && 
                    typeof element.click === 'function') {
                    element.click();
                    return { method: 'exact-match', text: element.textContent?.trim() };
                }
            }
            
            // Strategy 2: Look for elements in navigation-like containers
            const navContainers = document.querySelectorAll('[class*="nav"], [class*="tab"], [class*="menu"]');
            for (const container of navContainers) {
                const buttons = container.querySelectorAll('a, button, span, div');
                for (const btn of buttons) {
                    const text = btn.textContent?.trim().toLowerCase() || '';
                    if ((text === 'postava' || text === 'lineup' || text === 'lineups') && 
                        text.length <= 20 && typeof btn.click === 'function') {
                        btn.click();
                        return { method: 'nav-container', text: btn.textContent?.trim() };
                    }
                }
            }
            
            return null;
        });

        if (!lineupClicked) {
            console.log('❌ Could not find Lineup tab');
            return false;
        }
        
        console.log(`✅ Clicked lineup tab: "${lineupClicked.text}" (method: ${lineupClicked.method})`);
        await this.delay(4000);

        // Step 2: Navigate to Player Statistics - be very specific
        console.log('🎯 Step 2: Looking for Player Statistics tab...');
        
        // Wait for content to load
        await this.page.waitForFunction(() => {
            return document.querySelectorAll('button, a, [role="tab"]').length > 10;
        }, { timeout: 10000 }).catch(() => {
            console.log('⚠️  Timeout waiting for navigation elements');
        });

        const statsClicked = await this.page.evaluate(() => {
            // Strategy 1: Look for buttons/links with exact statistics text
            const statsCandidates = document.querySelectorAll('a, button, [role="tab"], [role="button"]');
            
            for (const element of statsCandidates) {
                const text = element.textContent?.trim().toLowerCase() || '';
                
                // Must be short and specific
                if (text.length > 30) continue;
                
                // Look for player statistics variations
                if ((text.includes('player stat') || 
                     text.includes('statistika igralca') || 
                     text === 'player stats' ||
                     text === 'statistika' && text.length <= 15) &&
                    typeof element.click === 'function') {
                    element.click();
                    return { method: 'exact-stats', text: element.textContent?.trim() };
                }
            }
            
            // Strategy 2: Look in tab-like containers
            const tabContainers = document.querySelectorAll('[class*="tab"], [role="tablist"], [class*="nav"]');
            for (const container of tabContainers) {
                const tabs = container.querySelectorAll('button, a, span, div');
                for (const tab of tabs) {
                    const text = tab.textContent?.trim().toLowerCase() || '';
                    if (text.length <= 25 && 
                        (text.includes('stat') || text.includes('player')) &&
                        typeof tab.click === 'function') {
                        tab.click();
                        return { method: 'tab-container', text: tab.textContent?.trim() };
                    }
                }
            }
            
            // Strategy 3: Look for elements with "Player stats" in nearby headings
            const headings = document.querySelectorAll('h1, h2, h3, h4');
            for (const heading of headings) {
                if (heading.textContent?.toLowerCase().includes('player')) {
                    const container = heading.closest('div, section');
                    if (container) {
                        const buttons = container.querySelectorAll('button, a');
                        for (const btn of buttons) {
                            const text = btn.textContent?.trim().toLowerCase() || '';
                            if (text.includes('stat') && text.length <= 20 && typeof btn.click === 'function') {
                                btn.click();
                                return { method: 'heading-context', text: btn.textContent?.trim() };
                            }
                        }
                    }
                }
            }
            
            return null;
        });

        if (!statsClicked) {
            console.log('❌ Could not find Player Statistics tab');
            
            // Debug: Show what short navigation-like elements are available
            const debugInfo = await this.page.evaluate(() => {
                const shortElements = [];
                const candidates = document.querySelectorAll('a, button, [role="tab"], [role="button"]');
                
                candidates.forEach((el, index) => {
                    if (index < 15) { // Limit output
                        const text = el.textContent?.trim() || '';
                        if (text.length > 0 && text.length <= 30) {
                            shortElements.push(text);
                        }
                    }
                });
                
                return shortElements;
            });
            
            console.log('🔍 Available short clickable elements (first 15):');
            debugInfo.forEach(text => console.log(`   - "${text}"`));
            return false;
        }

        console.log(`✅ Clicked statistics: "${statsClicked.text}" (method: ${statsClicked.method})`);
        await this.delay(4000);

        // Step 3: Verify we're on a page with player statistics table
        console.log('🎯 Step 3: Verifying we reached player statistics...');
        
        const verification = await this.page.evaluate(() => {
            // Look for actual table structures with player data
            const tables = document.querySelectorAll('table, [role="table"]');
            let playerTableFound = false;
            let ratingCount = 0;
            let playerNameCount = 0;
            
            for (const table of tables) {
                const cells = table.querySelectorAll('td, th, [role="cell"]');
                let tableRatings = 0;
                let tablePlayerNames = 0;
                
                for (const cell of cells) {
                    const text = cell.textContent?.trim();
                    
                    // Count ratings (X.X format, standalone)
                    if (text && text.match(/^\d\.\d$/) && text.length === 3) {
                        const rating = parseFloat(text);
                        if (rating >= 5.0 && rating <= 10.0) {
                            tableRatings++;
                        }
                    }
                    
                    // Count player names (text that looks like names, not too long)
                    if (text && text.length > 3 && text.length < 30 && 
                        text.match(/^[A-Za-zÀ-žčšđćž\s\-\.\']+$/) && 
                        !text.match(/^\d/) && 
                        !text.toLowerCase().includes('team') &&
                        !text.toLowerCase().includes('player')) {
                        tablePlayerNames++;
                    }
                }
                
                // A player stats table should have multiple ratings and names
                if (tableRatings >= 8 && tablePlayerNames >= 8) {
                    playerTableFound = true;
                    ratingCount += tableRatings;
                    playerNameCount += tablePlayerNames;
                }
            }
            
            return {
                hasPlayerTable: playerTableFound,
                ratingCount: ratingCount,
                playerNameCount: playerNameCount,
                tableCount: tables.length
            };
        });

        if (verification.hasPlayerTable) {
            console.log(`✅ Navigation successful! Found player statistics table with ${verification.ratingCount} ratings and ${verification.playerNameCount} player names`);
            return true;
        } else {
            console.log(`❌ Navigation failed. Found ${verification.tableCount} tables, ${verification.ratingCount} ratings, ${verification.playerNameCount} names`);
            
            // Take debug screenshot
            try {
                await this.page.screenshot({ 
                    path: path.join(this.screenshotsPath, `debug-failed-navigation-${Date.now()}.png`)
                });
                console.log('📸 Debug screenshot taken');
            } catch (e) {
                console.log('⚠️  Could not take debug screenshot');
            }
            
            return false;
        }
    }

    async extractMariborPlayers() {
        return await this.page.evaluate(() => {
            const mariborPlayers = [];
            
            // First, find actual player statistics tables (not just any table)
            const tables = document.querySelectorAll('table, [role="table"]');
            let playerTable = null;
            
            for (const table of tables) {
                const rows = table.querySelectorAll('tr');
                let ratingCount = 0;
                let nameCount = 0;
                
                // Count potential player data in this table
                for (const row of rows) {
                    const text = row.textContent || '';
                    if (text.match(/\d\.\d/)) ratingCount++;
                    if (text.match(/[A-Za-zÀ-žčšđćž]{3,}/)) nameCount++;
                }
                
                // This looks like a player statistics table
                if (ratingCount >= 5 && nameCount >= 5) {
                    playerTable = table;
                    break;
                }
            }
            
            if (!playerTable) {
                console.log('No player statistics table found');
                return [];
            }
            
            console.log('Found player statistics table, extracting data...');
            const rows = playerTable.querySelectorAll('tr');
            
            for (const row of rows) {
                const rowText = row.textContent || '';
                
                // Skip header rows and rows without ratings
                if (rowText.length < 15 || !rowText.match(/\d\.\d/)) continue;
                
                // Must contain player-like data
                if (!rowText.match(/[A-Za-zÀ-žčšđćž]{3,}/)) continue;
                
                const cells = row.querySelectorAll('td, th');
                if (cells.length < 3) continue; // Need at least 3 columns for meaningful data
                
                let playerName = null;
                let rating = null;
                let minutes = 0;
                let position = 'Unknown';
                let isMariborPlayer = false;
                
                // Step 1: Check if this is a Maribor player row
                const images = row.querySelectorAll('img');
                for (const img of images) {
                    const src = img.src?.toLowerCase() || '';
                    const alt = img.alt?.toLowerCase() || '';
                    
                    if (src.includes('maribor') || alt.includes('maribor') || src.includes('2420')) {
                        isMariborPlayer = true;
                        break;
                    }
                }
                
                // Also check for text indicators of Maribor
                if (!isMariborPlayer && rowText.toLowerCase().includes('maribor')) {
                    isMariborPlayer = true;
                }
                
                // Skip if not Maribor player
                if (!isMariborPlayer) continue;
                
                // Step 2: Extract player name (look in first few cells)
                for (let i = 0; i < Math.min(cells.length, 4); i++) {
                    const text = cells[i].textContent?.trim();
                    if (text && text.length > 2 && text.length < 40 && 
                        text.match(/^[A-Za-zÀ-žčšđćž\s\-\.\']+$/) && 
                        !text.match(/^\d/) &&
                        !text.toLowerCase().includes('team') &&
                        !text.toLowerCase().includes('coach')) {
                        playerName = text;
                        break;
                    }
                }
                
                if (!playerName) continue;
                
                // Step 3: Extract rating (look for X.X pattern)
                for (const cell of cells) {
                    const text = cell.textContent?.trim();
                    if (text && text.match(/^\d\.\d$/)) {
                        const r = parseFloat(text);
                        if (r >= 5.0 && r <= 10.0) {
                            rating = r;
                            break;
                        }
                    }
                }
                
                if (!rating) continue; // Must have a rating to be valid
                
                // Step 4: Enhanced position extraction
                for (const cell of cells) {
                    const text = cell.textContent?.trim() || '';
                    
                    // Strategy 1: Single letter position codes (common in SofaScore)
                    if (text.match(/^[NFSMOVDGKAC]$/)) {
                        const posMap = {
                            'N': 'Forward', 'F': 'Forward', 'A': 'Forward',
                            'S': 'Midfielder', 'M': 'Midfielder', 'C': 'Midfielder',
                            'O': 'Defender', 'D': 'Defender',
                            'V': 'Goalkeeper', 'G': 'Goalkeeper', 'K': 'Goalkeeper'
                        };
                        position = posMap[text] || text;
                        break;
                    }
                    
                    // Strategy 2: Full position names (English)
                    const lowerText = text.toLowerCase();
                    if (lowerText.includes('goalkeeper') || lowerText.includes('keeper')) {
                        position = 'Goalkeeper';
                        break;
                    } else if (lowerText.includes('defender') || lowerText.includes('defence') || lowerText.includes('back')) {
                        position = 'Defender';
                        break;
                    } else if (lowerText.includes('midfielder') || lowerText.includes('midfield') || lowerText.includes('centre')) {
                        position = 'Midfielder';
                        break;
                    } else if (lowerText.includes('forward') || lowerText.includes('striker') || lowerText.includes('winger') || lowerText.includes('attack')) {
                        position = 'Forward';
                        break;
                    }
                    
                    // Strategy 3: Slovenian position names
                    if (lowerText.includes('vratar')) {
                        position = 'Goalkeeper';
                        break;
                    } else if (lowerText.includes('branilec') || lowerText.includes('obramba')) {
                        position = 'Defender';
                        break;
                    } else if (lowerText.includes('vezist') || lowerText.includes('sredina')) {
                        position = 'Midfielder';
                        break;
                    } else if (lowerText.includes('napadalec') || lowerText.includes('napad')) {
                        position = 'Forward';
                        break;
                    }
                    
                    // Strategy 4: Position abbreviations
                    if (text.match(/^(GK|DEF|MID|FWD|ATT)$/i)) {
                        const abbrevMap = {
                            'GK': 'Goalkeeper',
                            'DEF': 'Defender',
                            'MID': 'Midfielder',
                            'FWD': 'Forward',
                            'ATT': 'Forward'
                        };
                        position = abbrevMap[text.toUpperCase()] || position;
                        break;
                    }
                }
                
                // Step 5: Extract minutes played
                for (const cell of cells) {
                    const text = cell.textContent?.trim();
                    
                    // Minutes played
                    const minutesMatch = text?.match(/^(\d+)'?$/);
                    if (minutesMatch) {
                        const m = parseInt(minutesMatch[1]);
                        if (m >= 1 && m <= 120) {
                            minutes = m;
                            break;
                        }
                    }
                }
                
                // Add player to results
                mariborPlayers.push({
                    name: playerName,
                    rating: rating,
                    position: position,
                    minutesPlayed: minutes,
                    isStartingXI: minutes >= 45
                });
                
                console.log(`Extracted player: ${playerName} - Position: ${position} - Rating: ${rating}`);
            }
            
            console.log(`Total Maribor players extracted: ${mariborPlayers.length}`);
            return mariborPlayers.sort((a, b) => b.rating - a.rating);
        });
    }

    async takeScreenshot(gameInfo, gameBasicInfo) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${gameBasicInfo.homeTeam}-vs-${gameBasicInfo.awayTeam}-${timestamp}`
                .replace(/[^a-zA-Z0-9\-]/g, '_') + '.png';
            const screenshotPath = path.join(this.screenshotsPath, filename);
            
            // Ensure directory exists
            await fs.mkdir(this.screenshotsPath, { recursive: true });
            
            // Simple screenshot without any quality settings
            await this.page.screenshot({ 
                path: screenshotPath
            });
            
            console.log(`✅ Screenshot saved: ${filename}`);
            
        } catch (error) {
            console.log(`⚠️  Screenshot failed: ${error.message}`);
            console.log(`   Expected path: ${this.screenshotsPath}`);
        }
    }

    generateGameId(url) {
        const parts = url.split('/');
        return parts[parts.length - 1] || Date.now().toString();
    }

    async saveData(data) {
        const dataDir = path.dirname(this.dataPath);
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(this.dataPath, JSON.stringify(data, null, 2));
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
            console.log(`\n🎉 Scraping completed! Processed ${data.length} games.`);
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Scraping failed:', error.message);
            process.exit(1);
        });
}

module.exports = MariborScraper;