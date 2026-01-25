// Logger Module
// Handles logging of decisions and actions
// Configurable to enable/disable logs

class Logger {
  static enabled = true; // Default to true

  static enable() {
    this.enabled = true;
    console.log('Logger enabled');
  }

  static disable() {
    this.enabled = false;
    console.log('Logger disabled');
  }

  /**
   * Log a blocking decision
   * @param {string} title 
   * @param {string} artist 
   * @param {string} reason 
   * @param {string} source 
   */
  static logDecision(title, artist, reason, source) {
    if (!this.enabled) return;

    const logEntry = {
      type: 'DECISION_BLOCKED',
      timestamp: new Date().toISOString(),
      song: { title, artist },
      reason: reason,
      source: source
    };

    console.groupCollapsed(`[Block] ${artist} - ${title}`);
    console.log('Reason:', reason);
    console.log('Source:', source);
    console.log('Timestamp:', logEntry.timestamp);
    console.groupEnd();

    // Optionally persist logs to storage if needed for UI history
    // StorageManager.addLog(logEntry);
  }

  static logAction(action, details) {
    if (!this.enabled) return;
    console.log(`[Action] ${action}`, details);
  }

  static logError(context, error) {
    // Always log errors regardless of enabled state? 
    // Usually yes, but user requested disableable.
    // Let's keep errors visible or use a separate flag.
    console.error(`[Error] ${context}:`, error);
  }
}

// Export
if (typeof self !== 'undefined') {
  self.Logger = Logger;
}
