// Mistral API Module
// Handles asynchronous artist search using Mistral AI

const MISTRAL_API_KEY = '9JlptdJTYQJNbNSQgZkoDRaa7HlH4kZS';
const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';

class MistralAPI {
  /**
   * Searches for an artist's details using Mistral AI.
   * 
   * @param {string} artistName 
   * @returns {Promise<{canonicalName: string, country: string} | null>}
   */
  static async searchArtist(artistName) {
    if (!artistName) return null;

    try {
      const response = await fetch(MISTRAL_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MISTRAL_API_KEY}`
        },
        body: JSON.stringify({
          model: 'mistral-tiny',
          messages: [
            {
              role: 'system',
              content: 'You are a music database assistant. Return JSON only. Format: {"canonicalName": "string", "country": "ISO 3166-1 alpha-2 code"}. If unknown, return null country.'
            },
            {
              role: 'user',
              content: `Identify the music artist "${artistName}". Return their canonical name and country of origin.`
            }
          ],
          response_format: { type: 'json_object' }
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
