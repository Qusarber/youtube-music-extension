// Popup Script
// Handles UI updates and user interactions

class PopupController {
  constructor() {
    this.elements = {
      songTitle: document.getElementById('song-title'),
      artistName: document.getElementById('artist-name'),
      artworkImg: document.getElementById('artwork-img'),
      artworkPlaceholder: document.getElementById('artwork-placeholder'),
      statusBadge: document.getElementById('status-badge'),
      btnBlockCurrent: document.getElementById('btn-block-current'),
      recentList: document.getElementById('recent-list'),
      btnSeeAll: document.getElementById('btn-see-all'),
      btnToggleSearch: document.getElementById('btn-toggle-search'),
      searchContainer: document.getElementById('search-container'),
      searchInput: document.getElementById('search-input'),
      btnCloseSearch: document.getElementById('btn-close-search'),
      template: document.getElementById('artist-item-template')
    };

    this.currentState = null;
    this.allArtists = []; // Store all fetched artists
    this.isExpanded = false;
    this.isSearchActive = false;
    
    this.init();
  }

  init() {
    // Request current state from background
    this.requestState();
    this.requestHistory();

    // Listen for updates
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'STATE_UPDATE' || message.type === 'SONG_CHANGED') {
        this.updateUI(message.payload);
        // Also refresh history as it might have changed
        this.requestHistory();
      }
    });

    // Bind controls
    this.elements.btnBlockCurrent.addEventListener('click', () => {
        if (this.currentState && this.currentState.artist) {
            this.sendCommand('BLOCK_ARTIST', { 
                artist: this.currentState.artist,
                title: this.currentState.title
            });
        }
    });

    // Expand / See All
    this.elements.btnSeeAll.addEventListener('click', () => {
        this.toggleExpand();
    });

    // Search Toggle
    this.elements.btnToggleSearch.addEventListener('click', () => {
        this.toggleSearch(true);
    });

    // Close Search
    this.elements.btnCloseSearch.addEventListener('click', () => {
        this.toggleSearch(false);
    });

    // Search Input
    this.elements.searchInput.addEventListener('input', (e) => {
        this.renderRecentList(e.target.value.trim());
    });
  }

  requestState() {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_STATE' }, (response) => {
      if (response) {
        this.updateUI(response);
      }
    });
  }

  requestHistory() {
    chrome.runtime.sendMessage({ type: 'GET_ARTIST_HISTORY' }, (response) => {
        if (response && response.all) {
            this.allArtists = response.all;
            this.renderRecentList(this.elements.searchInput.value.trim());
        }
    });
  }

  sendCommand(command, payload) {
    chrome.runtime.sendMessage({ type: command, payload: payload || this.currentState });
    // Optimistically update history request shortly after
    setTimeout(() => this.requestHistory(), 100);
  }

  updateUI(state) {
    if (!state) return;
    this.currentState = state;

    // Update Text
    this.elements.songTitle.textContent = state.title || 'No song detected';
    this.elements.artistName.textContent = state.artist || 'Waiting for playback...';
    
    // Update Artwork
    if (state.artwork) {
        this.elements.artworkImg.src = state.artwork;
        this.elements.artworkImg.classList.remove('hidden');
        this.elements.artworkPlaceholder.classList.add('hidden');
    } else {
        this.elements.artworkImg.classList.add('hidden');
        this.elements.artworkPlaceholder.classList.remove('hidden');
    }

    // Update Status Badge
    const badge = this.elements.statusBadge;
    const statusText = badge.querySelector('.status-text');
    badge.className = 'status-badge'; // Reset classes
    badge.classList.remove('hidden');

    if (!state.title) {
        badge.classList.add('hidden');
        this.elements.btnBlockCurrent.disabled = true;
        return;
    }

    this.elements.btnBlockCurrent.disabled = false;

    if (state.status === 'blocked') {
      statusText.textContent = 'Blocked';
      badge.classList.add('blocked');
      this.elements.btnBlockCurrent.disabled = true; // Already blocked
      this.elements.btnBlockCurrent.innerHTML = '<span class="icon-check"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span> Blocked';
    } else if (state.status === 'safe' || state.status === 'allowed') {
      statusText.textContent = 'Safe';
      badge.classList.add('safe');
      this.elements.btnBlockCurrent.innerHTML = '<span class="icon-warning"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></span> Block Artist';
    } else if (state.status === 'pending') {
      statusText.textContent = 'Checking...';
      badge.classList.add('pending');
      this.elements.btnBlockCurrent.innerHTML = '<span class="icon-warning"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></span> Block Artist';
    } else {
      statusText.textContent = 'Unknown';
      badge.classList.add('unknown');
      this.elements.btnBlockCurrent.innerHTML = '<span class="icon-warning"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></span> Block Artist';
    }
    
    // Refresh list in case current artist changed (for filtering)
    this.renderRecentList(this.elements.searchInput.value.trim());
  }

  toggleExpand() {
    this.isExpanded = true;
    this.elements.searchContainer.classList.remove('hidden');
    // Also activate search mode logic implicitly
    this.isSearchActive = true; 
    this.elements.searchInput.focus();
    this.renderRecentList(this.elements.searchInput.value.trim());
  }

  toggleSearch(active) {
    this.isSearchActive = active;
    if (active) {
        this.elements.searchContainer.classList.remove('hidden');
        this.elements.searchInput.focus();
        // Re-render to potentially show all items immediately (if that's desired behavior)
        // or just to ensure state is consistent
        this.renderRecentList(this.elements.searchInput.value.trim());
    } else {
        this.elements.searchContainer.classList.add('hidden');
        this.elements.searchInput.value = '';
        this.isExpanded = false; // Collapse list
        this.renderRecentList();
    }
  }

  renderRecentList(searchQuery = '') {
      try {
          const container = this.elements.recentList;
          if (!container) return;
          
          container.innerHTML = '';
          
          // Filter artists
          let filtered = this.allArtists || [];

          // 1. Exclude current artist (so it doesn't appear in list while playing)
          if (this.currentState && this.currentState.artist) {
              filtered = filtered.filter(a => a.name !== this.currentState.artist);
          }

          // 2. Apply Search
          if (searchQuery) {
              const q = searchQuery.toLowerCase();
              filtered = filtered.filter(a => a.name.toLowerCase().includes(q));
          }

          const totalCount = filtered.length;
          
          // Determine how many to show
          // Show all if expanded OR search is active
          const shouldShowAll = this.isExpanded || this.isSearchActive;
          const itemsToShow = shouldShowAll ? filtered : filtered.slice(0, 5);

          if (itemsToShow.length === 0) {
              container.innerHTML = '<div class="empty-state">No recent activity</div>';
          } else {
              itemsToShow.forEach(artist => {
                  const clone = this.elements.template.content.cloneNode(true);
                  const nameEl = clone.querySelector('.artist-name');
                  const btnEl = clone.querySelector('.btn-icon-toggle');
                  
                  nameEl.textContent = artist.name;
                  nameEl.title = artist.name;

                  // Determine status and button style
                  if (artist.isRussian) {
                      // Currently Blocked -> Show "Allow"
                      btnEl.textContent = "Allow";
                      btnEl.classList.add('btn-action-sm', 'btn-action-allow');
                      btnEl.title = "Unblock/Allow this artist";
                      btnEl.addEventListener('click', () => {
                          this.sendCommand('ALLOW_ARTIST', { artist: artist.name });
                      });
                  } else {
                      // Currently Safe/Allowed -> Show "Block"
                      btnEl.textContent = "Block";
                      btnEl.classList.add('btn-action-sm', 'btn-action-block');
                      btnEl.title = "Block this artist";
                      btnEl.addEventListener('click', () => {
                          this.sendCommand('BLOCK_ARTIST', { artist: artist.name });
                      });
                  }

                  container.appendChild(clone);
              });
          }

          // Handle "See All" button visibility
          // Hide if expanded, searching, or not enough items
          if (shouldShowAll || totalCount <= 5) {
              this.elements.btnSeeAll.classList.add('hidden');
          } else {
              this.elements.btnSeeAll.classList.remove('hidden');
          }
          
          // Handle "Search Toggle" button visibility (in header)
          // Hide if search container is visible
          if (this.elements.searchContainer.classList.contains('hidden')) {
               this.elements.btnToggleSearch.classList.remove('hidden');
          } else {
               this.elements.btnToggleSearch.classList.add('hidden');
          }
      } catch (error) {
          console.error('Error rendering recent list:', error);
      }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
