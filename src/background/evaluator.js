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
   * @param {Object} [songDetails] - Additional song details (channelId, etc.)
   * @returns {Promise<EvaluationResult>}
   */
  static async evaluateSong(title, artistString, songDetails = {}) {
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
        details: { match: true, ...songDetails }
      };
    }

    // 1.5. Check Language of Song Title
    if (NormalizationUtils.isUkrainianString(title) || (songDetails && songDetails.isKnownUkrainian)) {
        return {
            shouldBlock: false,
            reason: 'Song title is in Ukrainian',
            step: 'LANGUAGE',
            details: { language: 'uk', ...songDetails }
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
    
    // Logic update:
    // If ANY artist is blocked -> Skip (SOFT)
    // If ALL artists are blocked -> Dislike + Skip (STRICT)

    if (blockedArtists.length > 0) {
        // User request: If artist is on the blocked list, we should DISLIKE it (Strict mode)
        // regardless of whether it's a partial match or not.
        
        const allBlocked = safeArtists.length === 0 && unknownArtists.length === 0;

        return {
            shouldBlock: true,
            blockMode: 'STRICT', // Always strict if any artist is blocked
            reason: allBlocked ? 'All artists are Russian' : `Partial match (Force Dislike): ${blockedArtists.map(a => a.name).join(', ')} (Russian)`,
            step: 'ARTIST',
            details: { blocked: blockedArtists, safe: safeArtists, unknown: unknownArtists, ...songDetails }
        };
    }

    // If no blocked artists, but some are unknown -> Pending Search
    if (unknownArtists.length > 0) {
        return {
            shouldBlock: false,
            reason: 'Pending identification',
            step: 'PENDING_SEARCH',
            artistsToSearch: unknownArtists,
            details: { ...songDetails }
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
