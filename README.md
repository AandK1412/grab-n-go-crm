# Grab-N-Go CRM

Lightweight sales CRM for the Grab-N-Go outreach team. Hosted free on **GitHub Pages**, backed by a **Google Sheet** via a **Google Apps Script Web App**. Imports **Apollo.io** CSV exports directly.

- No server to run. No database to manage. No build step.
- Data lives in your Google Sheet — the team can view it there any time.
- Works on desktop and mobile browsers.

---

## What's in this repo

```
grab-n-go-crm/
├── index.html              # Single-page CRM shell
├── .nojekyll               # Tell GitHub Pages to serve files as-is
├── assets/
│   ├── config.js           # YOUR configuration (Apps Script URL goes here)
│   ├── api.js              # Backend client (fetch wrapper)
│   ├── apollo.js           # Apollo CSV parser + field mapper + dedup preview
│   ├── app.js              # Views, routing, Kanban, charts
│   └── styles.css          # Small bits beyond Tailwind
├── backend/
│   └── Code.gs             # Google Apps Script Web App (paste into Apps Script)
└── README.md               # This file
```

---

## Setup — one-time, ~15 minutes

### Step 1. Create the Google Sheet

1. Go to <https://sheets.google.com> and create a blank sheet.
2. Name it something like **"Grab-N-Go CRM Database"**.
3. Leave it empty — the Apps Script will create the `Leads`, `Activity_Logs`, and `Config` tabs on first run.

### Step 2. Add the Apps Script backend

