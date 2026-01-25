// Song Matcher Module
// Dependencies: StorageManager (storage.js), NormalizationUtils (utils/normalization.js)

/**
 * Checks if a song matches the known song list.
 * 
 * @param {string} title - The song title to check
 * @param {string} artist - The artist name to check
 * @returns {Promise<{match: boolean, reason: string}>}
 */
async function checkSongMatch(title, artist) {
  if (!title || !artist) {
    return { match: false, reason: 'Invalid input: Title or Artist missing' };
  }

  // Ensure dependencies are available
  if (typeof StorageManager === 'undefined' || typeof NormalizationUtils === 'undefined') {
    console.error('Dependencies missing: StorageManager or NormalizationUtils not found.');
    return { match: false, reason: 'Internal error: Dependencies missing' };
  }

  const songs = await StorageManager.getSongs();
  
  if (!songs || songs.length === 0) {
    return { match: false, reason: 'No known songs in storage' };
  }

  const normalizedInputTitle = NormalizationUtils.normalizeTitle(title);
  const normalizedInputArtist = NormalizationUtils.normalizeArtist(artist);

  // We need to check against known songs. 
  // Ideally, known songs in storage should already be normalized or we normalize them on the fly.
  // Assuming storage contains raw data, we normalize on the fly for comparison.
  // Efficiency note: In a real app with thousands of songs, we'd want indexed normalized fields.
  
  const match = songs.find(song => {
    const songTitle = NormalizationUtils.normalizeTitle(song.title);
    
    // Check Title Match first
    if (songTitle !== normalizedInputTitle) {
      return false;
    }
    
    // If title matches, check Artist.
    // The stored song might have an artistId, so we might need to look up the artist name.
    // However, the schema in storage.js says:
    // { id, artistId, title, ... }
    // It doesn't explicitly have artist name in the song object, but usually for performance 
    // we might store a denormalized name or look it up.
    // Let's assume for now we need to fetch the artist list to compare, OR the song object 
    // has an 'artistName' property or we rely on 'artistId' if we had the input artist's ID (which we don't).
    
    // Revised Schema assumption based on typical simple extensions:
    // Let's check if we can get the artist name.
    
    // If the song object DOES NOT have the artist name directly, we are in trouble without looking it up.
    // Let's fetch artists to be safe.
    return true; // Provisional match on title, will verify artist below
  });

  if (!match) {
    return { match: false, reason: 'No match found for title' };
  }
  
  // If we found a title match, we need to verify the artist.
  // Since we might have multiple songs with same title by different artists.
  
  const artists = await StorageManager.getArtists();
  
  // Let's refine the search to find *any* song that matches BOTH title and artist.
  const exactMatch = songs.find(song => {
    const songTitle = NormalizationUtils.normalizeTitle(song.title);
    if (songTitle !== normalizedInputTitle) return false;
    
    // Find the artist object for this song
    const artistObj = artists.find(a => a.id === song.artistId);
    if (!artistObj) return false; // Should not happen if referential integrity exists
    
    const songArtist = NormalizationUtils.normalizeArtist(artistObj.name);
    return songArtist === normalizedInputArtist;
  });

  if (exactMatch) {
    return { match: true, reason: 'Match found' };
  } else {
    return { match: false, reason: 'Title found but artist mismatch' };
  }
}

/**
 * Checks if an artist exists in the known artist list.
 * 
 * @param {string} artist - The artist name to check
 * @returns {Promise<{match: boolean, reason: string, artist?: object}>}
 */
async function checkArtistMatch(artist) {
  if (!artist) {
    return { match: false, reason: 'Invalid input: Artist missing' };
  }

  if (typeof StorageManager === 'undefined' || typeof NormalizationUtils === 'undefined') {
    console.error('Dependencies missing');
    return { match: false, reason: 'Internal error: Dependencies missing' };
  }

  const artists = await StorageManager.getArtists();
  if (!artists || artists.length === 0) {
    return { match: false, reason: 'No known artists in storage' };
  }

  const normalizedInputArtist = NormalizationUtils.normalizeArtist(artist);
  
  const match = artists.find(a => {
    const storedArtist = NormalizationUtils.normalizeArtist(a.name);
    return storedArtist === normalizedInputArtist;
  });

  if (match) {
    return { match: true, reason: 'Artist match found', artist: match };
  } else {
    return { match: false, reason: 'No artist match found' };
  }
}

/**
 * Checks if an artist is marked as being from Russia.
 * Checks both the persistent artist list and the search cache.
 * 
 * @param {string} artistName
 * @returns {Promise<{isRussian: boolean, source: string}>}
 */
async function isArtistRussian(artistName) {
  if (!artistName) {
    return { isRussian: false, source: 'Invalid input' };
  }

  // 1. Check known artists (persistent storage)
  const artistMatch = await checkArtistMatch(artistName);
  
  if (artistMatch.match && artistMatch.artist) {
    // Check country/origin field
    // Assuming schema has 'country' or 'origin' or 'isRussian'
    // Let's standardize on checking 'country' code being 'RU' or 'Russia'
    const country = artistMatch.artist.country;
    if (country === 'RU' || (country && country.toLowerCase() === 'russia')) {
      return { isRussian: true, source: 'artist_list' };
    }
    // If matched but not Russian, we rely on that info.
    return { isRussian: false, source: 'artist_list' };
  }

  // 2. Check search cache
  // The search cache stores results for queries.
  // We'll check if we have a cached result for this artist name.
  const cache = await StorageManager.getSearchCache();
  const normalizedName = NormalizationUtils.normalizeArtist(artistName);
  
  // Try to find a cache entry that matches the artist name
  // Note: Cache keys are usually the search query.
  // We check if the normalized query matches our normalized artist name.
  // OR we iterate values if the structure allows. 
  // For O(1) lookup, we assume key is the query.
  
  // We iterate through cache keys to find a matching normalized query
  // because the cache key might be "The Artist" and we normalized to "artist".
  // Or we just check exact normalized key if we store normalized keys.
  // Assuming keys are raw queries, we iterate.
  
  let cachedEntry = null;
  for (const [query, data] of Object.entries(cache)) {
    if (NormalizationUtils.normalizeArtist(query) === normalizedName) {
      cachedEntry = data;
      break;
    }
  }

  if (cachedEntry && cachedEntry.results && cachedEntry.results.length > 0) {
    // Check the first/best result
    // Assuming result object has 'country' or 'origin'
    const result = cachedEntry.results[0];
    if (result && (result.country === 'RU' || (result.country && result.country.toLowerCase() === 'russia'))) {
      return { isRussian: true, source: 'cache' };
    }
  }

  return { isRussian: false, source: 'unknown' };
}

// Export for usage
if (typeof self !== 'undefined') {
  self.SongMatcher = {
    checkSongMatch,
    checkArtistMatch,
    isArtistRussian
  };
}
