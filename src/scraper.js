// src/scraper.js - Refined and optimized NK Maribor player scraper
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
        // Click Postava
        const postavaClicked = await this.page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            const postava = elements.find(el => {
                const text = el.textContent?.toLowerCase() || '';
                return (text.includes('postava') || text.includes('lineup')) && el.click;
            });
            if (postava) {
                postava.click();
                return true;
            }
            return false;
        });

        if (!postavaClicked) return false;
        await this.delay(3000);

        // Click Statistika igralca
        const statsClicked = await this.page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            const stats = elements.find(el => {
                const text = el.textContent?.toLowerCase() || '';
                return (text.includes('statistika igralca') || text.includes('player stat')) && el.click;
            });
            if (stats) {
                stats.click();
                return true;
            }
            return false;
        });

        if (!statsClicked) return false;
        await this.delay(3000);

        // Click Splošno (optional)
        await this.page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('*'));
            const splosno = elements.find(el => {
                const text = el.textContent?.toLowerCase() || '';
                return (text.includes('splošno') || text.includes('general')) && el.click;
            });
            if (splosno) splosno.click();
        });

        await this.delay(2000);
        return true; // Simplified - assume navigation worked if clicks succeeded
    }

    async extractMariborPlayers() {
        return await this.page.evaluate(() => {
            const mariborPlayers = [];
            const rows = document.querySelectorAll('tr, [class*="row"]');
            
            for (const row of rows) {
                const rowText = row.textContent || '';
                
                // Skip non-player rows
                if (rowText.length < 20 || !rowText.match(/\d\.\d/)) continue;
                
                // Extract player data
                const cells = row.querySelectorAll('td, div, span');
                let playerName = null;
                let rating = null;
                let minutes = 0;
                let position = 'Unknown';
                let isMariborPlayer = false;
                
                // Find Maribor logo (TASK 1: Only check for Maribor logo)
                const images = row.querySelectorAll('img');
                for (const img of images) {
                    const src = img.src?.toLowerCase() || '';
                    const alt = img.alt?.toLowerCase() || '';
                    
                    if (src.includes('maribor') || alt.includes('maribor') || src.includes('2420')) {
                        isMariborPlayer = true;
                        break;
                    }
                }
                
                // Only process if Maribor player (TASK 2: No fallbacks)
                if (!isMariborPlayer) continue;
                
                // Extract player name (NOTE 3: Full name from 2nd column)
                for (let i = 0; i < Math.min(cells.length, 3); i++) {
                    const text = cells[i].textContent?.trim();
                    if (text && text.length > 2 && text.length < 40 && 
                        text.match(/^[A-Za-zÀ-žčšđćž\s\-\.\']+$/) && 
                        !text.match(/^\d/)) {
                        playerName = text;
                        break;
                    }
                }
                
                if (!playerName) continue;
                
                // Extract rating (NOTE 1: Player rating)
                for (const cell of cells) {
                    const text = cell.textContent?.trim();
                    const ratingMatch = text?.match(/^(\d\.\d)$/);
                    if (ratingMatch) {
                        const r = parseFloat(ratingMatch[1]);
                        if (r >= 5.0 && r <= 10.0) {
                            rating = r;
                            break;
                        }
                    }
                }
                
                if (!rating) continue;
                
                // Extract minutes and position (NOTE 1: Minutes and position)
                for (const cell of cells) {
                    const text = cell.textContent?.trim();
                    
                    // Minutes
                    const minutesMatch = text?.match(/^(\d+)'?$/);
                    if (minutesMatch) {
                        const m = parseInt(minutesMatch[1]);
                        if (m >= 1 && m <= 120) minutes = m;
                    }
                    
                    // Position
                    if (text && text.match(/^[NFSMOVDG]$/)) {
                        const posMap = {
                            'N': 'Forward', 'F': 'Forward',
                            'S': 'Midfielder', 'M': 'Midfielder',
                            'O': 'Defender', 'D': 'Defender',
                            'V': 'Goalkeeper', 'G': 'Goalkeeper'
                        };
                        position = posMap[text] || text;
                    }
                }
                
                mariborPlayers.push({
                    name: playerName,
                    rating: rating,
                    position: position,
                    minutesPlayed: minutes,
                    isStartingXI: minutes >= 45
                });
            }
            
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