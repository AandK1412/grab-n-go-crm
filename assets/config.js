/* Grab-N-Go CRM — frontend configuration.
 * Edit this file after deploying your Apps Script Web App.
 * Keep this file in the repo so GitHub Pages serves it alongside the SPA. */

window.GNG_CONFIG = {
  // Paste your Apps Script /exec URL here (ends in /exec).
  // Example: "https://script.google.com/macros/s/AKfycbxxxxxxxxxxxx/exec"
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbyaN7gUN9zoLVy9_W2eKEUOm4Xq-vabfiNB3ACV8nbfZDfHkSBMfGgMNwVR1xo1Tcof/exec",

  // Must match SHARED_SECRET in Code.gs if you set one there. Leave "" for open writes.
  SHARED_SECRET: "",

  // Default owner shown on new leads. The CRM also exposes an owner dropdown.
  DEFAULT_OWNER: "Zuzanna",

  // Known owners for the dropdown.
  OWNERS: ["Zuzanna", "Anrunya", "Kent", "Vivek"],

  // Pipeline stages, in display order. If you change these, change Code.gs too isn't required
  // — the backend just stores whatever string the frontend sends.
  STAGES: ["New", "Contacted", "Meeting Scheduled", "Proposal Sent", "Closed - Won", "Closed - Lost"],

  // Refresh interval in ms for background re-sync of leads/logs. 0 to disable.
  REFRESH_MS: 60000
};
