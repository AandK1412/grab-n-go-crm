/**
 * Grab-N-Go CRM — Google Apps Script backend
 * ------------------------------------------
 * Deploy as:  Web app -> Execute as: Me  |  Access: Anyone (or Anyone with Google account)
 * Paste the resulting /exec URL into assets/config.js on the frontend.
 *
 * Tabs created on first run:
 *   Leads         — primary record
 *   Activity_Logs — notes + stage change history
 *   Config        — single-row key/value (shared secret, etc.)
 *
 * Security note: the frontend posts as text/plain to avoid a CORS preflight.
 * If you want write auth, set SHARED_SECRET below and the frontend will send it
 * in the payload. Reads stay open by default — tighten in doGet if needed.
 */

const SHARED_SECRET = '';  // optional. If set, writes require matching 'secret' in payload.
const SHEET_NAME = {
  leads: 'Leads',
  logs:  'Activity_Logs',
  cfg:   'Config'
};

const LEAD_COLS = [
  'Lead_ID','First_Name','Last_Name','Email','Title','Company','Industry',
  'Status','Phone','Mobile_Phone','Work_Phone','LinkedIn_URL','Company_LinkedIn',
  'City','State','Country','Employees','Annual_Revenue','Technologies',
  'Apollo_Contact_ID','Apollo_Account_ID','Lists','Seniority','Departments',
  'Tags','Owner','Notes','Created_At','Updated_At','Imported_At'
];

const LOG_COLS = ['Log_ID','Lead_ID','Action_Type','Note_Content','Old_Value','New_Value','Actor','Timestamp'];

/* ======================= Entry points ======================= */

