/**
 * Analytics event system — structured events for page_view, page_turn, etc.
 * 
 * Default implementation logs to console in development and stores events
 * in an in-memory array. Replace `handler` with your GA4/PostHog/Mixpanel
 * integration by calling `setAnalyticsHandler(yourFn)`.
 */

let analyticsHandler = (eventName, eventData) => {
  if (import.meta.env.DEV) {
    console.debug(`[Analytics] ${eventName}`, eventData);
  }
};

// In-memory event buffer for debugging/export
const eventBuffer = [];
const MAX_BUFFER_SIZE = 500;

/**
 * Replace the default analytics handler.
 * @param {(name: string, data: object) => void} handler
 */
export function setAnalyticsHandler(handler) {
  analyticsHandler = handler;
}

/**
 * Track an analytics event.
 * @param {string} name - Event name (e.g., 'page_turn', 'download_click')
 * @param {object} data - Event payload
 */
export function trackEvent(name, data = {}) {
  const event = {
    name,
    data,
    timestamp: Date.now(),
    url: window.location.href,
  };

  // Buffer events
  eventBuffer.push(event);
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    eventBuffer.shift();
  }

  // Dispatch to handler
  analyticsHandler(name, { ...data, timestamp: event.timestamp });
}

/**
 * Get buffered events (useful for debugging).
 * @returns {Array} Copy of event buffer
 */
export function getEventBuffer() {
  return [...eventBuffer];
}

// Pre-defined event names for type-safety
export const EVENTS = {
  PAGE_VIEW: 'page_view',
  PAGE_TURN: 'page_turn',
  DOWNLOAD_CLICK: 'download_click',
  ZOOM_USED: 'zoom_used',
  FULLSCREEN_TOGGLE: 'fullscreen_toggle',
  THUMBNAIL_OPEN: 'thumbnail_open',
  SOUND_TOGGLE: 'sound_toggle',
  PROSPECTUS_SELECT: 'prospectus_select',
  ROTATE_PROMPT_CLICK: 'rotate_prompt_click',
};
