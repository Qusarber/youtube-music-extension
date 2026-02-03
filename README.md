# YouTube Music Extension

A Chrome Extension for YouTube Music that automatically detects and skips/blocks songs by russian artists or associated with russia. It ensures a cleaner music experience by filtering content based on artist origin and song language.

## Project General Description

This extension integrates with YouTube Music to monitor the currently playing song. It checks the artist and song title against a local database of known artists and uses the Mistral AI API to identify unknown artists in real-time. If a song is determined to be from a russian artist or associated with russia, it is automatically disliked and skipped.

## Technical Stack

- **Platform**: Chrome Extension (Manifest V3)
- **Language**: JavaScript (Vanilla)
- **Background Service Worker**: Handles core logic, API orchestration, and persistent storage.
- **Content Script**: Interacts with the YouTube Music DOM to control playback (Skip, Dislike).
- **Storage**: `chrome.storage.local` for persisting known artists, songs, and search cache to minimize API calls.
- **External APIs**:
  - **Mistral AI API**: Used for advanced natural language processing to identify the origin of unknown artists.
  - **YouTube Data API v3**: Fetches detailed channel information (description, country, links) to assist the identification process.

## Logic Behind Judgement Criteria

The extension uses a multi-layered pipeline to evaluate every song:

1.  **Known Song Check**:
    - Checks if the specific song (Title + Artist) is manually whitelisted in the local database.
    - **Result**: If found in whitelist -> **Allowed**.

2.  **Language Check**:
    - Analyzes the song title for unique Ukrainian characters.
    - **Result**: If title is detected as Ukrainian -> **Allowed** (Safe).

3.  **Artist Analysis**:
    - Splits multiple artists (e.g., "Artist A & Artist B").
    - Checks each artist against the local database of known artists.
    - **Result**:
        - If *any* artist is identified as **russian** (Country code 'ru', 'russia', or explicitly marked): **BLOCK (Strict Mode)**. The song is Disliked and Skipped.
        - If *all* artists are known and **Safe**: **Allowed**.
        - If an artist is **Unknown**: The system triggers a **Pending Search**.

4.  **Pending Search (AI-Powered)**:
    - For unknown artists, the extension fetches channel details via the **YouTube Data API**.
    - This data (or just the artist name) is sent to **Mistral AI**.
    - **Mistral Prompt Logic**:
        - Checks for explicit russian country codes.
        - Scans for links to russian platforms (vk, yandex).
        - Analyzes description text for keywords like "russian music", "russian hits", or cyrillic content associated with russia.      
        - Determines if the artist is a "russian music curator".
    - The result is cached to avoid repeated API calls.

## How to Setup Guide

### Prerequisites
- Google Chrome or a Chromium-based browser.
- A **Mistral AI** API Key.
- A **YouTube Data API v3** Key.

### Installation

1.  **Clone the Repository**

2.  **Configure API Keys**
    - Create a file named `env.js` in the `src/background/` directory.
    - Add your API keys in the following format:
    ```javascript
    // src/background/env.js
    const MISTRAL_API_KEY = 'YOUR_MISTRAL_API_KEY';
    const YOUTUBE_API_KEY = 'YOUR_YOUTUBE_API_KEY';
    ```

3.  **Load into Chrome**
    - Open Chrome and navigate to `chrome://extensions/`.
    - Enable **Developer mode** (toggle in the top-right corner).
    - Click **Load unpacked**.
    - Select the root folder of this project (`youtube-music-extension`).

4.  **Usage**
    - Open [YouTube Music](https://music.youtube.com).
    - The extension will automatically start monitoring playback.
    - You can view the status of the current song by clicking the extension icon.
