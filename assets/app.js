/* Grab-N-Go CRM — frontend app (vanilla JS, re-render on state change).
 * Loads data from the Apps Script backend, renders Dashboard / Pipeline / Leads /
 * Activity / Settings. Drag-drop Kanban via Sortable. Drawer for lead detail.
 * Import flow handles Apollo CSV with field mapping and dedup preview. */

(function () {
  const cfg = window.GNG_CONFIG;
  const API = window.GNG_API;
  const APO = window.GNG_APOLLO;

  const S = {
    tab: 'dashboard',
    leads: [], logs: [],
    loading: true, err: '',
    q: '', pq: '', fStage: '', fIndustry: '', fOwner: '',
    sortCol: 'Updated_At', sortDir: 'desc',
    drawer: null,
    chartRefs: {}
  };
  try { const t = localStorage.getItem('gng.tab'); if (t) S.tab = t; } catch (e) {}

  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtTime = iso => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); };
  const fmtDate = iso => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); };
  const fullName = l => [l.First_Name, l.Last_Name].filter(Boolean).join(' ').trim() || '(no name)';
  const phoneOf = l => String(l.Phone || l.Mobile_Phone || l.Work_Phone || '');
  // Shared free-text match for the Leads table and Pipeline cards.
  const matchesQuery = (l, q) => !q || [fullName(l), l.Company, l.Title, l.Industry, l.Email, l.Tags, l.City, l.State,
    l.Phone, l.Mobile_Phone, l.Work_Phone, l.Owner].join(' ').toLowerCase().includes(q.toLowerCase());

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'err' ? ' err' : '');
    el.textContent = msg;
    $('#toast-root').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  const TABS = [
    ['dashboard',  'Dashboard'],
    ['pipeline',   'Pipeline'],
    ['leads',      'Leads'],
    ['activity',   'Activity'],
    ['settings',   'Settings']
  ];

  /* ============================ BOOT ============================ */

  async function boot() {
    render();
    if (!API.isConfigured()) {
      S.loading = false;
      S.err = 'Set APPS_SCRIPT_URL in assets/config.js, then reload.';
      $('#connStatus').textContent = 'not configured';
      render();
      return;
    }
    try {
      await refresh();
      if (cfg.REFRESH_MS > 0) setInterval(refresh, cfg.REFRESH_MS);
    } catch (e) {
      S.loading = false; S.err = e.message;
      $('#connStatus').textContent = 'connection error';
      render();
    }
  }

  async function refresh() {
    const j = await API.fetchAll();
    S.leads = j.leads || [];
    S.logs = (j.logs || []).sort((a,b)=> (b.Timestamp||'').localeCompare(a.Timestamp||''));
    S.loading = false; S.err = '';
    $('#connStatus').textContent = 'connected · ' + S.leads.length + ' leads';
    render();
  }

  /* ============================ RENDER ============================ */

  function render() {
    $('#tabs').innerHTML = TABS.map(([id,n]) =>
      `<button type="button" class="tab-btn" data-tab="${id}" aria-current="${S.tab===id}">${n}</button>`
    ).join('');

    const m = $('#main');
    if (S.loading) { m.innerHTML = banner('Loading from Google Sheets…'); return; }
    if (S.err) m.innerHTML = banner(S.err, 'err');
    else m.innerHTML = '';
    const view = views[S.tab] || views.dashboard;
    m.insertAdjacentHTML('beforeend', view());
    if (S.tab === 'pipeline') wireKanban();
    if (S.tab === 'dashboard') drawCharts();
    // Background refreshes must not wipe a half-filled form or import; only the lead detail view shows live data.
    if (S.drawer && S.drawer.type === 'lead') {
      const note = document.getElementById('noteTxt');
      const draft = note ? note.value : '';
      renderDrawer();
      const n = document.getElementById('noteTxt');
      if (n && draft) n.value = draft;
    }
  }

  function banner(msg, kind) {
    const bg = kind === 'err' ? 'bg-red-50 text-red-800 border-red-200' : 'bg-blue-50 text-blue-800 border-blue-200';
    return `<div class="border ${bg} rounded-md px-4 py-3 mb-4">${esc(msg)}</div>`;
  }

  /* ============================ VIEWS ============================ */

  const views = {};

  views.dashboard = () => {
    const total = S.leads.length;
    const byStage = cfg.STAGES.reduce((o,s) => (o[s] = S.leads.filter(l => l.Status === s).length, o), {});
    const won = byStage['Closed - Won'] || 0;
    const inFlight = total - (byStage['Closed - Won'] || 0) - (byStage['Closed - Lost'] || 0);
    const conv = total ? Math.round((won / total) * 100) : 0;
    const last7 = S.leads.filter(l => l.Imported_At && (Date.now() - new Date(l.Imported_At)) < 7*864e5).length;

    return `
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        ${statCard(total, 'Total leads')}
        ${statCard(inFlight, 'In pipeline')}
        ${statCard(won, 'Closed won')}
        ${statCard(conv + '%', 'Conversion')}
        ${statCard(last7, 'Imported (7d)')}
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="bg-white border border-brand-line rounded-lg p-4">
          <h3 class="font-semibold mb-3">Pipeline by stage</h3>
          <canvas id="chart-stage" height="200"></canvas>
        </div>
        <div class="bg-white border border-brand-line rounded-lg p-4">
          <h3 class="font-semibold mb-3">Leads by industry (top 8)</h3>
          <canvas id="chart-industry" height="200"></canvas>
        </div>
      </div>
      ${total === 0 ? emptyHint() : ''}
    `;
  };

  function emptyHint() {
    return `<div class="mt-6 bg-white border border-dashed border-brand-line rounded-lg p-8 text-center">
      <h3 class="font-semibold mb-1">No leads yet</h3>
      <p class="text-brand-muted mb-4">Import an Apollo CSV or add leads manually.</p>
      <div class="flex gap-2 justify-center">
        <button data-act="import" class="px-4 py-2 bg-brand text-white rounded-md font-semibold">Import Apollo CSV</button>
        <button data-act="newLead" class="px-4 py-2 border border-brand-line rounded-md font-semibold">+ New lead</button>
      </div>
    </div>`;
  }

  function statCard(val, label) {
    return `<div class="bg-white border border-brand-line rounded-lg p-4">
      <div class="font-mono text-3xl font-semibold">${esc(val)}</div>
      <div class="text-sm text-brand-muted">${esc(label)}</div>
    </div>`;
  }

  views.pipeline = () => {
    const stages = cfg.STAGES;
    const shown = S.leads.filter(l => matchesQuery(l, S.pq)).length;
    return `
      <div class="flex flex-wrap items-center gap-3 mb-3">
        <input id="pq" type="search" value="${esc(S.pq)}" placeholder="Search cards: name, company, title, email, phone…"
          class="flex-1 min-w-60 border border-brand-line rounded-md px-3 py-2 bg-white" aria-label="Search pipeline cards">
        ${S.pq ? `<span class="text-sm text-brand-muted">${shown} of ${S.leads.length} cards</span>` : ''}
      </div>
      <div class="mb-3 text-sm text-brand-muted">Drag cards between columns to update status. Changes save to Google Sheets.</div>
      <div class="grid gap-3" style="grid-template-columns: repeat(${stages.length}, minmax(220px, 1fr)); overflow-x:auto">
        ${stages.map(s => {
          const items = S.leads.filter(l => l.Status === s && matchesQuery(l, S.pq));
          return `<div class="bg-brand-bg border border-brand-line rounded-lg p-2 kanban-col" data-stage="${esc(s)}">
            <div class="flex justify-between items-center px-1 py-1">
              <span class="stage-pill" data-stage="${esc(s)}">${esc(s)}</span>
              <span class="font-mono text-sm text-brand-muted">${items.length}</span>
            </div>
            <div class="flex flex-col gap-2 mt-2 min-h-20" data-sortable>
              ${items.map(kanbanCard).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
  };

  function kanbanCard(l) {
    return `<div class="bg-white border border-brand-line rounded-md p-3 kanban-card" data-id="${esc(l.Lead_ID)}">
      <div class="font-semibold text-sm">${esc(fullName(l))}</div>
      <div class="text-xs text-brand-muted">${esc(l.Title || '')}</div>
      <div class="text-xs mt-1">${esc(l.Company || '')}</div>
      ${l.Industry ? `<div class="text-xs text-brand-muted">${esc(l.Industry)}</div>` : ''}
    </div>`;
  }

  views.leads = () => {
    const industries = [...new Set(S.leads.map(l => l.Industry).filter(Boolean))].sort();
    const owners = [...new Set(S.leads.map(l => l.Owner).filter(Boolean))].sort();
    let list = S.leads.filter(l => {
      if (S.fStage && l.Status !== S.fStage) return false;
      if (S.fIndustry && l.Industry !== S.fIndustry) return false;
      if (S.fOwner && l.Owner !== S.fOwner) return false;
      return matchesQuery(l, S.q);
    });
    list.sort((a,b) => {
      const av = (a[S.sortCol] || '').toString().toLowerCase();
      const bv = (b[S.sortCol] || '').toString().toLowerCase();
      return (S.sortDir === 'asc' ? 1 : -1) * (av < bv ? -1 : av > bv ? 1 : 0);
    });

    const cols = [
      ['Name',       'Last_Name'],
      ['Phone',      'Phone'],
      ['Title',      'Title'],
      ['Company',    'Company'],
      ['Industry',   'Industry'],
      ['Stage',      'Status'],
      ['Owner',      'Owner'],
      ['Updated',    'Updated_At']
    ];

    return `
      <div class="flex flex-wrap gap-2 mb-3">
        <input id="fq" type="search" value="${esc(S.q)}" placeholder="Search name, company, title, email, tags…"
          class="flex-1 min-w-60 border border-brand-line rounded-md px-3 py-2 bg-white" aria-label="Search">
        <select id="fStage" class="border border-brand-line rounded-md px-3 py-2 bg-white">
          <option value="">All stages</option>${cfg.STAGES.map(s => `<option${s===S.fStage?' selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select id="fIndustry" class="border border-brand-line rounded-md px-3 py-2 bg-white">
          <option value="">All industries</option>${industries.map(s => `<option${s===S.fIndustry?' selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select id="fOwner" class="border border-brand-line rounded-md px-3 py-2 bg-white">
          <option value="">All owners</option>${owners.map(s => `<option${s===S.fOwner?' selected':''}>${esc(s)}</option>`).join('')}
        </select>
      </div>
      <div class="text-sm text-brand-muted mb-2">${list.length} of ${S.leads.length} leads</div>
      <div class="bg-white border border-brand-line rounded-lg overflow-x-auto">
        <table class="data">
          <thead><tr>${cols.map(([n,k]) => `<th data-sort="${esc(k)}">${esc(n)}${S.sortCol===k?(S.sortDir==='asc'?' ↑':' ↓'):''}</th>`).join('')}</tr></thead>
          <tbody>
            ${list.length ? list.map(leadRow).join('') : `<tr><td colspan="${cols.length}" class="text-brand-muted text-center p-6">No matches. Clear filters to see more.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  };

  function leadRow(l) {
    return `<tr data-open="${esc(l.Lead_ID)}">
      <td><div class="font-semibold">${esc(fullName(l))}</div>
          <div class="text-xs text-brand-muted">${esc(l.Email || '')}</div></td>
      <td class="whitespace-nowrap">${phoneOf(l) ? `<a href="tel:${esc(phoneOf(l).replace(/[^\d+]/g, ''))}" class="text-brand hover:underline" data-tel="1">${esc(phoneOf(l))}</a>` : '<span class="text-brand-muted">—</span>'}</td>
      <td>${esc(l.Title || '')}</td>
      <td>${esc(l.Company || '')}</td>
      <td>${esc(l.Industry || '')}</td>
      <td><span class="stage-pill" data-stage="${esc(l.Status || 'New')}">${esc(l.Status || 'New')}</span></td>
      <td>${esc(l.Owner || '')}</td>
      <td class="text-xs text-brand-muted whitespace-nowrap">${esc(fmtTime(l.Updated_At))}</td>
    </tr>`;
  }

  views.activity = () => {
    const items = S.logs.slice(0, 300);
    if (!items.length) return `<div class="bg-white border border-brand-line rounded-lg p-6 text-center text-brand-muted">No activity yet. Imports, stage changes and notes show up here.</div>`;
    const byLead = Object.fromEntries(S.leads.map(l => [l.Lead_ID, l]));
    return `<div class="bg-white border border-brand-line rounded-lg divide-y divide-brand-line">
      ${items.map(x => {
        const lead = byLead[x.Lead_ID];
        return `<div class="p-3 flex gap-4">
          <div class="font-mono text-xs text-brand-muted w-32 flex-shrink-0">${esc(fmtTime(x.Timestamp))}</div>
          <div class="flex-1 min-w-0">
            ${lead ? `<a class="font-semibold cursor-pointer text-brand hover:underline" data-open="${esc(x.Lead_ID)}">${esc(fullName(lead))}</a> · ` : ''}
            <span class="text-xs uppercase tracking-wider text-brand-muted">${esc(x.Action_Type || '')}</span>
            <div class="text-sm">${esc(x.Note_Content || '')}</div>
            ${x.Actor ? `<div class="text-xs text-brand-muted">by ${esc(x.Actor)}</div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  };

  views.settings = () => {
    return `
      <div class="bg-white border border-brand-line rounded-lg p-4 mb-4">
        <h3 class="font-semibold mb-2">Google Sheet</h3>
        ${cfg.SHEET_URL
          ? `<div class="text-sm text-brand-muted mb-3">All leads and activity are stored here. You can view or edit them directly.</div>
             <a href="${esc(cfg.SHEET_URL)}" target="_blank" rel="noopener" class="inline-block px-3 py-2 bg-brand text-white rounded-md text-sm font-semibold hover:opacity-90">Open Google Sheet ↗</a>`
          : `<div class="text-sm text-brand-muted">Set <code>SHEET_URL</code> in <code>assets/config.js</code> to show a link to the sheet here.</div>`}
      </div>
      <div class="bg-white border border-brand-line rounded-lg p-4 mb-4">
        <h3 class="font-semibold mb-2">Backend</h3>
        <div class="text-sm text-brand-muted mb-2">Apps Script Web App URL</div>
        <code class="block bg-brand-bg p-2 rounded break-all text-xs">${esc(cfg.APPS_SCRIPT_URL || '(not set — edit assets/config.js)')}</code>
        <div class="mt-3 flex gap-2">
          <button data-act="ping" class="px-3 py-2 border border-brand-line rounded-md text-sm font-semibold">Test connection</button>
          <button data-act="refresh" class="px-3 py-2 border border-brand-line rounded-md text-sm font-semibold">Reload data</button>
          <button data-act="export" class="px-3 py-2 border border-brand-line rounded-md text-sm font-semibold">Export leads CSV</button>
        </div>
      </div>
      <div class="bg-white border border-brand-line rounded-lg p-4 mb-4">
        <h3 class="font-semibold mb-2">Owners</h3>
        <div class="text-sm text-brand-muted">${cfg.OWNERS.map(esc).join(' · ')}</div>
        <div class="text-xs text-brand-muted mt-2">Edit <code>assets/config.js</code> to change the owner list, stages, or default owner.</div>
      </div>
      <div class="bg-white border border-brand-line rounded-lg p-4">
        <h3 class="font-semibold mb-2">Stages</h3>
        <div class="flex flex-wrap gap-2">
          ${cfg.STAGES.map(s => `<span class="stage-pill" data-stage="${esc(s)}">${esc(s)}</span>`).join('')}
        </div>
      </div>
    `;
  };

  /* ============================ CHARTS ============================ */

  function drawCharts() {
    // destroy old chart instances before redrawing
    Object.values(S.chartRefs).forEach(c => c && c.destroy());
    S.chartRefs = {};

    const stageCanvas = document.getElementById('chart-stage');
    if (stageCanvas) {
      const data = cfg.STAGES.map(s => S.leads.filter(l => l.Status === s).length);
      const colors = ['#5b6b67', '#2a64b8', '#8b4ab8', '#c4501b', '#1d7a3e', '#b4232c'];
      S.chartRefs.stage = new Chart(stageCanvas, {
        type: 'bar',
        data: {
          labels: cfg.STAGES,
          datasets: [{ data, backgroundColor: colors.slice(0, cfg.STAGES.length) }]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
          maintainAspectRatio: false
        }
      });
    }
    const indCanvas = document.getElementById('chart-industry');
    if (indCanvas) {
      const counts = {};
      S.leads.forEach(l => { if (l.Industry) counts[l.Industry] = (counts[l.Industry]||0)+1; });
      const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0, 8);
      const palette = ['#0b6e5f','#2a64b8','#c4501b','#8b4ab8','#1d7a3e','#a86a00','#b4232c','#5b6b67'];
      S.chartRefs.ind = new Chart(indCanvas, {
        type: 'doughnut',
        data: { labels: top.map(x => x[0]), datasets: [{ data: top.map(x => x[1]), backgroundColor: palette }] },
        options: { plugins: { legend: { position: 'right', labels: { boxWidth: 12 } } }, maintainAspectRatio: false }
      });
    }
  }

  /* ============================ KANBAN ============================ */

  function wireKanban() {
    $$('[data-sortable]').forEach(col => {
      new Sortable(col, {
        group: 'leads',
        animation: 150,
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        onEnd: async evt => {
          const id = evt.item.dataset.id;
          const newStage = evt.to.closest('[data-stage]').dataset.stage;
          const lead = S.leads.find(l => l.Lead_ID === id);
          if (!lead || lead.Status === newStage) return;
          const old = lead.Status;
          lead.Status = newStage;  // optimistic
          try {
            await API.updateStage(id, newStage, cfg.DEFAULT_OWNER);
            toast(`${fullName(lead)} → ${newStage}`);
            refresh();
          } catch (e) {
            lead.Status = old;
            toast('Could not update stage: ' + e.message, 'err');
            render();
          }
        }
      });
    });
  }

  /* ============================ DRAWER ============================ */

  function openDrawer(d) { S.drawer = d; renderDrawer(); }
  function closeDrawer() { S.drawer = null; $('#drawer-root').innerHTML = ''; document.body.style.overflow = ''; }

  function renderDrawer() {
    const d = S.drawer; if (!d) return;
    let title, body;
    if (d.type === 'lead') {
      const l = S.leads.find(x => x.Lead_ID === d.id);
      if (!l) { closeDrawer(); return; }
      title = fullName(l); body = leadDetail(l);
    } else if (d.type === 'leadForm') {
      title = d.id ? 'Edit lead' : 'New lead';
      body = leadForm(d.id ? S.leads.find(x => x.Lead_ID === d.id) : null);
    } else if (d.type === 'import') {
      title = 'Import Apollo CSV'; body = importView(d);
    }
    document.body.style.overflow = 'hidden';
    $('#drawer-root').innerHTML = `
      <div class="drawer-bg" data-close="1">
        <div class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <div class="drawer-h"><h2 class="flex-1 font-bold text-lg">${esc(title)}</h2>
            <button class="px-3 py-1.5 border border-brand-line rounded-md text-sm" data-close="1">Close</button></div>
          <div class="drawer-b">${body}</div>
        </div>
      </div>`;
  }

  function leadDetail(l) {
    const logs = S.logs.filter(x => x.Lead_ID === l.Lead_ID);
    const field = (k, v) => `<div><div class="text-xs uppercase tracking-wider text-brand-muted">${esc(k)}</div><div>${v || '<span class="text-brand-muted">—</span>'}</div></div>`;
    const link = (url, label) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="text-brand hover:underline">${esc(label || url)}</a>` : '';
    const techs = (l.Technologies || '').split(/[,;]/).map(t=>t.trim()).filter(Boolean);
    return `
      <div class="flex items-center gap-2 flex-wrap">
        <span class="stage-pill" data-stage="${esc(l.Status || 'New')}">${esc(l.Status || 'New')}</span>
        ${l.Industry ? `<span class="text-sm text-brand-muted">${esc(l.Industry)}</span>` : ''}
        <div class="ml-auto flex gap-2">
          <button class="px-3 py-1.5 border border-brand-line rounded-md text-sm" data-editlead="${esc(l.Lead_ID)}">Edit</button>
          <button class="px-3 py-1.5 border border-red-200 text-red-700 rounded-md text-sm" data-dellead="${esc(l.Lead_ID)}">Delete</button>
        </div>
      </div>
      <div class="field">
        <label>Stage</label>
        <select data-stagefor="${esc(l.Lead_ID)}">${cfg.STAGES.map(s => `<option${s===l.Status?' selected':''}>${esc(s)}</option>`).join('')}</select>
      </div>
      <div class="bg-white border border-brand-line rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${field('Email', esc(l.Email))}
        ${field('Primary phone', esc(l.Phone))}
        ${field('Mobile', esc(l.Mobile_Phone))}
        ${field('Work direct', esc(l.Work_Phone))}
        ${field('Title', esc(l.Title))}
        ${field('Company', esc(l.Company))}
        ${field('Industry', esc(l.Industry))}
        ${field('Employees', esc(l.Employees))}
        ${field('Annual revenue', esc(l.Annual_Revenue))}
        ${field('Location', esc([l.City, l.State, l.Country].filter(Boolean).join(', ')))}
        ${field('LinkedIn', link(l.LinkedIn_URL, 'Profile'))}
        ${field('Company LinkedIn', link(l.Company_LinkedIn, 'Page'))}
        ${field('Owner', esc(l.Owner))}
        ${field('Lists', esc(l.Lists))}
        ${field('Apollo ID', `<code class="text-xs">${esc(l.Apollo_Contact_ID)}</code>`)}
        ${field('Created / Updated', `${esc(fmtTime(l.Created_At))} / ${esc(fmtTime(l.Updated_At))}`)}
      </div>
      ${techs.length ? `<div class="bg-white border border-brand-line rounded-lg p-4"><div class="text-xs uppercase tracking-wider text-brand-muted mb-2">Technology stack</div>
        <div class="flex flex-wrap gap-1">${techs.slice(0,30).map(t => `<span class="text-xs bg-brand-bg border border-brand-line rounded px-2 py-0.5">${esc(t)}</span>`).join('')}</div></div>` : ''}
      ${l.Notes ? `<div class="bg-white border border-brand-line rounded-lg p-4"><div class="text-xs uppercase tracking-wider text-brand-muted mb-1">Notes</div><div>${esc(l.Notes)}</div></div>` : ''}

      <div class="bg-white border border-brand-line rounded-lg p-4">
        <h3 class="font-semibold mb-2">Add note</h3>
        <div class="field"><textarea id="noteTxt" placeholder="What happened? Who did you reach? Next step?"></textarea></div>
        <div class="flex justify-end mt-2"><button class="px-3 py-2 bg-brand text-white rounded-md font-semibold text-sm" data-addnote="${esc(l.Lead_ID)}">Save note</button></div>
      </div>

      <div class="bg-white border border-brand-line rounded-lg p-4">
        <h3 class="font-semibold mb-2">Activity (${logs.length})</h3>
        ${logs.length ? `<div class="divide-y divide-brand-line">${logs.map(x => `<div class="py-2">
          <div class="text-xs text-brand-muted font-mono">${esc(fmtTime(x.Timestamp))} · ${esc(x.Action_Type)}${x.Actor?' · '+esc(x.Actor):''}</div>
          <div class="text-sm">${esc(x.Note_Content || '')}</div>
        </div>`).join('')}</div>` : '<div class="text-sm text-brand-muted">No activity yet.</div>'}
      </div>
    `;
  }

  function leadForm(l) {
    l = l || { Status: 'New', Owner: cfg.DEFAULT_OWNER };
    const fld = (id, label, val, opts) => {
      if (opts && opts.select) return `<div class="field"><label for="${id}">${esc(label)}</label><select id="${id}">${opts.select.map(o=>`<option${o===val?' selected':''}>${esc(o)}</option>`).join('')}</select></div>`;
      if (opts && opts.textarea) return `<div class="field col-span-2"><label for="${id}">${esc(label)}</label><textarea id="${id}">${esc(val||'')}</textarea></div>`;
      return `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" value="${esc(val||'')}" type="${(opts&&opts.type)||'text'}"></div>`;
    };
    return `<form id="leadForm" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      ${fld('lf_first','First name', l.First_Name)}
      ${fld('lf_last', 'Last name',  l.Last_Name)}
      ${fld('lf_title','Title',      l.Title)}
      ${fld('lf_email','Email',      l.Email,     {type:'email'})}
      ${fld('lf_phone','Phone',      l.Phone,     {type:'tel'})}
      ${fld('lf_mobile','Mobile',    l.Mobile_Phone,{type:'tel'})}
      ${fld('lf_company','Company',  l.Company)}
      ${fld('lf_industry','Industry',l.Industry)}
      ${fld('lf_city','City',        l.City)}
      ${fld('lf_state','State',      l.State)}
      ${fld('lf_country','Country',  l.Country)}
      ${fld('lf_linkedin','LinkedIn URL', l.LinkedIn_URL, {type:'url'})}
      ${fld('lf_status','Stage',     l.Status || 'New', {select: cfg.STAGES})}
      ${fld('lf_owner','Owner',      l.Owner || cfg.DEFAULT_OWNER, {select: cfg.OWNERS})}
      ${fld('lf_notes','Notes',      l.Notes, {textarea: true})}
      <div class="col-span-2 flex gap-2 justify-end">
        <button type="button" class="px-4 py-2 border border-brand-line rounded-md font-semibold" data-close="1">Cancel</button>
        <button type="submit" class="px-4 py-2 bg-brand text-white rounded-md font-semibold">${l.Lead_ID?'Save':'Create lead'}</button>
      </div>
    </form>`;
  }

  function importView(d) {
    if (d.step === 1) {
      return `
        <p class="text-sm text-brand-muted">Choose a CSV exported from Apollo. The parser auto-detects standard Apollo columns (First Name, Last Name, Title, Email, Mobile/Work Phone, LinkedIn, Company, Industry, Employees, Annual Revenue, Technologies, Apollo Contact Id, Stage, Lists, etc.). Nothing saves until you confirm.</p>
        <div class="field"><label>Dedup mode</label>
          <select id="im_mode">
            <option value="merge" selected>Merge — fill missing fields on existing leads, append new</option>
            <option value="skip">Skip — leave existing untouched, append new only</option>
            <option value="append">Append — add every row as new (no dedup)</option>
          </select>
        </div>
        <div class="field"><label>Default owner for new leads</label>
          <select id="im_owner">${cfg.OWNERS.map(o => `<option${o===cfg.DEFAULT_OWNER?' selected':''}>${esc(o)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>CSV file</label><input id="im_file" type="file" accept=".csv,text/csv"></div>
        <div class="text-xs text-brand-muted">Phone priority: Mobile → Work Direct → Corporate → Other → Home. Email and Apollo Contact Id are used for dedup matching.</div>
      `;
    }
    if (d.step === 2) {
      const preview = APO.previewDedup(d.leads, S.leads);
      return `
        <div class="bg-brand-bg border border-brand-line rounded-lg p-4">
          <div class="grid grid-cols-3 gap-3 text-center">
            <div><div class="font-mono text-2xl">${preview.total}</div><div class="text-xs text-brand-muted">Rows in CSV</div></div>
            <div><div class="font-mono text-2xl text-green-700">${preview.willAdd}</div><div class="text-xs text-brand-muted">New leads to add</div></div>
            <div><div class="font-mono text-2xl text-blue-700">${preview.willMatch}</div><div class="text-xs text-brand-muted">Match existing (${esc(d.mode)})</div></div>
          </div>
        </div>
        <div class="bg-white border border-brand-line rounded-lg overflow-x-auto">
          <table class="data">
            <thead><tr><th>Name</th><th>Title</th><th>Company</th><th>Industry</th><th>Email</th><th>Phone</th><th>Stage</th></tr></thead>
            <tbody>${d.leads.slice(0, 10).map(l => `<tr>
              <td>${esc(fullName(l))}</td><td>${esc(l.Title||'')}</td><td>${esc(l.Company||'')}</td>
              <td>${esc(l.Industry||'')}</td><td class="text-xs">${esc(l.Email||'')}</td>
              <td class="text-xs">${esc(l.Phone||'')}</td>
              <td><span class="stage-pill" data-stage="${esc(l.Status)}">${esc(l.Status)}</span></td>
            </tr>`).join('')}</tbody>
          </table>
          ${d.leads.length > 10 ? `<div class="p-2 text-xs text-brand-muted text-center">+ ${d.leads.length - 10} more</div>` : ''}
        </div>
        <div class="flex gap-2 justify-end">
          <button data-act="importBack" class="px-4 py-2 border border-brand-line rounded-md font-semibold">Back</button>
          <button data-act="runImport" class="px-4 py-2 bg-brand text-white rounded-md font-semibold">Import ${preview.total} rows</button>
        </div>
      `;
    }
    if (d.step === 3) {
      return `<div class="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
        <h3 class="font-semibold mb-1">Import complete</h3>
        <p>${esc(d.result)}</p>
        <button class="mt-4 px-4 py-2 bg-brand text-white rounded-md font-semibold" data-close="1">Done</button>
      </div>`;
    }
  }

  /* ============================ EVENTS ============================ */

  // tabs + global clicks
  document.addEventListener('click', async e => {
    if (e.target.closest('[data-tel]')) return;  // let tel: links dial without opening the row's drawer
    const t =e.target.closest('[data-tab],[data-close],[data-act],[data-open],[data-editlead],[data-dellead],[data-sort],[data-addnote]');
    if (!t) return;
    const ds = t.dataset;

    if (ds.tab) { S.tab = ds.tab; try { localStorage.setItem('gng.tab', S.tab); } catch(x){} closeDrawer(); render(); window.scrollTo(0,0); return; }
    // Clicks anywhere inside the drawer bubble up to .drawer-bg; only close on the backdrop itself or a close button.
    if (ds.close) { if (e.target === t || t.tagName === 'BUTTON') closeDrawer(); return; }
    if (ds.open) { openDrawer({type:'lead', id: ds.open}); return; }
    if (ds.editlead) { openDrawer({type:'leadForm', id: ds.editlead}); return; }
    if (ds.dellead) {
      if (!confirm('Delete this lead? This cannot be undone.')) return;
      try { await API.deleteLead(ds.dellead, cfg.DEFAULT_OWNER); toast('Lead deleted'); closeDrawer(); refresh(); }
      catch (x) { toast(x.message, 'err'); }
      return;
    }
    if (ds.sort) {
      if (S.sortCol === ds.sort) S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc';
      else { S.sortCol = ds.sort; S.sortDir = 'asc'; }
      render(); return;
    }
    if (ds.addnote) {
      const txt = ($('#noteTxt').value || '').trim();
      if (!txt) { toast('Write a note first', 'err'); return; }
      try {
        await API.addLog({ Lead_ID: ds.addnote, Action_Type: 'note', Note_Content: txt, Actor: cfg.DEFAULT_OWNER });
        $('#noteTxt').value = '';
        toast('Note saved'); refresh();
      } catch (x) { toast(x.message, 'err'); }
      return;
    }

    const a = ds.act;
    if (a === 'import' || t.id === 'importBtn') openDrawer({type:'import', step:1, mode:'merge', owner:cfg.DEFAULT_OWNER});
    if (a === 'newLead' || t.id === 'newLeadBtn') openDrawer({type:'leadForm'});
    if (a === 'ping') { try { await API.ping(); toast('Backend OK'); } catch (x) { toast(x.message, 'err'); } }
    if (a === 'refresh') { try { await refresh(); toast('Reloaded'); } catch (x) { toast(x.message, 'err'); } }
    if (a === 'export') { exportCSV(); }
    if (a === 'importBack') { S.drawer.step = 1; renderDrawer(); }
    if (a === 'runImport') { t.disabled = true; t.textContent = 'Importing…'; try { await runImport(S.drawer); } catch (x) { toast(x.message, 'err'); t.disabled = false; t.textContent = 'Import'; } }
  });

  // header buttons
  document.getElementById('importBtn').addEventListener('click', () => openDrawer({type:'import', step:1, mode:'merge', owner:cfg.DEFAULT_OWNER}));
  document.getElementById('newLeadBtn').addEventListener('click', () => openDrawer({type:'leadForm'}));

  // live input
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'fq' || t.id === 'pq') {
      S[t.id === 'fq' ? 'q' : 'pq'] = t.value;
      const pos = t.selectionStart; render();
      const n = document.getElementById(t.id); if (n){ n.focus(); n.setSelectionRange(pos,pos);}
    }
  });

  // selects
  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'fStage')    { S.fStage    = t.value; render(); }
    if (t.id === 'fIndustry') { S.fIndustry = t.value; render(); }
    if (t.id === 'fOwner')    { S.fOwner    = t.value; render(); }
    if (t.dataset.stagefor) {
      const id = t.dataset.stagefor;
      try { await API.updateStage(id, t.value, cfg.DEFAULT_OWNER); toast('Stage updated'); refresh(); }
      catch (x) { toast(x.message, 'err'); }
    }
    if (t.id === 'im_file' && t.files[0]) {
      try {
        const rows = await APO.parseCSVFile(t.files[0]);
        const mode = document.getElementById('im_mode').value;
        const owner = document.getElementById('im_owner').value;
        const leads = APO.mapRows(rows, { owner, stage: 'New' });
        if (!leads.length) { toast('No usable rows found in CSV', 'err'); return; }
        S.drawer.step = 2; S.drawer.leads = leads; S.drawer.mode = mode; S.drawer.owner = owner;
        renderDrawer();
      } catch (x) { toast('Could not parse CSV: ' + x.message, 'err'); }
    }
  });

  // forms
  document.addEventListener('submit', async e => {
    if (e.target.id !== 'leadForm') return;
    e.preventDefault();
    const g = id => (document.getElementById(id)?.value || '').trim();
    const prev = S.drawer.id ? S.leads.find(x => x.Lead_ID === S.drawer.id) : null;
    const lead = Object.assign({}, prev || {}, {
      First_Name: g('lf_first'), Last_Name: g('lf_last'), Title: g('lf_title'),
      Email: g('lf_email').toLowerCase(), Phone: g('lf_phone'), Mobile_Phone: g('lf_mobile'),
      Company: g('lf_company'), Industry: g('lf_industry'),
      City: g('lf_city'), State: g('lf_state'), Country: g('lf_country'),
      LinkedIn_URL: g('lf_linkedin'), Status: g('lf_status'), Owner: g('lf_owner'),
      Notes: g('lf_notes')
    });
    if (!lead.First_Name && !lead.Last_Name && !lead.Company) { toast('Add at least a name or company', 'err'); return; }
    try {
      const r = await API.upsertLead(lead, cfg.DEFAULT_OWNER);
      toast(prev ? 'Lead saved' : 'Lead created');
      await refresh();
      openDrawer({type:'lead', id: r.lead.Lead_ID});
    } catch (x) { toast(x.message, 'err'); }
  });

  async function runImport(d) {
    try {
      const r = (await API.importBatch(d.leads, d.mode, cfg.DEFAULT_OWNER)).result;
      d.step = 3;
      d.result = `${r.added} added, ${r.merged} merged, ${r.skipped} skipped — of ${r.total} rows.`;
      renderDrawer();
      refresh();
    } catch (x) {
      toast('Import failed: ' + x.message, 'err');
      const btn = document.querySelector('[data-act="runImport"]');
      if (btn) { btn.disabled = false; btn.textContent = 'Retry import'; }
    }
  }

  function exportCSV() {
    const cols = ['Lead_ID','First_Name','Last_Name','Email','Title','Company','Industry','Status','Phone','LinkedIn_URL','City','State','Country','Owner','Apollo_Contact_ID','Created_At','Updated_At'];
    const esc = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g,'""') + '"' : v; };
    const csv = [cols.join(',')].concat(S.leads.map(l => cols.map(c => esc(l[c])).join(','))).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'gng-leads-' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // escape closes drawer
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.drawer) closeDrawer(); });

  boot();
})();
