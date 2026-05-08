# 🚀 Quick Start Guide

## 1. Prerequisites

- **Node.js** >= 18.x ([Download](https://nodejs.org/))
- **npm** or **yarn** package manager
- **Google Cloud account** (for API key)

## 2. Install & Setup (5 minutes)

```bash
# Clone or navigate to the lead directory
cd C:\Users\nagib\Desktop\test\lead

# Install dependencies
npm install

# Run setup to create directories
npx tsx src/setup.ts
# or
npm run setup
```

## 3. Choose Data Source & Get API Key (if needed)

The system supports **4 data sources**. Choose one:

### Option A: Yelp (RECOMMENDED - FREE, no credit card)

**Best for:** US businesses, restaurants, shops, services. 5,000 free searches/day.

1. Go to [Yelp Developers](https://www.yelp.com/developers/v3/manage_app)
2. Click **Create App**
3. Fill in name/description → **Create**
4. Copy the **API Key** (looks like `https://...`)
5. Edit `.env`:
   ```env
   DATA_SOURCE=yelp
   YELP_API_KEY=your_key_here
   ```
**✅ No credit card required. Unlimited free usage up to 5k/day.**

### Option B: Google Places (Best Quality, $300 free trial)

**Best for:** Global coverage, full phone/website/opening hours.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create project → **APIs & Services** → **Library**
3. Enable **Places API** + **Maps JavaScript API**
4. **Credentials** → **Create API Key**
5. Copy to `.env`:
   ```env
   DATA_SOURCE=google
   GOOGLE_PLACES_API_KEY=your_key_here
   ```
**⚠️ Requires credit card for identity verification (you won't be charged until you exhaust $300 free credit).**

### Option C: OpenStreetMap (Always Free)

**Best for:** Global coverage, no key required (but limited data: may lack phone/email).

```env
DATA_SOURCE=openstreetmap
```
**✅ 100% free, unlimited, no registration.**

### Option D: All Sources Combined

```env
DATA_SOURCE=all
GOOGLE_PLACES_API_KEY=your_google_key    # optional
YELP_API_KEY=your_yelp_key                # optional
# OpenStreetMap always included
```
Merges results from all configured sources.

---

## 4. Configure Settings

```bash
# Edit .env file
notepad .env
```

Essential settings (defaults work fine):
```env
# Search limits
MAX_RESULTS_PER_QUERY=100    # Decrease to 30 for testing
CONCURRENT_SEARCHES=5        # Increase for faster searches
REQUEST_DELAY=200           # ms between requests (avoid rate limits)

# Export
DEFAULT_EXPORT_FORMAT=csv   # csv, json, xlsx

# Enrichment
SCRAPE_WEBSITES=true        # Extract emails/social from websites
EXTRACT_EMAILS=true
EXTRACT_SOCIAL=true
```

**For Yelp users:** Use defaults, no extra keys.

**For Google users:** Consider setting `MAX_RESULTS_PER_QUERY=50` to conserve quota initially.

## 5. Run Your First Search

### Option A: Interactive Mode (Recommended for first run)
```bash
npx tsx src/cli.ts --interactive
# or after build:
npm run search -- --interactive
```

You'll be prompted:
- Business type (e.g., "restaurants")
- Location (e.g., "San Francisco, CA")
- Radius (default 5000m)
- Max results (default 100)
- Enable website enrichment? (recommended: yes)

**💡 No credit card?** Use `-s yelp` or `-s openstreetmap`:
```bash
# Use Yelp (free, no credit card)
npx tsx src/cli.ts --interactive -s yelp

# Or OSM (completely free, no key)
npx tsx src/cli.ts --interactive -s openstreetmap
```

### Option B: Command Line

```bash
# Yelp (free, US-focused) - 20 restaurants in NYC
npx tsx src/cli.ts search -s yelp -q "restaurants" -l "New York, NY" -m 20

# Google Places (best data) - 50 lawyers in LA
npx tsx src/cli.ts search -s google -q "lawyers" -l "Los Angeles, CA" -m 50

# OpenStreetMap (no key) - 30 cafes in Chicago
npx tsx src/cli.ts search -s openstreetmap -q "cafes" -l "Chicago, IL" -m 30

# Combined sources (if you have both keys)
npx tsx src/cli.ts search -s all -q "gyms" -l "Miami, FL" -m 50
```

### Option C: Batch Search
Create `my-searches.json`:
```json
[
  {
    "keyword": "yoga studios",
    "location": "Los Angeles, CA",
    "radius": 8000,
    "maxResults": 30
  },
  {
    "keyword": "gyms",
    "location": "Los Angeles, CA",
    "radius": 8000,
    "maxResults": 30
  }
]
```

Run:
```bash
npx tsx src/cli.ts batch --file my-searches.json
```

## 6. View Results

### Check statistics:
```bash
npx tsx src/cli.ts stats
```

Output:
```
📊 Lead Database Statistics
──────────────────────────────────────────────────
Total Leads:      142
Avg Rating:       4.3
With Phone:       98 (69%)
With Website:     132 (93%)
With Email:       45 (32%)
```

### Exported files location:
```
C:\Users\nagib\Desktop\test\lead\exports\
├── leads-2026-04-24.csv
├── leads-2026-04-24.json
└── leads-2026-04-24.xlsx
```

### View in Excel/Sheets:
- Open `.csv` or `.xlsx` in Excel, Google Sheets, or any spreadsheet app
- Columns: Business name, address, phone, website, rating, email, score, etc.

## 7. Start Web Dashboard (Optional)

```bash
# Development
npx tsx src/dashboard/server.ts

# Or with npm
npm run dashboard
```

Visit: http://localhost:3000

Features:
- Real-time stats
- Browse leads table
- Trigger searches from UI
- Quick export buttons
- System health monitor

**Add authentication** in `.env`:
```env
ENABLE_DASHBOARD=true
DASHBOARD_PORT=3000
DASHBOARD_USER=admin
DASHBOARD_PASS=your-secure-password
```

## 8. Common Use Cases

### Find restaurants with high ratings:
```bash
npx tsx src/cli.ts search \
  --query "restaurants" \
  --location "Chicago, IL" \
  --min-score 70
```

### Export only leads with email:
```bash
npx tsx src/cli.ts export --all --filter-score 50 --enriched
```

### Auto-remove old data (weekly):
```bash
# Add to crontab or Windows Task Scheduler
npx tsx src/cli.ts cleanup
```

### Search multiple cities from file:
`cities.json`:
```json
[
  { "keyword": "salons", "location": "Miami, FL", "maxResults": 30 },
  { "keyword": "salons", "location": "Orlando, FL", "maxResults": 30 },
  { "keyword": "salons", "location": "Tampa, FL", "maxResults": 30 }
]
```

Run:
```bash
npx tsx src/cli.ts batch --file cities.json
```

## 9. Cost Management

### Monitor usage:
- Google Cloud Console → **Billing** → **Reports**
- Set budget alerts at $5, $10, $20

### Reduce costs:
```env
# Search fewer places
MAX_RESULTS_PER_QUERY=25  # instead of 100

# Search one city at a time
CONCURRENT_SEARCHES=2
```

### Free tier utilization:
- First $300 is free (90 days)
- 100 searches × 20 results = 2000 API calls ≈ $0.034
- You can do ~17,000 searches before hitting $300

## 10. Troubleshooting

### "Error: Google Places API key is required"
→ Edit `.env`, add your key on line `GOOGLE_PLACES_API_KEY=your-key`

### "Error: OVER_QUERY_LIMIT"
→ You've reached daily quota. Check Google Cloud Console. Enable billing or wait 24h.

### "Error: REQUEST_DENIED"
→ API key invalid or Places API not enabled. Go to Google Cloud Console and ensure both APIs are enabled.

### "Network timeout" or "ECONNABORTED"
→ Increase timeout or reduce concurrent searches.
```env
CONCURRENT_SEARCHES=2
REQUEST_DELAY=500
```

### "SQLITE_BUSY" database locked
→ Close other instances. Only one process can write at a time.

### "Port 3000 already in use"
→ Change dashboard port:
```env
DASHBOARD_PORT=3001
```

### No emails found
→ Not all websites have email addresses publicly visible. Try enabling more aggressive scraping or use a different data source.

## 11. Next Steps

- Review [README.md](README.md) for full feature list
- Set up email notifications for new leads
- Configure webhook to Slack/Discord
- Schedule daily searches with Windows Task Scheduler/cron
- Build custom integrations using the API endpoints
- Train ML model on lead scores for better filtering

## 12. Support

- Issues: https://github.com/your-repo/lead-finder/issues
- Documentation: See README.md
- Google Places API docs: https://developers.google.com/maps/documentation/places/web-service/overview

---

**Happy lead hunting! 🎯**
