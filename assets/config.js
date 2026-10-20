/* Grab-N-Go CRM — frontend configuration.
 * Edit this file after deploying your Apps Script Web App.
 * Keep this file in the repo so GitHub Pages serves it alongside the SPA. */

window.GNG_CONFIG = {
  // Which outreach program this copy of the CRM is for. Shown in the header and browser tab.
  CRM_LABEL: "Local Outreach",

  // Paste your Apps Script /exec URL here (ends in /exec).
  // Example: "https://script.google.com/macros/s/AKfycbxxxxxxxxxxxx/exec"
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbyaN7gUN9zoLVy9_W2eKEUOm4Xq-vabfiNB3ACV8nbfZDfHkSBMfGgMNwVR1xo1Tcof/exec",

  // Link to the Google Sheet that stores the data (shown on the Settings page).
  SHEET_URL: "https://docs.google.com/spreadsheets/d/1RIuQDHRUEBluAontQs72EAHy8SRweWxbRXksJnPfbP0/edit",

  // Must match SHARED_SECRET in Code.gs if you set one there. Leave "" for open writes.
  SHARED_SECRET: "",

  // Default owner shown on new leads. The CRM also exposes an owner dropdown.
  DEFAULT_OWNER: "anrunyap@gmail.com",

  // Known owners for the dropdown. DEFAULT_OWNER must be in this list to be preselected.
  OWNERS: ["anrunyap@gmail.com", "Zuzanna", "Anrunya", "Kent", "Kshama"],

  // Pipeline stages, in display order. If you change these, change Code.gs too isn't required
  // — the backend just stores whatever string the frontend sends.
  STAGES: ["New", "Contacted", "Meeting Scheduled", "Proposal Sent", "Closed - Won", "Closed - Lost"],

  // Refresh interval in ms for background re-sync of leads/logs. 0 to disable.
  REFRESH_MS: 60000
};