function doGet(e) {
  const action = (e.parameter.action || 'all').toLowerCase();
  try {
    if (action === 'ping')  return _json({ ok: true, time: new Date().toISOString() });
    if (action === 'leads') return _json({ ok: true, leads: _readTable(SHEET_NAME.leads, LEAD_COLS) });
    if (action === 'logs')  return _json({ ok: true, logs:  _readTable(SHEET_NAME.logs,  LOG_COLS) });
    if (action === 'all') {
      return _json({
        ok: true,
        leads: _readTable(SHEET_NAME.leads, LEAD_COLS),
        logs:  _readTable(SHEET_NAME.logs,  LOG_COLS),
        schema: { lead: LEAD_COLS, log: LOG_COLS }
      });
    }
    return _json({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return _json({ ok: false, error: 'Invalid JSON body' }); }

  if (SHARED_SECRET && body.secret !== SHARED_SECRET) {
    return _json({ ok: false, error: 'Unauthorized' });
  }

  try {
    switch (body.action) {
      case 'upsertLead':  return _json({ ok: true, lead: _upsertLead(body.lead, body.actor) });
      case 'updateStage': return _json({ ok: true, lead: _updateStage(body.leadId, body.stage, body.actor) });
      case 'addLog':      return _json({ ok: true, log:  _addLog(body.log) });
      case 'importBatch': return _json({ ok: true, result: _importBatch(body.leads, body.mode || 'merge', body.actor) });
      case 'deleteLead':  return _json({ ok: true, deleted: _deleteLead(body.leadId, body.actor) });
      default: return _json({ ok: false, error: 'Unknown action: ' + body.action });
    }
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

/* ======================= Core operations ======================= */

function _upsertLead(lead, actor) {
  const sh = _getSheet(SHEET_NAME.leads, LEAD_COLS);
  const rows = sh.getDataRange().getValues();
  const now = new Date().toISOString();

  if (!lead.Lead_ID) lead.Lead_ID = _uid('L');
  lead.Updated_At = now;

  const idIdx = _findRow(rows, 'Lead_ID', lead.Lead_ID);
  if (idIdx > 0) {
    // merge update
    const cur = _rowToObj(rows[0], rows[idIdx]);
    const merged = Object.assign({}, cur, _cleanLead(lead));
    merged.Created_At = cur.Created_At || now;
    sh.getRange(idIdx + 1, 1, 1, LEAD_COLS.length).setValues([_objToRow(merged, LEAD_COLS)]);
    _addLog({ Lead_ID: merged.Lead_ID, Action_Type: 'update', Note_Content: 'Lead updated', Actor: actor || '' });
    return merged;
  }
  // insert
  lead.Created_At = lead.Created_At || now;
  sh.appendRow(_objToRow(_cleanLead(lead), LEAD_COLS));
  _addLog({ Lead_ID: lead.Lead_ID, Action_Type: 'create', Note_Content: 'Lead created', Actor: actor || '' });
  _resort(sh);
  return lead;
}

function _updateStage(leadId, newStage, actor) {
  const sh = _getSheet(SHEET_NAME.leads, LEAD_COLS);
  const rows = sh.getDataRange().getValues();
  const idx = _findRow(rows, 'Lead_ID', leadId);
  if (idx < 1) throw new Error('Lead not found: ' + leadId);
  const header = rows[0];
  const statusCol = header.indexOf('Status') + 1;
  const updCol = header.indexOf('Updated_At') + 1;
  const oldStage = rows[idx][statusCol - 1];
  sh.getRange(idx + 1, statusCol).setValue(newStage);
  sh.getRange(idx + 1, updCol).setValue(new Date().toISOString());
  _addLog({
    Lead_ID: leadId, Action_Type: 'stage_change',
    Note_Content: 'Stage: ' + oldStage + ' -> ' + newStage,
    Old_Value: oldStage, New_Value: newStage, Actor: actor || ''
  });
  _resort(sh);
  return _rowToObj(header, sh.getRange(idx + 1, 1, 1, LEAD_COLS.length).getValues()[0]);
}

function _addLog(log) {
  const sh = _getSheet(SHEET_NAME.logs, LOG_COLS);
  const row = Object.assign({
    Log_ID: _uid('G'),
    Timestamp: new Date().toISOString()
  }, log);
  sh.appendRow(_objToRow(row, LOG_COLS));
  return row;
}

function _deleteLead(leadId, actor) {
  const sh = _getSheet(SHEET_NAME.leads, LEAD_COLS);
  const rows = sh.getDataRange().getValues();
  const idx = _findRow(rows, 'Lead_ID', leadId);
  if (idx < 1) return false;
  sh.deleteRow(idx + 1);
  _addLog({ Lead_ID: leadId, Action_Type: 'delete', Note_Content: 'Lead deleted', Actor: actor || '' });
  return true;
}

/**
 * Bulk import with dedup.
 * mode: 'skip'   — leave existing untouched, only append new
 *       'merge'  — fill missing fields on existing, append new
 *       'append' — add all incoming as new rows (no dedup)
 */
function _importBatch(incoming, mode, actor) {
  const sh = _getSheet(SHEET_NAME.leads, LEAD_COLS);
  const rows = sh.getDataRange().getValues();
  const header = rows[0];
  const now = new Date().toISOString();

  // dedup indices
  const byEmail = {}, byApollo = {};
  for (let i = 1; i < rows.length; i++) {
    const o = _rowToObj(header, rows[i]);
    if (o.Email) byEmail[o.Email.toLowerCase()] = i;
    if (o.Apollo_Contact_ID) byApollo[o.Apollo_Contact_ID] = i;
  }

  let added = 0, merged = 0, skipped = 0;
  const toAppend = [];

  incoming.forEach(raw => {
    const lead = _cleanLead(raw);
    const emailKey = (lead.Email || '').toLowerCase();
    const existingIdx = (emailKey && byEmail[emailKey]) ||
                        (lead.Apollo_Contact_ID && byApollo[lead.Apollo_Contact_ID]) || 0;

    if (existingIdx && mode !== 'append') {
      if (mode === 'skip') { skipped++; return; }
      // -1 marks a row appended earlier in this same batch (duplicate inside the CSV)
      if (existingIdx < 0) { skipped++; return; }
      // merge: fill only empty fields
      const cur = _rowToObj(header, rows[existingIdx]);
      let changed = false;
      LEAD_COLS.forEach(c => {
        if ((!cur[c] || cur[c] === '') && lead[c]) { cur[c] = lead[c]; changed = true; }
      });
      if (changed) {
        cur.Updated_At = now;
        sh.getRange(existingIdx + 1, 1, 1, LEAD_COLS.length).setValues([_objToRow(cur, LEAD_COLS)]);
        merged++;
      } else {
        skipped++;
      }
    } else {
      lead.Lead_ID = lead.Lead_ID || _uid('L');
      lead.Created_At = now;
      lead.Updated_At = now;
      lead.Imported_At = now;
      if (!lead.Status) lead.Status = 'New';
      toAppend.push(_objToRow(lead, LEAD_COLS));
      added++;
      if (emailKey) byEmail[emailKey] = -1;
      if (lead.Apollo_Contact_ID) byApollo[lead.Apollo_Contact_ID] = -1;
    }
  });

  if (toAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, LEAD_COLS.length).setValues(toAppend);
  }
  _resort(sh);
  _addLog({
    Lead_ID: '', Action_Type: 'import',
    Note_Content: 'Import: ' + added + ' added, ' + merged + ' merged, ' + skipped + ' skipped (mode=' + mode + ')',
    Actor: actor || ''
  });
  return { added, merged, skipped, total: incoming.length };
}

/* ======================= Helpers ======================= */

function _getSheet(name, cols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#0b6e5f').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _readTable(name, cols) {
  const sh = _getSheet(name, cols);
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows.slice(1).map(r => _rowToObj(header, r));
}

function _rowToObj(header, row) {
  const o = {};
  header.forEach((h, i) => { o[h] = row[i] === null ? '' : row[i]; });
  return o;
}

function _objToRow(obj, cols) {
  return cols.map(c => obj[c] === undefined || obj[c] === null ? '' : obj[c]);
}

function _findRow(rows, keyCol, keyVal) {
  if (!keyVal) return 0;
  const idx = rows[0].indexOf(keyCol);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][idx]) === String(keyVal)) return i;
  }
  return 0;
}

function _resort(sh) {
  if (sh.getLastRow() < 3) return;
  const range = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn());
  const statusCol = LEAD_COLS.indexOf('Status') + 1;
  const compCol = LEAD_COLS.indexOf('Company') + 1;
  range.sort([{ column: statusCol, ascending: true }, { column: compCol, ascending: true }]);
}

function _cleanLead(l) {
  const out = {};
  LEAD_COLS.forEach(c => { out[c] = l[c] === undefined ? '' : l[c]; });
  // normalize phone: prefer mobile, fall back to work
  if (!out.Phone) out.Phone = out.Mobile_Phone || out.Work_Phone || '';
  if (out.Email) out.Email = String(out.Email).trim().toLowerCase();
  return out;
}

function _uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ======================= Bootstrap ======================= */

function setup() {
  _getSheet(SHEET_NAME.leads, LEAD_COLS);
  _getSheet(SHEET_NAME.logs,  LOG_COLS);
  _getSheet(SHEET_NAME.cfg,   ['Key','Value']);
  SpreadsheetApp.getActive().toast('Grab-N-Go CRM sheets ready', 'Setup complete', 5);
}
