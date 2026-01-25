// Content script
console.log('YouTube Music Extension Content Script loaded.');

class PlayerController {
  constructor() {
    this.initListeners();
  }

  initListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
          this.dislikeSong();
          break;
        case 'SKIP_SONG':
          this.skipSong();
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

  likeSong() {
    const likeBtn = document.querySelector('ytmusic-like-button-renderer .like');
    if (likeBtn) {
      likeBtn.click();
      console.log('Liked song via extension');
    } else {
      console.warn('Like button not found');
    }
  }

  dislikeSong() {
    const dislikeBtn = document.querySelector('ytmusic-like-button-renderer .dislike');
    if (dislikeBtn) {
      dislikeBtn.click();
      console.log('Disliked song via extension');
    } else {
      console.warn('Dislike button not found');
    }
  }

  skipSong() {
    const nextBtn = document.querySelector('.next-button');
    if (nextBtn) {
      nextBtn.click();
      console.log('Skipped song via extension');
    } else {
      console.warn('Next button not found');
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
      artwork: this.getArtworkUrl(metadata.artwork)
    };
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
        artwork: imageEl ? imageEl.src : ''
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
