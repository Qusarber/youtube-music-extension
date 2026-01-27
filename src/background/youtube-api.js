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
      let searchItems = [];

      // 1. If no channel ID provided, search for the channel
      if (!targetChannelId) {
        const searchResult = await this.searchChannel(artistName);
        targetChannelId = searchResult.channelId;
        searchItems = searchResult.items;
      }

      if (!targetChannelId) {
        console.log(`YouTube API: No channel found for "${artistName}"`);
        return null;
      }

      // 2. Fetch channel details
      const channelResult = await this.fetchChannelDetailsRaw(targetChannelId);
      
      // Merge all raw items for Mistral
      const rawData = {
          searchItems: searchItems,
          channelItems: channelResult.items
      };

      // Process for legacy hard-block logic (keep compatibility)
      const processedDetails = this.processChannelData(channelResult.items);

      return {
          ...processedDetails,
          rawData: rawData
      };

    } catch (error) {
      console.error('YouTube API Error:', error);
      // Graceful degradation: return null so the flow continues with just Mistral
      return null;
    }
  }

  /**
   * Searches for a channel by artist name.
   * @param {string} query 
   * @returns {Promise<{channelId: string|null, items: Array}>}
   */
  static async searchChannel(query) {
    const url = new URL(`${YOUTUBE_API_BASE_URL}/search`);
    url.searchParams.append('part', 'snippet');
    url.searchParams.append('q', query);
    url.searchParams.append('type', 'channel');
    url.searchParams.append('maxResults', '5');
    url.searchParams.append('key', YOUTUBE_API_KEY);

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
    }
    
    const data = await response.json();
    let channelId = null;

    if (data.items && data.items.length > 0) {
        // Prioritize non-Topic channels
        const nonTopicChannel = data.items.find(item => 
            item.snippet && 
            item.snippet.channelTitle && 
            !item.snippet.channelTitle.includes('- Topic')
        );

        if (nonTopicChannel) {
            channelId = nonTopicChannel.snippet.channelId;
        } else {
            // Fallback to first result
            channelId = data.items[0].snippet.channelId;
        }
    }
    
    return {
        channelId,
        items: data.items || []
    };
  }

  // Legacy method signature support if needed, or just remove
  static async searchChannelId(query) {
      const result = await this.searchChannel(query);
      return result.channelId;
  }

  /**
   * Fetches detailed channel info (Raw).
   * @param {string} channelId 
   * @returns {Promise<{items: Array}>}
   */
  static async fetchChannelDetailsRaw(channelId) {
    const url = new URL(`${YOUTUBE_API_BASE_URL}/channels`);
    url.searchParams.append('part', 'snippet,brandingSettings');
    url.searchParams.append('id', channelId);
    url.searchParams.append('key', YOUTUBE_API_KEY);

    const response = await fetch(url.toString());
    if (!response.ok) {
        throw new Error(`Channel details failed: ${response.status}`);
    }

    const data = await response.json();
    return {
        items: data.items || []
    };
  }
  
  // Kept for backward compatibility but modified to use Raw
  static async fetchChannelDetails(channelId) {
      const result = await this.fetchChannelDetailsRaw(channelId);
      return this.processChannelData(result.items);
  }

  static processChannelData(items) {
    if (!items || items.length === 0) {
        return null;
    }

    const item = items[0];
    const snippet = item.snippet || {};
    const branding = item.brandingSettings || {};
    
    // Extract description
    const description = snippet.description || '';
    
    // Extract keywords (often contains country or genre info)
    const keywords = branding.channel && branding.channel.keywords ? branding.channel.keywords : '';

    // Check for VK links in description
    const hasVkLink = description.includes('vk.com') || description.includes('vk.ru');
    
    // Check for Yandex links
    const hasYandexLink = description.toLowerCase().includes('yandex') || description.toLowerCase().includes('dzen.ru');

    // Check for Russian phone numbers (+7...)
    const russianPhoneRegex = /\+7[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/;
    const hasRussianPhone = russianPhoneRegex.test(description);

    // Collect some official looking links if possible (simple regex from description)
    // We limit this to avoid massive arrays if description is spammy
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const allLinks = description.match(urlRegex) || [];
    const officialLinks = [...new Set(allLinks)].slice(0, 10); // Unique and max 10

    return {
        channelId: item.id,
        title: snippet.title,
        description: description.substring(0, 1000), // Truncate description to save tokens
        keywords: keywords,
        customUrl: snippet.customUrl,
        country: snippet.country, // ISO code if available
        isTopicChannel: snippet.title.includes('- Topic'),
        hasVkLink: hasVkLink,
        hasYandexLink: hasYandexLink,
        hasRussianPhone: hasRussianPhone,
        officialLinks: officialLinks
    };
  }
}

// Export
if (typeof self !== 'undefined') {
  self.YouTubeAPI = YouTubeAPI;
}
