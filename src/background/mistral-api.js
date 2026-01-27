// Mistral API Module
// Handles asynchronous artist search using Mistral AI

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

class MistralAPI {
  /**
   * Searches for an artist's details using Mistral AI.
   *
   * @param {string} artistName
   * @param {Object} [extraContext] - Supplementary data from YouTube API
   * @returns {Promise<{canonicalName: string, country: string, isRussian: boolean} | null>}
   */
  static async searchArtist(artistName, extraContext = null, songTitle = null) {
    if (!artistName) return null;

    try {
      let youtubeContext = {};
      
      // If rawData is present (legacy or full object), we try to use the processed part if available.
      // However, the new flow encourages passing the processed object directly or in a specific field.
      // Current YouTubeAPI returns { ...processedDetails, rawData: ... }
      
      if (extraContext) {
          // Remove rawData from the context we send to Mistral to save tokens
          // We assume extraContext is the object returned by YouTubeAPI.getArtistDetails
          const { rawData, ...cleanContext } = extraContext;
          youtubeContext = cleanContext;
      }

      let prompt;
      const hasData = Object.keys(youtubeContext).length > 0;
      const songContext = songTitle ? `Song Title: "${songTitle}"` : '';
      const songInstruction = songTitle ? `
3. Analyze the song title "${songTitle}". If the title is strictly in Ukrainian (contains unique Ukrainian words/characters and no Russian ones) or the song is known to be a Ukrainian patriotic/folk song, identify it as Ukrainian.
` : '';

      if (hasData) {
        const contextStr = JSON.stringify(youtubeContext, null, 2);
        prompt = `
Analyze the provided YouTube Channel Data for the artist "${artistName}". ${songContext}

Input Data:
${contextStr}

Task:
Identify the *best match* for the music artist "${artistName}".
1. Analyze the provided Input Data (Channel Title, Description, Keywords) as primary evidence.
2. If the Input Data is generic, incomplete, or ambiguous, SUPPLEMENT it with your INTERNAL KNOWLEDGE about the artist.
${songInstruction}

Determine if THIS artist is Russian or associated with Russia.
Also determine if the Song Title indicates a Ukrainian song (if provided).

Return a SINGLE valid JSON object with:
- "canonicalName": string (The name of the identified artist)
- "country": ISO 3166-1 alpha-2 code (e.g., "RU", "UA", "US")
- "isRussian": boolean
- "isSongUkrainian": boolean (True ONLY if the song title is clearly Ukrainian or known Ukrainian song. False otherwise or if ambiguous/Russian.)

Strict Rules for "isRussian" = true:
Mark as TRUE if ANY of the following are found in the data OR known from your internal knowledge:
1.  "country": "RU" in the input.
2.  Links to VK.com, Yandex, or .ru sites in "officialLinks" or "description".
3.  Russian phone numbers (+7...) in "description".
4.  Mentions of Russia/Moscow/etc. in "description" or "keywords".
5.  "hasVkLink", "hasYandexLink", or "hasRussianPhone" is true in the input.
6.  You know the artist is Russian (born in/citizen of Russia, based in Russia, or supports the invasion).
7.  The channel description or keywords explicitly mention "Russian music", "Russian songs" (русские песни), "Russian hits", "Russian lyrics" (русские тексты), or "Chanson" (Шансон) as the PRIMARY content.
8.  The artist/channel is a curator or aggregator of Russian content (e.g., "RusLyrics", "Soyuz Music").

Contextual Nuances:
- Language != Nationality. Singing in Russian does NOT automatically make an artist Russian. Many Ukrainian artists (e.g., NK, KRBK, dim.slavyanin) sing in Russian or have Slavic names but are Ukrainian.
- However, if a channel is dedicated to *curating* "Russian songs" (русские песни) or has "Rus" / "Russia" in its name AND provides Russian content, it is considered Russian/Associated with Russia.
- Explicitly check if the artist is part of the "Ukrainian Phonk", "Ukrainian Rap", or "Ukrainian Hip-Hop" scene. If so, they are NOT Russian.
- "dim.slavyanin" is a Ukrainian artist.
- "Topic" channels may have unreliable region codes. Prioritize description content and links.
- If the artist is clearly Ukrainian (e.g., links to UA sites, mentions of Ukraine, UA country code) and has NO Russian indicators, return "isRussian": false.
- If "isSongUkrainian" is true, it strongly suggests the artist might be Ukrainian (or at least the content is safe), but verify artist origin if possible.

If multiple candidates exist (unlikely with this specific input), select the most relevant one.
`;
      } else {
        // Fallback Prompt: No YouTube Data available, rely on internal knowledge
        prompt = `
Identify the music artist "${artistName}" using your internal knowledge base. ${songContext}

Task:
Determine if the artist is Russian or associated with Russia.
${songInstruction}

Return a SINGLE valid JSON object with:
- "canonicalName": string (Artist's name)
- "country": ISO 3166-1 alpha-2 code (e.g., "RU", "UA", "US")
- "isRussian": boolean
- "isSongUkrainian": boolean (True ONLY if the song title is clearly Ukrainian or known Ukrainian song)

Determine "isRussian":
- TRUE if the artist is Russian (born in/citizen of Russia, based in Russia, or supports the invasion).
- TRUE if the "artist" is a known channel/brand dedicated to Russian music (e.g., "RusLyrics", "Soyuz Music").
- FALSE if the artist is Ukrainian, Kazakh, Belarusian (unless supporting invasion), or Western.

CRITICAL DISTINCTIONS:
- Language != Nationality. Many Ukrainians (e.g., KRBK, dim.slavyanin, NK) sing in Russian. They are NOT Russian. Mark them as UA/false.
- Explicitly check if the artist is part of the "Ukrainian Phonk", "Ukrainian Rap", or "Ukrainian Hip-Hop" scene. If so, they are NOT Russian.
- Check the artist's career base and origin. If they operate in Russia -> RU.
- If unknown, return null country and false.
`;
      }

      const response = await fetch(MISTRAL_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MISTRAL_API_KEY}`
        },
        body: JSON.stringify({
          model: 'mistral-large-latest',
          messages: [
            { role: "user", content: prompt }
          ],
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (data.choices && data.choices.length > 0) {
        const content = data.choices[0].message.content;
        try {
          const parsed = JSON.parse(content);
          
          // Handle case where Mistral returns an analysis array (multiple candidates)
          if (parsed.analysis && Array.isArray(parsed.analysis)) {
             console.log('Mistral returned multiple analysis items. Selecting best match for:', artistName);
             
             const normalizedTarget = artistName.toLowerCase().trim();
             const candidates = parsed.analysis;
             
             // 1. Exact Match
             const exactMatch = candidates.find(item => 
                 (item.canonicalName || '').toLowerCase() === normalizedTarget
             );
             if (exactMatch) return exactMatch;
             
             // 2. Topic Channel Match
             const topicMatch = candidates.find(item => 
                 (item.canonicalName || '').toLowerCase() === `${normalizedTarget} - topic`
             );
             if (topicMatch) return topicMatch;
             
             // 3. Starts With Match (e.g., "Artist (Real Name)")
             const startsWithMatch = candidates.find(item => 
                 (item.canonicalName || '').toLowerCase().startsWith(normalizedTarget)
             );
             if (startsWithMatch) return startsWithMatch;
             
             // 4. Fallback: Return the first item (usually the most relevant search result)
             if (candidates.length > 0) {
                 return candidates[0];
             }
          }
          
          return parsed;
        } catch (e) {
          console.error('Failed to parse JSON response from Mistral:', content);
          return null;
        }
      }

      return null;
    } catch (error) {
      console.error('Mistral API search failed:', error);
      throw error;
    }
  }
}

// Export
if (typeof self !== 'undefined') {
  self.MistralAPI = MistralAPI;
}
