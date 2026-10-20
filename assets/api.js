/* Grab-N-Go CRM — Apps Script client.
 * Uses text/plain POST to avoid a CORS preflight (Apps Script accepts arbitrary bodies).
 * All responses are JSON { ok, ... } or { ok:false, error }. */

(function () {
  const cfg = window.GNG_CONFIG || {};
  const url = () => (window.GNG_CONFIG && window.GNG_CONFIG.APPS_SCRIPT_URL) || '';

  async function _get(action, params = {}) {
    if (!url()) throw new Error('APPS_SCRIPT_URL is not set in assets/config.js');
    const qs = new URLSearchParams(Object.assign({ action }, params)).toString();
    const r = await fetch(url() + '?' + qs, { method: 'GET' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Request failed');
    return j;
  }

  async function _post(body) {
    if (!url()) throw new Error('APPS_SCRIPT_URL is not set in assets/config.js');
    const payload = Object.assign({}, body);
    if (cfg.SHARED_SECRET) payload.secret = cfg.SHARED_SECRET;
    // text/plain avoids the CORS preflight that application/json would trigger.
    const r = await fetch(url(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Request failed');
    return j;
  }

  window.GNG_API = {
    isConfigured: () => !!url(),
    ping:         ()                           => _get('ping'),
    fetchAll:     ()                           => _get('all'),
    fetchLeads:   ()                           => _get('leads'),
    fetchLogs:    ()                           => _get('logs'),
    upsertLead:   (lead, actor)                => _post({ action: 'upsertLead', lead, actor }),
    updateStage:  (leadId, stage, actor)       => _post({ action: 'updateStage', leadId, stage, actor }),
    addLog:       (log)                        => _post({ action: 'addLog', log }),
    importBatch:  (leads, mode, actor)         => _post({ action: 'importBatch', leads, mode, actor }),
    deleteLead:   (leadId, actor)              => _post({ action: 'deleteLead', leadId, actor })
  };
})();
