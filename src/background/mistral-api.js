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
  static async searchArtist(artistName, extraContext = null) {
    if (!artistName) return null;

    try {
      let contextStr = '';
      if (extraContext) {
        contextStr = `
SUPPLEMENTARY CONTEXT (from YouTube Data API):
- Channel Title: ${extraContext.title || 'N/A'}
- Channel ID: ${extraContext.channelId || 'N/A'}
- Country (from Channel): ${extraContext.country || 'N/A'}
- Description: ${extraContext.description ? extraContext.description.substring(0, 500) + '...' : 'N/A'}
- Has VK.com Link: ${extraContext.hasVkLink ? 'YES (Strong Indicator of Russian origin/audience)' : 'NO'}
- Custom URL: ${extraContext.customUrl || 'N/A'}
`;
      }

      // Prompt designed for deep research context
      const prompt = `Identify the music artist "${artistName}". Return a valid JSON object with:
- "canonicalName": string
- "country": ISO 3166-1 alpha-2 code
- "isRussian": boolean

${contextStr}

Determine "isRussian":
- TRUE if the artist is Russian (born in/citizen of Russia, based in Russia, or supports the invasion).
- FALSE if the artist is Ukrainian, Kazakh, Belarusian (unless supporting invasion), or Western.

CRITICAL DISTINCTIONS:
- Language != Nationality. Many Ukrainians (e.g., KRBK, Dim Slavyanin, NK) sing in Russian. They are NOT Russian. Mark them as UA/false.
- Check the artist's career base and origin. If they operate in Russia -> RU.
- If unknown, return null country and false.`;

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
          return JSON.parse(content);
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
