// src/utils/helpers.js - Utility functions
const moment = require('moment');

class Helpers {
    /**
     * Format date for display
     * @param {string|Date} date 
     * @returns {string}
     */
    static formatDate(date) {
        return moment(date).format('DD/MM/YYYY');
    }

    /**
     * Check if date is after target date
     * @param {string|Date} date 
     * @param {string|Date} targetDate 
     * @returns {boolean}
     */
    static isDateAfter(date, targetDate) {
        return moment(date).isAfter(moment(targetDate));
    }

    /**
     * Clean player name
     * @param {string} name 
     * @returns {string}
     */
    static cleanPlayerName(name) {
        return name.trim().replace(/\s+/g, ' ');
    }

    /**
     * Validate rating value
     * @param {any} rating 
     * @returns {number|null}
     */
    static validateRating(rating) {
        const parsed = parseFloat(rating);
        if (isNaN(parsed) || parsed < 0 || parsed > 10) {
            return null;
        }
        return Math.round(parsed * 10) / 10; // Round to 1 decimal place
    }

    /**
     * Generate unique game ID from URL
     * @param {string} url 
     * @returns {string}
     */
    static generateGameId(url) {
        const parts = url.split('/');
        return parts[parts.length - 1] || parts[parts.length - 2];
    }

    /**
     * Sleep for specified milliseconds
     * @param {number} ms 
     * @returns {Promise}
     */
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Retry function with exponential backoff
     * @param {Function} fn 
     * @param {number} retries 
     * @param {number} delay 
     * @returns {Promise}
     */
    static async retry(fn, retries = 3, delay = 1000) {
        try {
            return await fn();
        } catch (error) {
            if (retries === 0) {
                throw error;
            }
            console.log(`Retrying in ${delay}ms... (${retries} attempts left)`);
            await this.sleep(delay);
            return this.retry(fn, retries - 1, delay * 2);
        }
    }

    /**
     * Log with timestamp
     * @param {string} message 
     * @param {string} level 
     */
    static log(message, level = 'INFO') {
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
        console.log(`[${timestamp}] [${level}] ${message}`);
    }
}

module.exports = Helpers;