1. In your new Sheet, click **Extensions → Apps Script**. A new browser tab opens.
2. Delete the default `function myFunction() {}` placeholder.
3. Open `backend/Code.gs` from this repo, copy its entire contents, and paste into the Apps Script editor.
4. Click the **Save** icon (💾). Name the project **"Grab-N-Go CRM Backend"**.
5. In the function dropdown at the top, select `setup` and click **Run**. The first time you run it, Google will ask you to **Review permissions** → pick your Google account → **Advanced → Go to Grab-N-Go CRM Backend (unsafe) → Allow**. (It says "unsafe" because the script is unverified — it's your own code, running under your own account, on your own sheet.) After it runs, flip back to your sheet — you should see `Leads`, `Activity_Logs`, and `Config` tabs appear.

### Step 3. Deploy the Web App

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon ⚙️ next to "Select type" → **Web app**.
3. Fill in:
   - **Description**: Grab-N-Go CRM v1
   - **Execute as**: Me (your email)
   - **Who has access**: **Anyone** (or "Anyone with Google account" if you prefer sign-in. "Anyone" is simpler and the URL is unguessable, like a password.)
4. Click **Deploy**. Grant permissions if asked.
5. **Copy the Web app URL** — it looks like `https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxx/exec`. You'll need it in Step 5.

> If you later edit `Code.gs`, click **Deploy → Manage deployments → ✏️ (pencil) → New version → Deploy**. The URL stays the same.

### Step 4. (Optional) Add a shared write secret

If you deployed as "Anyone", the URL is effectively a public endpoint — anyone with it can read and write. For a lightweight guard:

1. In `Code.gs`, set `const SHARED_SECRET = 'pick-a-long-random-string-here';` and redeploy.
2. In `assets/config.js`, set `SHARED_SECRET` to the exact same string.
3. Writes now require the matching secret in the payload. Reads stay open — tighten `doGet` similarly if you need read-auth too.

### Step 5. Configure the frontend

Edit `assets/config.js` and paste your Web app URL into `APPS_SCRIPT_URL`. For example:

```js
window.GNG_CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxx/exec",
  SHARED_SECRET: "",
  DEFAULT_OWNER: "Zuzanna",
  OWNERS: ["Zuzanna", "Anrunya", "Kent", "Vivek"],
  STAGES: ["New", "Contacted", "Meeting Scheduled", "Proposal Sent", "Closed - Won", "Closed - Lost"],
  REFRESH_MS: 60000
};
```

### Step 6. Push to GitHub and enable Pages

```bash
cd grab-n-go-crm
git init
git add .
git commit -m "Initial Grab-N-Go CRM"
git branch -M main
git remote add origin https://github.com/YOUR-USER/grab-n-go-crm.git
git push -u origin main
```

Then on GitHub:

1. Repo → **Settings → Pages**
2. **Source**: Deploy from a branch → **main** / **/ (root)**
3. Save. In 30-60 seconds, your CRM will be live at `https://YOUR-USER.github.io/grab-n-go-crm/`.

Open the URL. The header should show "connected · N leads" once it talks to your Sheet.

> **Private repo?** GitHub Pages requires a paid plan for private-repo Pages. If you keep the repo public, your Apps Script URL in `config.js` is visible to anyone who finds the repo — use the shared secret for writes, or deploy the Web App as "Anyone with Google account" to require Google sign-in on every request.

---

## Importing an Apollo CSV

1. In Apollo, export the contacts you want (default columns are fine — the parser handles the standard 71-column export).
2. In the CRM, click **Import Apollo CSV** in the header.
3. Pick a **dedup mode**:
   - **Merge** (recommended): fill missing fields on existing leads, append rows that don't match.
   - **Skip**: leave existing leads untouched, only append genuinely new rows.
   - **Append**: add every CSV row as new (no dedup). Use when you know the CSV is fresh and distinct.
4. Choose the **default owner** for new leads.
5. Pick the file. The parser maps columns automatically — you'll see a dedup preview (how many will add vs. match) and the first 10 rows normalized.
6. Click **Import**. Rows land in the `Leads` tab in your Sheet, sorted by Stage then Company.

### Field mapping (built-in)

| Apollo column                                   | CRM field              |
| ----------------------------------------------- | ---------------------- |
| First Name, Last Name, Title                    | First_Name, Last_Name, Title |
| Email                                           | Email                  |
| Mobile Phone, Work Direct Phone, Corporate Phone | Mobile_Phone, Work_Phone, Phone (priority: Mobile → Work Direct → Corporate → Other → Home) |
| Person Linkedin Url, Company Linkedin Url       | LinkedIn_URL, Company_LinkedIn |
| City, State, Country                            | City, State, Country   |
| Company Name, Industry, # Employees, Annual Revenue, Technologies | Company, Industry, Employees, Annual_Revenue, Technologies |
| Apollo Contact Id, Apollo Account Id            | Apollo_Contact_ID, Apollo_Account_ID |
| Stage                                           | Status (mapped — Cold/New/Uncontacted → New, Meeting → Meeting Scheduled, etc.) |
| Lists, Seniority, Departments, Keywords         | Lists, Seniority, Departments, Tags |
| Contact Owner                                   | Owner                  |

Dedup matches on **Email** first, then **Apollo Contact Id**.

---

## Using the CRM

- **Dashboard** — KPIs (total, in pipeline, closed won, conversion, 7-day imports), pipeline-by-stage bar chart, industry doughnut.
- **Pipeline** — Kanban board. Drag a card between columns to change its stage. Saves to the Sheet immediately.
- **Leads** — sortable, filterable, searchable table. Click a row to open the detail drawer.
- **Lead detail drawer** — full contact + company info, LinkedIn links, tech stack, activity log, add notes.
- **Activity** — timeline of imports, stage changes, notes, and manual edits (across all leads).
- **Settings** — test the backend connection, reload data, export leads to CSV.

---

## Google Sheets schema

Created automatically on first `setup` run.

### `Leads` tab

`Lead_ID`, `First_Name`, `Last_Name`, `Email`, `Title`, `Company`, `Industry`, `Status`, `Phone`, `Mobile_Phone`, `Work_Phone`, `LinkedIn_URL`, `Company_LinkedIn`, `City`, `State`, `Country`, `Employees`, `Annual_Revenue`, `Technologies`, `Apollo_Contact_ID`, `Apollo_Account_ID`, `Lists`, `Seniority`, `Departments`, `Tags`, `Owner`, `Notes`, `Created_At`, `Updated_At`, `Imported_At`

### `Activity_Logs` tab

`Log_ID`, `Lead_ID`, `Action_Type` (create/update/stage_change/note/import/delete), `Note_Content`, `Old_Value`, `New_Value`, `Actor`, `Timestamp`

The sheet re-sorts by Stage → Company on every write. You can also edit cells directly in the sheet — the CRM re-reads on refresh.

---

## Local development

No build step. Open `index.html` through a tiny local server (not `file://`, which blocks fetch to the Apps Script URL):

```bash
cd grab-n-go-crm
python3 -m http.server 8080
# then open http://localhost:8080
```

To change pipeline stages or owners, edit `assets/config.js` and reload. The backend stores whatever string the frontend sends, so you can rename stages freely.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Header shows "not configured" | `APPS_SCRIPT_URL` is empty in `assets/config.js`. Paste your /exec URL and reload. |
| Header shows "connection error" | The URL is wrong, the deployment is paused, or the sheet lost access. Open the URL in a new tab — you should see `{"ok":false,"error":"Unknown action: "}` or similar. If you see a Google sign-in page, the deployment is set to "Only me" — redeploy as "Anyone". |
| CORS error in console | You're using `application/json`. The included `api.js` uses `text/plain` to avoid preflight — make sure you didn't modify that. |
| "Script function not found: doGet" | Code wasn't saved before deployment. In Apps Script, Save (💾), then Deploy → Manage deployments → New version. |
| Import ran but no rows appeared | Check the Apps Script logs: Apps Script editor → View → Executions. The most common cause is a sheet permission issue — rerun `setup`. |
| Stale data on another browser | Reload. The default `REFRESH_MS` is 60s; drop it to 15000 in `config.js` for faster sync. |

---

## Security notes

- The Apps Script URL is a secret-by-obscurity when deployed as "Anyone". If the repo is public, so is the URL. Rotate by: Apps Script → **Deploy → Manage deployments → Archive** the old one, then **New deployment**.
- `SHARED_SECRET` guards **writes** only. Reads are open — if your data is sensitive, deploy as "Anyone with Google account" and also require sign-in on the frontend.
- The Sheet is still private to your Google account unless you share it. The Web App executes under *your* account and reads/writes the sheet on behalf of callers — that's how the public endpoint can touch a private sheet without you sharing it.

---

## Next ideas (not built yet)

- Email templates per stage with mail-merge via Gmail API
- Activity log filter by lead/actor/action type
- Multi-sheet backend (one Sheet per campaign)
- Role-based access (owner-only edits)
- Webhook for Apollo → auto-import on list change

If you want any of these, open an issue or ask in the chat that generated this.
