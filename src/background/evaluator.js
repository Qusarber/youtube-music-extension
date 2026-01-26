// Evaluator Module
// Orchestrates the decision process for song/artist checking
// Dependencies: SongMatcher (matcher.js)

/**
 * @typedef {Object} EvaluationResult
 * @property {boolean} shouldBlock - Whether the song should be skipped/blocked
 * @property {string} blockMode - 'STRICT' (Dislike+Skip) or 'SOFT' (Skip only)
 * @property {string} reason - Human-readable reason for the decision
 * @property {string} step - The pipeline step that made the decision (SONG, ARTIST, COUNTRY, PENDING_SEARCH)
 * @property {Object} [details] - Additional data (e.g. matched song/artist object)
 * @property {string[]} [artistsToSearch] - List of artist names to search if pending
 */

class Evaluator {
  /**
   * Evaluates a song to determine if it should be blocked.
   * Pipeline order:
   * 1. Known Song
   * 2. Known Artist(s)
   * 3. Artist Country (from cache/list)
   * 4. Pending Search (if unknown)
   * 
   * @param {string} title 
   * @param {string} artistString 
   * @returns {Promise<EvaluationResult>}
   */
  static async evaluateSong(title, artistString) {
    if (!title || !artistString) {
      return { shouldBlock: false, reason: 'Invalid input', step: 'Validation' };
    }

    // 1. Check Known Song (Exact match on title + artist string)
    // Note: SongMatcher.checkSongMatch handles the raw strings.
    const songMatch = await SongMatcher.checkSongMatch(title, artistString);
    if (songMatch.match) {
      return {
        shouldBlock: false, // Placeholder: requires song object status. Assuming safe if manually added?
        reason: 'Song found in database',
        step: 'SONG',
        details: { match: true }
      };
    }

    // 2. Split Artists and Check Each
    const individualArtists = NormalizationUtils.splitArtists(artistString);
    if (individualArtists.length === 0) {
        // Fallback to treating whole string as one
        individualArtists.push(NormalizationUtils.normalizeArtist(artistString));
    }

    let blockedArtists = [];
    let safeArtists = [];
    let unknownArtists = [];

    for (const artistName of individualArtists) {
        const match = await SongMatcher.checkArtistMatch(artistName);
        
        if (match.match && match.artist) {
            // Check if Russian
            const isRussian = 
                match.artist.country === 'RU' || 
                (match.artist.country && match.artist.country.toLowerCase() === 'russia') || 
                match.artist.isRussian === true || 
                match.artist.isRussian === 'true';

            if (isRussian) {
                blockedArtists.push(match.artist);
            } else {
                safeArtists.push(match.artist);
            }
        } else {
            // Check if explicitly failed before?
            // For now, treat as unknown
            unknownArtists.push(artistName);
        }
    }

    // 3. Determine Block Status
    
    // If ANY artist is blocked, the song is blocked.
    if (blockedArtists.length > 0) {
        const isPartial = safeArtists.length > 0 || unknownArtists.length > 0;
        
        return {
            shouldBlock: true,
            blockMode: isPartial ? 'SOFT' : 'STRICT',
            reason: isPartial ? `Partial match: ${blockedArtists.map(a => a.name).join(', ')} (Russian)` : 'All artists are Russian',
            step: 'ARTIST',
            details: { blocked: blockedArtists, safe: safeArtists }
        };
    }

    // If no blocked artists, but some are unknown -> Pending Search
    if (unknownArtists.length > 0) {
        return {
            shouldBlock: false,
            reason: 'Pending identification',
            step: 'PENDING_SEARCH',
            artistsToSearch: unknownArtists
        };
    }

    // All artists are known and Safe
    return {
        shouldBlock: false,
        reason: 'All artists are safe',
        step: 'ARTIST'
    };
  }
}

// Export
if (typeof self !== 'undefined') {
  self.Evaluator = Evaluator;
}
