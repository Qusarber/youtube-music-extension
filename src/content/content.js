// Content script
console.log('YouTube Music Extension Content Script loaded.');

(function() {
class PlayerController {
  constructor() {
    this.initListeners();
    this.enforcementState = {
        active: false,
        title: '',
        startTime: 0
    };
  }

  initListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Content script received message:', message.type, message);
      switch (message.type) {
        case 'GET_PLAYBACK_STATUS':
            // Proactively emit the current song
            if (monitor.lastSong) {
                monitor.emit(monitor.lastSong);
            } else {
                // If no song yet, try to check immediately
                monitor.check();
            }
            break;
        case 'LIKE_SONG':
          this.likeSong();
          break;
        case 'DISLIKE_SONG':
          this.handleDislikeCommand();
          break;
        case 'SKIP_SONG':
          this.handleSkipCommand();
          break;
        case 'BLOCK_CURRENT_SONG':
          this.blockCurrentSong();
          break;
        case 'REMOVE_FROM_QUEUE':
          this.removeFromQueue(message.index);
          break;
        case 'REMOVE_FROM_PLAYLIST':
          this.removeFromPlaylist(message.index);
          break;
      }
    });
  }

  async handleDislikeCommand() {
      const currentTitle = this.getCurrentTitle();
      console.log(`Starting robust dislike enforcement for: "${currentTitle}"`);
      
      // Initialize enforcement state for the current song
      this.enforcementState = {
          active: true,
          title: currentTitle,
          startTime: Date.now()
      };

      // Start the persistent loop
      this.enforceDislikeLoop();
  }

  async enforceDislikeLoop() {
      // 1. Safety Check: Stop if enforcement was disabled
      if (!this.enforcementState.active) return;

      const currentTitle = this.getCurrentTitle();
      
      // 2. Stop if song changed
      if (currentTitle !== this.enforcementState.title) {
          console.log('Song changed, stopping dislike enforcement.');
          this.enforcementState.active = false;
          return;
      }

      // 3. Attempt Dislike (includes idempotency check)
      // We assume if dislikeSong returns true, it is successfully disliked (or was already disliked)
      const success = await this.dislikeSong();
      
      if (success) {
          console.log('Dislike enforcement successful. Stopping loop.');
          this.enforcementState.active = false;
          return;
      }

      // 4. Timeout Check (Prevent infinite loops)
      const elapsed = Date.now() - this.enforcementState.startTime;
      if (elapsed > 60000) { // Stop after 60 seconds
          console.error('Dislike enforcement timed out (60s). Stopping retries.');
          this.enforcementState.active = false;
          return;
      }

      // 5. Retry with Backoff/Throttling
      // Use a generous delay to handle UI throttling or loading states
      const delay = 1500; // 1.5 seconds wait between attempts
      
      console.log(`Dislike not yet applied/verified. Retrying in ${delay}ms...`);
      setTimeout(() => this.enforceDislikeLoop(), delay);
  }

  async handleSkipCommand() {
      console.log('Handling SKIP_SONG command with retries...');
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
          if (this.skipSong()) {
              console.log(`Skip successful on attempt ${attempts + 1}`);
              return true;
          }
          console.log(`Skip attempt ${attempts + 1} failed. Retrying in 500ms...`);
          await new Promise(r => setTimeout(r, 500));
          attempts++;
      }
      console.error(`Failed to skip song after ${maxAttempts} attempts.`);
      return false;
  }

  likeSong() {
    const likeBtn = document.querySelector('ytmusic-like-button-renderer .like');
    if (likeBtn) {
      likeBtn.click();
      console.log('Liked song via extension');
    } else {
      console.warn('Like button not found');
    }
  }

  async dislikeSong() {
    console.log('Attempting to dislike song...');
    // Prefer stable, accessibility-based selectors first and fall back to broader scan
    const selectors = [
        'ytmusic-player-bar #button-shape-dislike > button',
        'ytmusic-player-bar #button-shape-dislike button',
        '.middle-controls-buttons yt-button-shape[aria-label="Dislike"] button',
        '.middle-controls-buttons yt-button-shape[aria-label="Не нравится"] button',
        '.middle-controls-buttons yt-button-shape[aria-label="Не подобається"] button',
        'ytmusic-like-button-renderer button[aria-label="Dislike"]',
        'ytmusic-like-button-renderer button[aria-label="Не нравится"]',
        'ytmusic-like-button-renderer button[aria-label="Не подобається"]',
        'ytmusic-player-bar button.dislike',
        'ytmusic-like-button-renderer .dislike',
        'ytmusic-player-bar .dislike'
    ];

    let dislikeBtn = null;

    for (const selector of selectors) {
        const candidate = document.querySelector(selector);
        if (candidate) {
            dislikeBtn = candidate;
            console.log(`Dislike button found using selector: "${selector}"`);
            break;
        }
    }

    // Fallback: search by aria-label within the main player bar to handle layout/DOM changes
    if (!dislikeBtn) {
        const playerBar = document.querySelector('ytmusic-player-bar');
        if (playerBar) {
            const labelKeywords = ['dislike', 'не нравится', 'не подобається'];
            const ariaCandidates = playerBar.querySelectorAll('button[aria-label], yt-button-shape[aria-label], [role="button"][aria-label]');
            for (const el of ariaCandidates) {
                const label = (el.getAttribute('aria-label') || '').toLowerCase();
                if (labelKeywords.some(k => label.includes(k))) {
                    dislikeBtn = el.tagName === 'BUTTON' ? el : (el.querySelector('button') || el);
                    console.log('Dislike button found via aria-label scan.');
                    break;
                }
            }
        }
    }

    if (!dislikeBtn) {
      console.error('Dislike button NOT found using any selector/aria-label scan.');
      return false;
    }

    if (!dislikeBtn.isConnected) {
        console.warn('Dislike button reference is detached from DOM, will retry.');
        return false;
    }

    // Idempotency Check: verify current state to avoid toggling off an existing dislike
    if (this.isDislikeButtonActive(dislikeBtn)) {
        // If the song is already disliked and enforcement was triggered (artist blocked),
        // immediately skip to prevent replaying previously disliked content.
        // This handles cases where a user manually starts an already-disliked track.
        console.log('Song already disliked. Initiating skip due to blocked artist.');
        await this.handleSkipCommand();
        return true;
    }

    if (dislikeBtn.disabled || dislikeBtn.getAttribute('aria-disabled') === 'true') {
        console.warn('Dislike button is currently disabled. Will retry shortly.');
        return false;
    }

    try {
        console.log('Clicking dislike button...');
        // Dispatch full click sequence to mimic a real user interaction
        const mousedownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
        const mouseupEvent = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });
        const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });

        dislikeBtn.dispatchEvent(mousedownEvent);
        dislikeBtn.dispatchEvent(mouseupEvent);
        dislikeBtn.dispatchEvent(clickEvent);
    } catch (e) {
        console.error('Click failed with error:', e);
        return false;
    }

    // Give YouTube Music time to update the button state and then verify it changed
    await new Promise(r => setTimeout(r, 200));

    const verificationTarget = (() => {
        if (dislikeBtn.isConnected) {
            return dislikeBtn;
        }
        const playerBar = document.querySelector('ytmusic-player-bar');
        if (!playerBar) return null;
        const labelKeywords = ['dislike', 'не нравится', 'не подобається'];
        const ariaCandidates = playerBar.querySelectorAll('button[aria-label], yt-button-shape[aria-label], [role="button"][aria-label]');
        for (const el of ariaCandidates) {
            const label = (el.getAttribute('aria-label') || '').toLowerCase();
            if (labelKeywords.some(k => label.includes(k))) {
                return el.tagName === 'BUTTON' ? el : (el.querySelector('button') || el);
            }
        }
        return null;
    })();

    if (verificationTarget && this.isDislikeButtonActive(verificationTarget)) {
        console.log('Dislike state confirmed after click.');
        return true;
    }

    console.warn('Dislike click did not change button state yet. Will retry if attempts remain.');
    return false;
  }

  isDislikeButtonActive(buttonEl) {
      if (!buttonEl) return false;
      const ariaPressed = buttonEl.getAttribute('aria-pressed');
      const ariaLabel = (buttonEl.getAttribute('aria-label') || '').toLowerCase();
      // Treat visual/ARIA-active states as "already disliked" to keep the action idempotent
      return ariaPressed === 'true' ||
             buttonEl.classList.contains('iron-selected') ||
             buttonEl.classList.contains('style-default-active') ||
             ariaLabel.includes('disliked');
  }

  async blockCurrentSong() {
      if (this.isBlocking) return; // Prevent re-entry
      this.isBlocking = true;
      console.log('Blocking current song: Dislike + Skip (Smart Mode)');
      
      try {
          const currentTitle = this.getCurrentTitle();

          // Use the robust retry handler
          await this.handleDislikeCommand();
          
          // Wait to see if auto-skip happens (increased delay)
          await new Promise(r => setTimeout(r, 800));

          const newTitle = this.getCurrentTitle();
          
          if (currentTitle === newTitle) {
               console.log('Song did not auto-skip. forcing skip.');
               this.skipSong();
               // Add delay after skip to let UI settle
               await new Promise(r => setTimeout(r, 1000));
          } else {
               console.log('Song auto-skipped (or changed).');
               // Still wait a bit to ensure we don't process the next one too fast
               await new Promise(r => setTimeout(r, 500));
          }
      } catch (err) {
          console.error('Error during block sequence:', err);
      } finally {
          this.isBlocking = false;
      }
  }

  getCurrentTitle() {
    const titleEl = document.querySelector('ytmusic-player-bar .title');
    return titleEl ? titleEl.textContent.trim() : '';
  }

  skipSong() {
    const selectors = [
        '.next-button',
        'ytmusic-player-bar .next-button',
        '[aria-label="Next"]',
        '[aria-label="Следующий трек"]',
        '[aria-label="Наступний трек"]'
    ];
    
    let nextBtn = null;
    for (const selector of selectors) {
        nextBtn = document.querySelector(selector);
        if (nextBtn) break;
    }

    if (nextBtn) {
      nextBtn.click();
      console.log('Skipped song via extension');
      return true;
    } else {
      console.warn('Next button not found');
      return false;
    }
  }

  removeFromQueue(index) {
    console.log(`Requested removal of queue item at index ${index}`);
  }

  removeFromPlaylist(index) {
    console.log(`Requested removal of playlist item at index ${index}`);
  }
}

