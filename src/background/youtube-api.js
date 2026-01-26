// YouTube Data API Module
// Handles interactions with YouTube Data API v3

const YOUTUBE_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';

class YouTubeAPI {
  /**
   * Fetches artist details from YouTube Data API.
   * Uses channelId if available, otherwise searches by artist name.
   * 
   * @param {string} artistName
   * @param {string} [channelId]
   * @returns {Promise<{
   *   channelId: string,
   *   title: string,
   *   description: string,
   *   customUrl: string,
   *   country: string,
   *   hasVkLink: boolean,
   *   officialLinks: string[]
   * } | null>}
   */
  static async getArtistDetails(artistName, channelId) {
    if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'YOUR_YOUTUBE_DATA_API_KEY') {
      console.warn('YouTube API Key not configured. Skipping YouTube data fetch.');
      return null;
    }

    try {
      let targetChannelId = channelId;

      // 1. If no channel ID provided, search for the channel
      if (!targetChannelId) {
        targetChannelId = await this.searchChannelId(artistName);
      }

      if (!targetChannelId) {
        console.log(`YouTube API: No channel found for "${artistName}"`);
        return null;
      }

      // 2. Fetch channel details
      return await this.fetchChannelDetails(targetChannelId);

    } catch (error) {
      console.error('YouTube API Error:', error);
      // Graceful degradation: return null so the flow continues with just Mistral
      return null;
    }
  }

  /**
   * Searches for a channel ID by artist name.
   * @param {string} query 
   * @returns {Promise<string|null>}
   */
  static async searchChannelId(query) {
    const url = new URL(`${YOUTUBE_API_BASE_URL}/search`);
    url.searchParams.append('part', 'snippet');
    url.searchParams.append('q', query);
    url.searchParams.append('type', 'channel');
    url.searchParams.append('maxResults', '1');
    url.searchParams.append('key', YOUTUBE_API_KEY);

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.items && data.items.length > 0) {
        return data.items[0].snippet.channelId;
    }
    return null;
  }

  /**
   * Fetches detailed channel info.
   * @param {string} channelId 
   * @returns {Promise<Object|null>}
   */
  static async fetchChannelDetails(channelId) {
    const url = new URL(`${YOUTUBE_API_BASE_URL}/channels`);
    url.searchParams.append('part', 'snippet,brandingSettings');
    url.searchParams.append('id', channelId);
    url.searchParams.append('key', YOUTUBE_API_KEY);

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`Channel details failed: ${response.status}`);
    }

    const data = await response.json();
    if (!data.items || data.items.length === 0) {
        return null;
    }

    const item = data.items[0];
    const snippet = item.snippet || {};
    const branding = item.brandingSettings || {};
    
    // Extract description
    const description = snippet.description || '';
    
    // Extract links from branding settings (if available, often elusive in API v3)
    // Note: API v3 often doesn't return full channel links in snippet/branding easily without Oauth sometimes, 
    // but description often contains them.
    // However, brandingSettings.channel.keywords or similar might help.
    // Actually, "brandingSettings.channel.description" is often the same.
    // We mainly rely on description for links in many cases if 'brandingSettings' doesn't have 'hints'.
    
    // Check for VK links in description
    const hasVkLink = description.includes('vk.com') || description.includes('vk.ru');

    // Collect some official looking links if possible (simple regex from description)
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const links = description.match(urlRegex) || [];

    return {
        channelId: item.id,
        title: snippet.title,
        description: description,
        customUrl: snippet.customUrl,
        country: snippet.country, // ISO code if available
        hasVkLink: hasVkLink,
        officialLinks: links
    };
  }
}

// Export
if (typeof self !== 'undefined') {
  self.YouTubeAPI = YouTubeAPI;
}
