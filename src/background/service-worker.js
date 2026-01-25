// Background service worker
importScripts('../utils/normalization.js', 'storage.js', 'logger.js', 'search-cache.js', 'mistral-api.js', 'matcher.js', 'evaluator.js');

console.log('YouTube Music Extension Service Worker loaded.');

// Initialize storage on startup
chrome.runtime.onInstalled.addListener(() => {
  StorageManager.init().then(() => {
    console.log('Storage initialized.');
  });
});

/**
 * Sends an enforcement command to a specific tab.
 * 
 * @param {number} tabId 
 * @param {string} command - 'SKIP_SONG', 'LIKE_SONG', 'DISLIKE_SONG'
 */
function sendEnforcementCommand(tabId, command) {
    chrome.tabs.sendMessage(tabId, { type: command })
        .then(() => console.log(`Command ${command} sent to tab ${tabId}`))
        .catch(err => console.error(`Failed to send ${command} to tab ${tabId}:`, err));
}

let lastSkipTime = 0;
const SKIP_COOLDOWN = 1000; // 1 second cooldown

let currentSongState = {
  title: '',
  artist: '',
  artwork: '',
  status: 'unknown'
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CURRENT_STATE') {
    if (!currentSongState.title) {
        // If state is empty, try to fetch from active tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            if (activeTab && activeTab.url && activeTab.url.includes('music.youtube.com')) {
                chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PLAYBACK_STATUS' });
            }
        });
    }
    sendResponse(currentSongState);
    return true; // Keep channel open
  }

  if (message.type === 'SONG_CHANGED') {
    const { title, artist, artwork } = message.payload;
    console.log('Received song update:', message.payload);
    
    // Update local state
    currentSongState = { ...currentSongState, title, artist, artwork, status: 'pending' };
    
    // Broadcast initial update
    chrome.runtime.sendMessage({ type: 'SONG_CHANGED', payload: currentSongState }).catch(() => {});

    // Evaluate the song
    Evaluator.evaluateSong(title, artist).then(decision => {
      console.log('Evaluation decision:', decision);
      
      // Update status based on decision
      if (decision.shouldBlock) {
        currentSongState.status = 'blocked';
        Logger.logDecision(title, artist, decision.reason, decision.step);
      } else if (decision.step === 'PENDING_SEARCH') {
        currentSongState.status = 'pending';
      } else {
        currentSongState.status = 'safe';
        // Optional: log safe decisions if verbose mode is on
        // Logger.logDecision(title, artist, 'Allowed', decision.step);
      }
      
      // Broadcast evaluated state
      chrome.runtime.sendMessage({ type: 'STATE_UPDATE', payload: currentSongState }).catch(() => {});

      // If blocking is required, send command to content script
      if (decision.shouldBlock) {
          console.log('Blocking song:', title, 'by', artist);
          Logger.logAction('BLOCK_TRIGGERED', { title, artist, method: 'SKIP_SONG' });
          if (sender.tab && sender.tab.id) {
              const now = Date.now();
              if (now - lastSkipTime > SKIP_COOLDOWN) {
                  lastSkipTime = now;
                  
                  // Strict blocking actions
                  sendEnforcementCommand(sender.tab.id, 'DISLIKE_SONG');
                  // Give a slight delay for dislike to register before skipping? 
                  // Usually asynchronous messages are fine.
                  sendEnforcementCommand(sender.tab.id, 'SKIP_SONG');
              } else {
                  console.warn('Skip skipped due to cooldown (infinite loop prevention)');
              }
          }
      }

      if (decision.step === 'PENDING_SEARCH') {
        // Trigger search logic
        // 1. Check if artist is already in artist list (double check to be safe, though evaluator did it)
        SongMatcher.checkArtistMatch(artist).then(artistMatch => {
          if (artistMatch.match) {
             console.log('Artist found in list, no search needed (race condition resolved).');
             return;
          }

          // 2. Attempt to set pending in cache.
          // This implicitly checks if it's already pending or resolved.
          SearchCache.setPending(artist).then(started => {
            if (started) {
                console.log('Search initiated for:', artist);
                
                MistralAPI.searchArtist(artist)
                    .then(result => {
                        if (result && result.canonicalName) {
                            console.log('Search success:', result);
                            
                            // 1. Update Cache
                            SearchCache.setResolved(artist, { results: [result] });
                            
                            // 2. Update Artist List if valid info found
                            // Only add if we have useful info (e.g. country) or just to cache the name?
                            // Requirement: "write artist to artist list"
                            
                            const newArtist = {
                                id: crypto.randomUUID(),
                                name: result.canonicalName,
                                country: result.country, // Might be null or ISO code
                                lastPlayed: Date.now(),
                                addedBy: 'search',
                                comment: 'from search'
                            };

                            StorageManager.addArtist(newArtist).then(() => {
                                console.log('Artist added to persistent list:', newArtist);
                            });

                        } else {
                            console.log('Search returned no results');
                            SearchCache.setFailed(artist, 'No results found');
                        }
                    })
                    .catch(error => {
                        console.error('Search failed:', error);
                        SearchCache.setFailed(artist, error.toString());
                    });
            } else {
                console.log('Search skipped: already pending, resolved, or failed for:', artist);
            }
          });
        });
      }
    });
  }
  
  if (message.type === 'SKIP_SONG') {
    if (sender.tab && sender.tab.id) {
        // From popup via message passing (usually popup sends to runtime, which is here)
        // If message comes from popup, sender.tab might be undefined or the popup itself.
        // We need to find the active YTM tab.
        // But wait, sender logic:
        // If popup sends message, 'sender' is the extension.
        // We need to query for the active YTM tab.
    }
    
    // Popup initiated action
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab && activeTab.url && activeTab.url.includes('music.youtube.com')) {
            sendEnforcementCommand(activeTab.id, 'SKIP_SONG');
        } else {
            // Fallback: search for any YTM tab
            chrome.tabs.query({ url: "*://music.youtube.com/*" }, (ytmTabs) => {
                if (ytmTabs && ytmTabs.length > 0) {
                    sendEnforcementCommand(ytmTabs[0].id, 'SKIP_SONG');
                }
            });
        }
    });
  }

  if (message.type === 'QUEUE_UPDATED') {
    const queue = message.payload;
    if (queue && queue.length > 0) {
      // Process queue items at low priority (sequentially to avoid flooding)
      // Only process first few items to stay performant
      queue.forEach(item => {
        Evaluator.evaluateSong(item.title, item.artist).then(decision => {
          if (decision.shouldBlock) {
             console.log('Detected blocked song in queue:', item.title, 'by', item.artist);
             if (sender.tab && sender.tab.id) {
               // Send removal command with index
               // We need to pass the index or id back to content script
               chrome.tabs.sendMessage(sender.tab.id, { 
                   type: 'REMOVE_FROM_QUEUE', 
                   index: item.index 
               });
             }
          }
        });
      });
    }
  }
});
