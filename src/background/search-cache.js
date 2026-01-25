// Search Cache Module
// Handles caching of search results with state management
// Dependencies: StorageManager (storage.js)

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours for resolved results
const PENDING_TIMEOUT = 60 * 1000; // 60 seconds validity for pending state

class SearchCache {
  /**
   * Retrieves a cache entry for a query.
   * Handles expiry of 'pending' state (treats as invalid/failed if timed out).
   * 
   * @param {string} query 
   * @returns {Promise<{state: string, data?: any, error?: string, timestamp: number} | null>}
   */
  static async get(query) {
    if (!query) return null;
    
    // Use StorageManager to get the raw cache map
    const cache = await StorageManager.getSearchCache();
    const entry = cache[query];
    
    if (!entry) return null;

    const now = Date.now();

    if (entry.state === 'pending') {
      // Check if pending state has timed out (deadlock prevention)
      if (now - entry.timestamp > PENDING_TIMEOUT) {
        // Automatically mark as failed in background or just return null/failed?
        // Let's treat it as failed/stale so a new search can be triggered.
        return { 
          state: 'failed', 
          error: 'Search timed out', 
          timestamp: entry.timestamp 
        };
      }
      return entry;
    }

    if (entry.state === 'resolved') {
      // Check TTL
      if (now - entry.timestamp > CACHE_TTL) {
        return null; // Expired
      }
      return entry;
    }

    // Return 'failed' state entries so we don't retry immediately?
    // Or retry after some time? For now return as is.
    return entry;
  }

  /**
   * Sets the cache state to 'pending' for a query.
   * Returns true if successfully set (i.e., not already pending or resolved).
   * Returns false if a valid pending or resolved entry already exists (duplicate prevention).
   * 
   * @param {string} query 
   * @returns {Promise<boolean>}
   */
  static async setPending(query) {
    if (!query) return false;

    // Check existing
    const existing = await this.get(query);
    
    if (existing) {
      if (existing.state === 'resolved') return false; // Already have data
      if (existing.state === 'pending') return false; // Already working on it
      // If 'failed', we allow retry (proceed to set pending)
    }

    await StorageManager.updateSearchCacheEntry(query, {
      state: 'pending',
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * Sets the cache state to 'resolved' with data.
   * 
   * @param {string} query 
   * @param {any} data 
   */
  static async setResolved(query, data) {
    if (!query) return;

    await StorageManager.updateSearchCacheEntry(query, {
      state: 'resolved',
      data: data,
      timestamp: Date.now()
    });
  }

  /**
   * Sets the cache state to 'failed' with error reason.
   * 
   * @param {string} query 
   * @param {string} error 
   */
  static async setFailed(query, error) {
    if (!query) return;

    await StorageManager.updateSearchCacheEntry(query, {
      state: 'failed',
      error: error,
      timestamp: Date.now()
    });
  }
}

// Export
if (typeof self !== 'undefined') {
  self.SearchCache = SearchCache;
}
