// Storage Management Module

/**
 * Storage Schema Definitions
 * 
 * Artist List: Array of artist objects
 * {
 *   id: string (uuid or normalized name),
 *   name: string,
 *   lastPlayed: timestamp
 * }
 * 
 * Song List: Array of song objects
 * {
 *   id: string (uuid),
 *   artistId: string,
 *   title: string,
 *   artwork: string,
 *   lastPlayed: timestamp,
 *   playCount: number
 * }
 * 
 * Search Cache: Key-value store for search results
 * {
 *   [query: string]: {
 *     results: any[],
 *     timestamp: number
 *   }
 * }
 */

const STORAGE_KEYS = {
  ARTISTS: 'artists',
  SONGS: 'songs',
  SEARCH_CACHE: 'search_cache'
};

const DEFAULTS = {
  [STORAGE_KEYS.ARTISTS]: [],
  [STORAGE_KEYS.SONGS]: [],
  [STORAGE_KEYS.SEARCH_CACHE]: {}
};

class StorageManager {
  /**
   * Initialize storage with default values if not present
   */
  static async init() {
    const data = await chrome.storage.local.get(Object.keys(DEFAULTS));
    const updates = {};
    
    for (const key of Object.keys(DEFAULTS)) {
      if (data[key] === undefined) {
        updates[key] = DEFAULTS[key];
      }
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
      console.log('Storage initialized with defaults:', updates);
    }
  }

  // --- Artist Helpers ---

  static async getArtists() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ARTISTS);
    return result[STORAGE_KEYS.ARTISTS] || [];
  }

  static async saveArtists(artists) {
    await chrome.storage.local.set({ [STORAGE_KEYS.ARTISTS]: artists });
  }

  static async addArtist(artist) {
    const artists = await this.getArtists();
    // Check if exists logic would go here, usually by ID or Name
    artists.push(artist);
    await this.saveArtists(artists);
  }

  // --- Song Helpers ---

  static async getSongs() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SONGS);
    return result[STORAGE_KEYS.SONGS] || [];
  }

  static async saveSongs(songs) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SONGS]: songs });
  }

  static async addSong(song) {
    const songs = await this.getSongs();
    songs.push(song);
    await this.saveSongs(songs);
  }

  // --- Search Cache Helpers ---

  static async getSearchCache() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SEARCH_CACHE);
    return result[STORAGE_KEYS.SEARCH_CACHE] || {};
  }

  static async updateSearchCacheEntry(query, entry) {
    const cache = await this.getSearchCache();
    cache[query] = entry;
    await chrome.storage.local.set({ [STORAGE_KEYS.SEARCH_CACHE]: cache });
  }
  
  static async clearCache() {
      await chrome.storage.local.set({ [STORAGE_KEYS.SEARCH_CACHE]: {} });
  }
}

// Export for usage in service worker (if using modules) or global access
self.StorageManager = StorageManager;
