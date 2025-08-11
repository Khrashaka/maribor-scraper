// src/server.js - Express server
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const MariborScraper = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// API endpoint to get scraped games data
app.get('/api/games', async (req, res) => {
    try {
        const dataPath = path.join(__dirname, '../data/games.json');
        const data = await fs.readFile(dataPath, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        console.error('Error reading games data:', error);
        res.status(500).json({ error: 'Failed to load games data' });
    }
});

// API endpoint to trigger scraping
app.post('/api/scrape', async (req, res) => {
    try {
        console.log('Starting manual scrape...');
        const scraper = new MariborScraper();
        const data = await scraper.scrapeGames();
        res.json({ success: true, gamesCount: data.length });
    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ error: 'Scraping failed', details: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});