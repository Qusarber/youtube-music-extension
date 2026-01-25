// Popup Script
// Handles UI updates and user interactions

class PopupController {
  constructor() {
    this.elements = {
      title: document.getElementById('song-title'),
      artist: document.getElementById('artist-name'),
      artwork: document.getElementById('artwork'),
      statusBadge: document.getElementById('status-badge'),
      btnSkip: document.getElementById('btn-skip'),
      btnBlock: document.getElementById('btn-block'),
      btnAllow: document.getElementById('btn-allow'),
      debugInfo: document.getElementById('debug-info')
    };

    this.currentState = null;
    this.init();
  }

  init() {
    // Request current state from background
    this.requestState();

    // Listen for updates
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'STATE_UPDATE' || message.type === 'SONG_CHANGED') {
        this.updateUI(message.payload);
      }
    });

    // Bind controls
    this.elements.btnSkip.addEventListener('click', () => this.sendCommand('SKIP_SONG'));
    this.elements.btnBlock.addEventListener('click', () => this.sendCommand('BLOCK_ARTIST'));
    this.elements.btnAllow.addEventListener('click', () => this.sendCommand('ALLOW_ARTIST'));
  }

  requestState() {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_STATE' }, (response) => {
      if (response) {
        this.updateUI(response);
      }
    });
  }

  sendCommand(command) {
    chrome.runtime.sendMessage({ type: command, payload: this.currentState });
  }

  updateUI(state) {
    if (!state) return;
    this.currentState = state;

    // Update Text
    this.elements.title.textContent = state.title || 'No song detected';
    this.elements.artist.textContent = state.artist || 'Waiting for playback...';
    
    // Update Artwork
    if (state.artwork) {
      this.elements.artwork.src = state.artwork;
    } else {
      this.elements.artwork.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='%23333'/><text x='50' y='50' font-family='Arial' font-size='12' fill='%23666' text-anchor='middle' dy='.3em'>No Art</text></svg>";
    }

    // Update Status Badge
    const badge = this.elements.statusBadge;
    badge.className = 'badge'; // Reset classes
    
    if (state.status === 'blocked') {
      badge.textContent = 'Blocked';
      badge.classList.add('blocked');
    } else if (state.status === 'safe' || state.status === 'allowed') {
      badge.textContent = 'Safe';
      badge.classList.add('safe');
    } else if (state.status === 'pending') {
      badge.textContent = 'Checking...';
      badge.classList.add('pending');
    } else {
      badge.textContent = 'Unknown';
      badge.classList.add('unknown');
    }

    // Debug Info (Optional)
    // this.elements.debugInfo.textContent = JSON.stringify(state, null, 2);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