class QueueMonitor {
    constructor() {
        this.checkInterval = 5000; // Low priority, 5 seconds
        this.intervalId = null;
        this.lastQueueHash = '';
    }

    start() {
        this.intervalId = setInterval(() => this.scanQueue(), this.checkInterval);
        console.log('QueueMonitor started.');
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    generateHash(queueData) {
        return queueData.map(item => `${item.index}:${item.title}:${item.artist}`).join('|');
    }

    scanQueue() {
        try {
            const queueItems = document.querySelectorAll('ytmusic-player-queue ytmusic-player-queue-item');
            
            if (queueItems && queueItems.length > 0) {
                const queueData = [];
                const limit = Math.min(queueItems.length, 10);
                
                for (let i = 0; i < limit; i++) {
                    const item = queueItems[i];
                    if (!item) continue;

                    const titleEl = item.querySelector('.song-title');
                    const artistEl = item.querySelector('.byline');
                    
                    if (titleEl && artistEl) {
                        queueData.push({
                            index: i,
                            title: titleEl.textContent.trim(),
                            artist: artistEl.textContent.trim()
                        });
                    }
                }

                if (queueData.length > 0) {
                    const currentHash = this.generateHash(queueData);
                    if (currentHash !== this.lastQueueHash) {
                        this.lastQueueHash = currentHash;
                        try {
                            chrome.runtime.sendMessage({
                                type: 'QUEUE_UPDATED',
                                payload: queueData
                            });
                        } catch (err) {
                            // Extension context invalidated or connection lost
                            console.debug('Failed to send QUEUE_UPDATED:', err);
                            this.stop(); // Stop scanning if extension is reloaded/disabled
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Error scanning queue:', e);
        }
    }
}

class PlaylistMonitor {
  constructor() {
    this.checkInterval = 3000; 
    this.intervalId = null;
    this.lastPlaylistHash = '';
  }

  start() {
    this.intervalId = setInterval(() => this.scanPlaylist(), this.checkInterval);
    console.log('PlaylistMonitor started.');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  isUserOwnedPlaylist() {
    try {
        const pencilIcon = document.querySelector('.metadata yt-icon-button'); 
        return !!pencilIcon || !!document.querySelector('[aria-label="Edit playlist"]');
    } catch (e) {
        return false;
    }
  }

  generateHash(playlistData) {
    return playlistData.map(item => `${item.index}:${item.title}:${item.artist}`).join('|');
  }

  scanPlaylist() {
    try {
        if (!window.location.href.includes('playlist')) {
          this.lastPlaylistHash = ''; // Reset if we leave playlist page
          return;
        }

        if (!this.isUserOwnedPlaylist()) {
          return;
        }

        const playlistItems = document.querySelectorAll('ytmusic-playlist-shelf-renderer ytmusic-responsive-list-item-renderer');
        
        if (playlistItems && playlistItems.length > 0) {
          const playlistData = [];
          const limit = Math.min(playlistItems.length, 20);

          for (let i = 0; i < limit; i++) {
            const item = playlistItems[i];
            if (!item) continue;

            const titleEl = item.querySelector('.title');
            const artistEl = item.querySelector('.secondary-flex-columns yt-formatted-string');

            if (titleEl && artistEl) {
                let artistText = artistEl.textContent;
                if (artistText.includes('•')) {
                    artistText = artistText.split('•')[0].trim();
                }

                playlistData.push({
                    index: i,
                    title: titleEl.textContent.trim(),
                    artist: artistText
                });
            }
          }

          if (playlistData.length > 0) {
            const currentHash = this.generateHash(playlistData);
            if (currentHash !== this.lastPlaylistHash) {
                this.lastPlaylistHash = currentHash;
                try {
                    chrome.runtime.sendMessage({
                        type: 'PLAYLIST_UPDATED',
                        payload: playlistData
                    });
                } catch (err) {
                    console.debug('Failed to send PLAYLIST_UPDATED:', err);
                    this.stop();
                }
            }
          }
        }
    } catch (e) {
        console.warn('Error scanning playlist:', e);
    }
  }
}

class SongMonitor {
  constructor() {
    this.lastSong = null;
    this.checkInterval = 1000; // Poll every second
    this.intervalId = null;
    this.observer = null;
  }

  start() {
    this.intervalId = setInterval(() => this.check(), this.checkInterval);
    this.initObserver();
    console.log('SongMonitor started.');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  check() {
    try {
        if (navigator.mediaSession && navigator.mediaSession.metadata) {
          const metadata = navigator.mediaSession.metadata;
          const currentSong = this.extractData(metadata);
          this.processSong(currentSong);
        }
    } catch (e) {
        console.debug('Error accessing MediaSession:', e);
    }
  }

  initObserver() {
    try {
        const playerBar = document.querySelector('ytmusic-player-bar');
        if (!playerBar) {
          // Retry later if player bar isn't loaded yet
          setTimeout(() => this.initObserver(), 2000);
          return;
        }

        this.observer = new MutationObserver(() => {
          // Fallback: Only use DOM if Media Session is unavailable
          if (!navigator.mediaSession || !navigator.mediaSession.metadata) {
            const domSong = this.extractDataFromDom();
            if (domSong) {
              this.processSong(domSong);
            }
          }
        });

        this.observer.observe(playerBar, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
    } catch (e) {
        console.warn('Failed to init observer:', e);
    }
  }

  processSong(song) {
    if (this.hasChanged(song)) {
      this.lastSong = song;
      this.emit(song);
    }
  }

  extractData(metadata) {
    if (!metadata) return { title: '', artist: '', artwork: '' };
    return {
      title: this.normalize(metadata.title),
      artist: this.normalize(metadata.artist),
      artwork: this.getArtworkUrl(metadata.artwork),
      channelId: this.getChannelId()
    };
  }

  getChannelId() {
    try {
        // Try to find the artist link in the byline
        // Structure is often: <ytmusic-player-bar> ... <span class="byline"> ... <a href="browse/UC...">Artist</a> ...
        const byline = document.querySelector('ytmusic-player-bar .byline');
        if (byline) {
            const links = byline.querySelectorAll('a');
            for (const link of links) {
                const href = link.getAttribute('href');
                if (href && (href.includes('channel/') || href.includes('browse/UC'))) {
                    const match = href.match(/(UC[\w-]{21,})/);
                    if (match) return match[1];
                }
            }
        }
    } catch (e) {
        console.debug('Error extracting channel ID:', e);
    }
    return '';
  }

  extractDataFromDom() {
    try {
      const titleEl = document.querySelector('ytmusic-player-bar .title');
      const artistEl = document.querySelector('ytmusic-player-bar .byline');
      const imageEl = document.querySelector('ytmusic-player-bar .image');

      // Artist text usually contains "Artist • Album • Year", we might need to parse it
      // For now, simply taking the text content as requested, can be refined if needed.
      // However, usually the first part is the artist.
      let artistText = artistEl ? artistEl.textContent : '';
      if (artistText) {
         // Simple heuristic to split by bullet point if present
         const parts = artistText.split('•');
         if (parts.length > 0) {
             artistText = parts[0];
         }
      }

      return {
        title: this.normalize(titleEl ? titleEl.textContent : ''),
        artist: this.normalize(artistText),
        artwork: imageEl ? imageEl.src : '',
        channelId: this.getChannelId()
      };
    } catch (e) {
      console.debug('Error extracting from DOM', e);
      return null;
    }
  }

  normalize(str) {
    if (!str) return '';
    return str.trim();
  }

  getArtworkUrl(artwork) {
    if (!artwork || artwork.length === 0) return '';
    // Prefer the largest image or the last one in the list
    const bestImage = artwork[artwork.length - 1];
    return bestImage.src || '';
  }

  hasChanged(currentSong) {
    if (!this.lastSong) return true;
    if (!currentSong) return false;
    return (
      currentSong.title !== this.lastSong.title ||
      currentSong.artist !== this.lastSong.artist ||
      currentSong.artwork !== this.lastSong.artwork
    );
  }

  emit(song) {
    const payload = {
      ...song,
      timestamp: Date.now()
    };
    console.log('Song detected:', payload);
    try {
      // Send to background script or other listeners
      chrome.runtime.sendMessage({
        type: 'SONG_CHANGED',
        payload: payload
      });
    } catch (error) {
      // Ignore errors if background is not listening yet or context invalid
      console.debug('Failed to send message:', error);
      // If context invalidated, stop monitoring to avoid spamming errors
      if (error.message && error.message.includes('Extension context invalidated')) {
          this.stop();
      }
    }
  }
}

const monitor = new SongMonitor();
monitor.start();
const playerController = new PlayerController();
const queueMonitor = new QueueMonitor();
queueMonitor.start();
const playlistMonitor = new PlaylistMonitor();
playlistMonitor.start();
})();
