// Background service worker
importScripts('../utils/normalization.js', 'env.js', 'storage.js', 'logger.js', 'search-cache.js', 'youtube-api.js', 'mistral-api.js', 'matcher.js', 'evaluator.js');

console.log('YouTube Music Extension Service Worker loaded.');

// Initialize storage on startup
chrome.runtime.onInstalled.addListener(() => {
  StorageManager.init().then(() => {
    console.log('Storage initialized.');
    // Force clear on update/install if requested by dev (optional, but good for this specific user request flow)
    // To respect the user's "clean list again" request immediately without them pressing the button:
    StorageManager.clearAll();
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
                  
                  // Check block mode
                  const mode = decision.blockMode || 'STRICT'; // Default to strict if undefined
                  
                  if (mode === 'STRICT') {
                      // Strict blocking actions: Dislike + Skip
                      sendEnforcementCommand(sender.tab.id, 'DISLIKE_SONG');
                      
                      // Delay skip slightly to ensure dislike registers
                      setTimeout(() => {
                        sendEnforcementCommand(sender.tab.id, 'SKIP_SONG');
                      }, 500);
                  } else {
                      console.log('Soft block (partial match): Skipping without dislike.');
                      sendEnforcementCommand(sender.tab.id, 'SKIP_SONG');
                  }
              } else {
                  console.warn('Skip skipped due to cooldown (infinite loop prevention)');
              }
          }
      }

      if (decision.step === 'PENDING_SEARCH') {
        // Trigger search logic
        const artistsToSearch = decision.artistsToSearch || [artist];
        
        // Loop through each unknown artist
        artistsToSearch.forEach(artistToSearch => {
            // 1. Check if artist is already in artist list (double check to be safe, though evaluator did it)
            SongMatcher.checkArtistMatch(artistToSearch).then(artistMatch => {
              if (artistMatch.match) {
                 console.log('Artist found in list, no search needed (race condition resolved):', artistToSearch);
                 return;
              }
    
              // 2. Attempt to set pending in cache.
              SearchCache.setPending(artistToSearch).then(started => {
                if (started) {
                    console.log('Search initiated for:', artistToSearch);
                    
                    // NEW: Pre-process with YouTube API
                    // We try to extract channel ID if passed from content script (need to update message passing for that)
                    // Currently 'artistToSearch' is just a string name. 
                    // To get the channel ID here, we would need to pass it from the evaluator/song data.
                    // The decision object currently doesn't carry the raw song data with channel ID easily, 
                    // but we can assume 'details' might have it if we update Evaluator or pass it through.
                    
                    // Ideally, Evaluator should pass the full song object or channelId in 'details' or similar.
                    // For now, let's rely on name-based search or check if we can access the channelId from the song details if available.
                    
                    // If we want to support channelId passed from content script, we need to ensure 'decision' includes it.
                    // Let's assume decision.details might contain it or we just search by name.
                    // We'll update the flow to try to use channelId if available.
                    
                    const channelId = (decision.details && decision.details.channelId) ? decision.details.channelId : null;

                    YouTubeAPI.getArtistDetails(artistToSearch, channelId)
                        .then(ytDetails => {
                            console.log('YouTube API Details:', ytDetails);
                            
                            // Pass enhanced context to Mistral
                            return MistralAPI.searchArtist(artistToSearch, ytDetails);
                        })
                        .then(result => {
                            if (result && result.canonicalName) {
                                console.log('Search success:', result);
                                
                                // 1. Update Cache
                                SearchCache.setResolved(artistToSearch, { results: [result] });
                                
                                // 2. Update Artist List if valid info found
                                const newArtist = {
                                    id: crypto.randomUUID(),
                                    name: result.canonicalName,
                                    country: result.country, // Might be null or ISO code
                                    isRussian: result.isRussian,
                                    aliases: [artistToSearch], // Add search query as alias to ensure future matches
                                    lastPlayed: Date.now(),
                                    addedBy: 'search',
                                    comment: 'from search'
                                };
    
                                StorageManager.addArtist(newArtist).then(() => {
                                    console.log('Artist added to persistent list:', newArtist);
                                    
                                    // Re-evaluate current song now that we have new data
                                    // Note: We re-evaluate using the ORIGINAL full artist string from currentSongState
                                    // This ensures we check all artists again, including the one just added.
                                    Evaluator.evaluateSong(currentSongState.title, currentSongState.artist).then(newDecision => {
                                        console.log('Re-evaluation decision:', newDecision);
                                        
                                        if (newDecision.shouldBlock) {
                                            currentSongState.status = 'blocked';
                                            Logger.logDecision(currentSongState.title, currentSongState.artist, newDecision.reason, newDecision.step);
                                        } else {
                                            // Only set to safe if NOT pending other searches?
                                            // If newDecision says PENDING_SEARCH (for other artists), we stay pending.
                                            // If newDecision says SAFE, we are safe.
                                            if (newDecision.step === 'PENDING_SEARCH') {
                                                currentSongState.status = 'pending';
                                            } else {
                                                currentSongState.status = 'safe';
                                            }
                                        }
                                        
                                        // Broadcast updated state
                                        chrome.runtime.sendMessage({ type: 'STATE_UPDATE', payload: currentSongState }).catch(() => {});
                                        
                                        // Handle blocking if needed
                                        if (newDecision.shouldBlock) {
                                             // Find active tab to send command
                                             chrome.tabs.query({ url: "*://music.youtube.com/*" }, (tabs) => {
                                                if (tabs && tabs.length > 0) {
                                                    const activeTab = tabs.find(t => t.active) || tabs[0];
                                                    
                                                    const mode = newDecision.blockMode || 'STRICT';
                                                    if (mode === 'STRICT') {
                                                        sendEnforcementCommand(activeTab.id, 'DISLIKE_SONG');
                                                        setTimeout(() => {
                                                            sendEnforcementCommand(activeTab.id, 'SKIP_SONG');
                                                        }, 500);
                                                    } else {
                                                        sendEnforcementCommand(activeTab.id, 'SKIP_SONG');
                                                    }
                                                }
                                             });
                                        }
                                    });
                                });
    
                            } else {
                                console.log('Search returned no results for:', artistToSearch);
                                SearchCache.setFailed(artistToSearch, 'No results found');
                            }
                        })
                        .catch(error => {
                            console.error('Search failed for:', artistToSearch, error);
                            SearchCache.setFailed(artistToSearch, error.toString());
                        });
                } else {
                    console.log('Search skipped: already pending, resolved, or failed for:', artistToSearch);
                }
              });
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

  if (message.type === 'CLEAR_STORAGE') {
    StorageManager.clearAll().then(() => {
        console.log('Storage cleared by user request.');
        // Optionally reset internal state or reload
        currentSongState = {
            title: '',
            artist: '',
            artwork: '',
            status: 'unknown'
        };
        chrome.runtime.sendMessage({ type: 'STATE_UPDATE', payload: currentSongState }).catch(() => {});
        sendResponse({ success: true });
    });
    return true; // Keep channel open
  }
});
