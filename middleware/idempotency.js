/**
 * Idempotency middleware for safe request retries
 * Following ExpressJS best practices as defined in the rules
 */

// In-memory cache for idempotency keys
const idemCache = new Map();
const IDEM_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Get cached response for idempotency key
 * @param {string} key - Idempotency key
 * @returns {any|null} Cached response or null
 */
function getIdem(key) {
  if (!key) return null;
  
  const entry = idemCache.get(key);
  if (!entry) return null;
  
  // Check if entry has expired
  if (Date.now() - entry.timestamp > IDEM_TTL_MS) {
    idemCache.delete(key);
    return null;
  }
  
  return entry.response;
}

/**
 * Set cached response for idempotency key
 * @param {string} key - Idempotency key
 * @param {any} response - Response to cache
 */
function setIdem(key, response) {
  if (!key) return;
  
  idemCache.set(key, {
    timestamp: Date.now(),
    response: response
  });
}

/**
 * Clean up expired idempotency entries
 * Called periodically to prevent memory leaks
 */
function cleanupExpiredEntries() {
  const now = Date.now();
  const expiredKeys = [];
  
  for (const [key, entry] of idemCache.entries()) {
    if (now - entry.timestamp > IDEM_TTL_MS) {
      expiredKeys.push(key);
    }
  }
  
  expiredKeys.forEach(key => idemCache.delete(key));
  
  if (expiredKeys.length > 0) {
    console.log(`🧹 Cleaned up ${expiredKeys.length} expired idempotency entries`);
  }
}

/**
 * Get idempotency cache statistics
 * @returns {Object} Cache statistics
 */
function getIdempotencyStats() {
  const now = Date.now();
  let activeEntries = 0;
  let expiredEntries = 0;
  
  for (const entry of idemCache.values()) {
    if (now - entry.timestamp > IDEM_TTL_MS) {
      expiredEntries++;
    } else {
      activeEntries++;
    }
  }
  
  return {
    total_entries: idemCache.size,
    active_entries: activeEntries,
    expired_entries: expiredEntries,
    ttl_minutes: IDEM_TTL_MS / (60 * 1000)
  };
}

/**
 * Clear all idempotency cache entries
 * Useful for testing or manual cleanup
 */
function clearIdempotencyCache() {
  const size = idemCache.size;
  idemCache.clear();
  console.log(`🧹 Cleared ${size} idempotency cache entries`);
}

// Set up periodic cleanup
const cleanupInterval = setInterval(cleanupExpiredEntries, 5 * 60 * 1000); // Every 5 minutes

// Clean up interval on process exit
process.on('SIGINT', () => {
  clearInterval(cleanupInterval);
});

process.on('SIGTERM', () => {
  clearInterval(cleanupInterval);
});

module.exports = {
  getIdem,
  setIdem,
  cleanupExpiredEntries,
  getIdempotencyStats,
  clearIdempotencyCache,
  IDEM_TTL_MS
};
