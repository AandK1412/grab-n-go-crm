/* Grab-N-Go CRM — Apollo CSV ingestion.
 * Parses Apollo exports (the standard 71-col format), normalizes fields into
 * the Leads schema, and prepares a dedup-aware batch for the backend. */

(function () {
  // Apollo column header -> canonical lead field.
  // Multiple Apollo headers can target the same field; the mapper picks the first non-empty.
  const APOLLO_MAP = {
    'First Name':             'First_Name',
    'Last Name':              'Last_Name',
    'Title':                  'Title',
    'Email':                  'Email',
    'Mobile Phone':           'Mobile_Phone',
    'Work Direct Phone':      'Work_Phone',
    'Corporate Phone':        'Work_Phone',       // fallback if Work Direct is empty
    'Other Phone':            'Phone',            // last-resort fallback
    'Home Phone':             'Phone',
    'Person Linkedin Url':    'LinkedIn_URL',
    'Company Linkedin Url':   'Company_LinkedIn',
    'City':                   'City',
    'State':                  'State',
    'Country':                'Country',
    'Company Name':           'Company',
    'Company Name for Emails':'Company',          // alt
    'Industry':               'Industry',
    '# Employees':            'Employees',
    'Annual Revenue':         'Annual_Revenue',
    'Technologies':           'Technologies',
    'Apollo Contact Id':      'Apollo_Contact_ID',
    'Apollo Account Id':      'Apollo_Account_ID',
    'Stage':                  'Status',
    'Lists':                  'Lists',
    'Seniority':              'Seniority',
    'Departments':            'Departments',
    'Keywords':               'Tags',
    'Contact Owner':          'Owner'
  };

  // Apollo stage strings don't always match our pipeline. This maps the common ones.
  const STAGE_MAP = {
    'Cold':                 'New',
    'New':                  'New',
    'Open':                 'New',
    'Uncontacted':          'New',
    'Contacted':            'Contacted',
    'Replied':              'Contacted',
    'Meeting':              'Meeting Scheduled',
    'Meeting Scheduled':    'Meeting Scheduled',
    'Opportunity':          'Proposal Sent',
    'Proposal':             'Proposal Sent',
    'Qualified':            'Proposal Sent',
    'Customer':             'Closed - Won',
    'Closed Won':           'Closed - Won',
    'Closed - Won':         'Closed - Won',
    'Not Interested':       'Closed - Lost',
    'Unqualified':          'Closed - Lost',
    'Closed Lost':          'Closed - Lost',
    'Closed - Lost':        'Closed - Lost',
    'Do Not Contact':       'Closed - Lost'
  };

  function parseCSVFile(file) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: h => h.trim(),
        complete: res => resolve(res.data),
        error: err => reject(err)
      });
    });
  }

  function parseCSVText(text) {
    const res = Papa.parse(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: h => h.trim()
    });
    return res.data;
  }

  function _pick(row, header) {
    const v = row[header];
    if (v === undefined || v === null) return '';
    return String(v).trim();
  }

  // Prefer: Mobile Phone, then Work Direct Phone, then Corporate, then Other, then Home.
  function _primaryPhone(row) {
    const order = ['Mobile Phone', 'Work Direct Phone', 'Corporate Phone', 'Other Phone', 'Home Phone'];
    for (const k of order) {
      const v = _pick(row, k);
      if (v) return v;
    }
    return '';
  }

  function _normalizeStage(apolloStage, fallback = 'New') {
    if (!apolloStage) return fallback;
    const s = String(apolloStage).trim();
    if (STAGE_MAP[s]) return STAGE_MAP[s];
    // Case-insensitive fallback
    const key = Object.keys(STAGE_MAP).find(k => k.toLowerCase() === s.toLowerCase());
    return key ? STAGE_MAP[key] : fallback;
  }

  /** Convert one Apollo row to the canonical lead shape. */
  function mapRow(row, defaults = {}) {
    const lead = {
      First_Name:       _pick(row, 'First Name'),
      Last_Name:        _pick(row, 'Last Name'),
      Title:            _pick(row, 'Title'),
      Email:            _pick(row, 'Email').toLowerCase(),
      Mobile_Phone:     _pick(row, 'Mobile Phone'),
      Work_Phone:       _pick(row, 'Work Direct Phone') || _pick(row, 'Corporate Phone'),
      Phone:            _primaryPhone(row),
      LinkedIn_URL:     _pick(row, 'Person Linkedin Url'),
      Company_LinkedIn: _pick(row, 'Company Linkedin Url'),
      City:             _pick(row, 'City'),
      State:            _pick(row, 'State'),
      Country:          _pick(row, 'Country'),
      Company:          _pick(row, 'Company Name') || _pick(row, 'Company Name for Emails'),
      Industry:         _pick(row, 'Industry'),
      Employees:        _pick(row, '# Employees'),
      Annual_Revenue:   _pick(row, 'Annual Revenue'),
      Technologies:     _pick(row, 'Technologies'),
      Apollo_Contact_ID:_pick(row, 'Apollo Contact Id'),
      Apollo_Account_ID:_pick(row, 'Apollo Account Id'),
      Lists:            _pick(row, 'Lists'),
      Seniority:        _pick(row, 'Seniority'),
      Departments:      _pick(row, 'Departments'),
      Tags:             _pick(row, 'Keywords'),
      Owner:            _pick(row, 'Contact Owner') || defaults.owner || '',
      Status:           _normalizeStage(_pick(row, 'Stage'), defaults.stage || 'New'),
      Notes:            ''
    };
    return lead;
  }

  /** Map a whole array of rows, discarding ones without any of {Email, Company, Last_Name}. */
  function mapRows(rows, defaults) {
    return rows
      .map(r => mapRow(r, defaults))
      .filter(l => l.Email || l.Company || l.Last_Name);
  }

  /** Build a quick summary of what will happen on import, by comparing to existing leads. */
  function previewDedup(incoming, existing) {
    const byEmail = {}, byApollo = {};
    existing.forEach(e => {
      if (e.Email) byEmail[String(e.Email).toLowerCase()] = e;
      if (e.Apollo_Contact_ID) byApollo[e.Apollo_Contact_ID] = e;
    });
    let willAdd = 0, willMatch = 0;
    incoming.forEach(l => {
      const m = (l.Email && byEmail[l.Email]) || (l.Apollo_Contact_ID && byApollo[l.Apollo_Contact_ID]);
      if (m) willMatch++; else willAdd++;
    });
    return { total: incoming.length, willAdd, willMatch };
  }

  window.GNG_APOLLO = { parseCSVFile, parseCSVText, mapRow, mapRows, previewDedup, STAGE_MAP };
})();
