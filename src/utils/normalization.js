/**
 * Utility functions for string normalization.
 * Used for consistent artist and song title formatting.
 */

/**
 * Normalizes a general string:
 * - Converts to lower case
 * - Trims whitespace
 */
function normalizeString(str) {
  if (!str) return '';
  return str.trim().toLowerCase();
}

/**
 * Normalizes artist names by removing common feature markers.
 * - Removes "feat.", "ft.", "featuring" (case-insensitive)
 * - Removes "&", "and", "," when used as separators (optional based on strictness,
 *   but requirement says "remove & variants")
 * - Trims and lowercases
 * 
 * @param {string} artist 
 * @returns {string}
 */
function normalizeArtist(artist) {
  if (!artist) return '';
  
  let normalized = artist.toLowerCase();
  
  // Remove content in parentheses that starts with feat/ft
  normalized = normalized.replace(/\((?:feat|ft|featuring)\.?\s+[^)]+\)/g, '');
  
  // Remove "feat.", "ft.", "featuring" followed by anything until end or separator
  // This simple regex removes "feat. X" entirely from the string if we consider the artist name
  // should be just the main artist.
  // However, usually we want to keep the main artist.
  // Requirement: "remove 'feat.', 'ft.', '&' variants"
  
  // Strategy: Replace specific patterns with empty string or space
  
  // 1. Remove "feat.", "ft.", "featuring" markers
  normalized = normalized.replace(/\b(feat\.?|ft\.?|featuring)\b.*$/g, '');

  // 2. Remove "&" variants if they are just joining artists, 
  // but be careful not to merge names incorrectly. 
  // The requirement says "remove & variants", which might mean splitting or just cleaning.
  // Assuming the goal is to get a "canonical" single artist string or just clean up the "feat" parts.
  // If the instruction implies removing the connecting words themselves:
  // "Artist A & Artist B" -> "Artist A Artist B" (probably not what we want)
  // OR "Artist A & Artist B" -> "Artist A" (Primary artist only)?
  // Given "remove 'feat.', 'ft.', '&' variants", I will treat "&" as a separator to be removed 
  // ONLY if it's acting like "feat". 
  // BUT, usually "&" means a duo.
  // Let's stick to the explicit instruction: "remove ... '&' variants".
  // This likely means removing the character itself to normalize "Artist A & Artist B" vs "Artist A and Artist B".
  // Let's replace "&" with "and" or just remove it? 
  // "Variants" implies normalizing the *representation* of the conjunction.
  // Common practice: " & " -> " ", " and " -> " "
  
  normalized = normalized.replace(/\s+(&|and)\s+/g, ' ');

  // 3. Remove extra whitespace
  return normalized.replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes song titles.
 * - Removes "feat." parts if they are in the title
 * - Trims and lowercases
 * 
 * @param {string} title 
 * @returns {string}
 */
function normalizeTitle(title) {
  if (!title) return '';
  
  let normalized = title.toLowerCase();
  
  // Remove (feat. X) or [ft. X] from title
  normalized = normalized.replace(/[\(\[]\s*(?:feat|ft|featuring)\.?\s+[^)\]]+[\)\]]/g, '');
  
  // Remove "feat. X" at the end of the string
  normalized = normalized.replace(/\s+(?:feat|ft|featuring)\.?\s+.*$/g, '');

  return normalized.replace(/\s+/g, ' ').trim();
}

// Export for usage in ES modules or Service Workers
if (typeof self !== 'undefined') {
  self.NormalizationUtils = {
    normalizeString,
    normalizeArtist,
    normalizeTitle
  };
}

// Export for CommonJS/Node environments (if needed for testing)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeString,
    normalizeArtist,
    normalizeTitle
  };
}
