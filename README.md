# 🗺️ Google Maps Lead Finder (Multi-Source)

Advanced lead generation system supporting **Google Places**, **Yelp**, and **OpenStreetMap**. Search businesses, extract contact details, enrich with website data, and export to multiple formats.

**No credit card?** → Use **Yelp** (free API key) or **OpenStreetMap** (no key needed).

![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-%3E%3D18-brightgreen.svg)

## 💰 Quick Money-Making Guide

### Option 1: Sell Lead Lists (Fastest ROI)
- Generate targeted leads and sell CSV/XLSX packages to businesses
- **Target**: Real estate agents, insurance agents, contractors, marketers
- **Pricing**: $50-200 per list (500-2000 leads)
- **Example**: "500 Verified Restaurants in Chicago with Emails"

### **Option 2: Lead Generation Service**
- Provide ongoing lead generation for clients
- **Pricing**: $500-2000/month retainer
- **Upsell**: Email verification, CRM integration, enrichment

### **Option 3: SaaS Licensing**
- White-label and license the software to agencies
- **Pricing**: $99-299/month or $1999 one-time license
- **Benefit**: Passive income as they run their own searches

### **Revenue Potential**
- **Part-time**: $2,000-5,000/month
- **Full-time**: $10,000-20,000/month
- **Scale with team**: $50,000+/month

**👉 See [MONEY.md](./MONEY.md) for detailed strategies!**

## 🎯 Choose Your Data Source

This system supports **4 data sources** to fit any budget:

| Source | Cost | API Key? | Credit Card? | Data Quality |
|--------|------|----------|--------------|--------------|
| **Google Places** | First $300 free, then paid | ✅ Required | ✅ Required (for identity verification) | ★★★★★ Best - phone, website, ratings, hours |
| **Yelp Fusion** | **Completely FREE** (5k/day) | ✅ Free registration | ❌ **NO** | ★★★★☆ Great - ratings, phone, reviews |
| **OpenStreetMap** | **100% FREE** unlimited | ❌ **Not needed** | ❌ **NO** | ★★☆☆☆ Basic - name, address, location |
| **All combined** | Mix | Use available keys | - | Merge results |

**Recommendations:**
- 🆓 **No credit card?** → Use `DATA_SOURCE=yelp` (free API key) or `openstreetmap` (no key)
- 💎 **Best quality?** → Use `DATA_SOURCE=google` ($300 free trial)
- 🔄 **Maximum results?** → Use `DATA_SOURCE=all` (combines all configured sources)

## ✨ Features

### Core Capabilities
- **Multi-query search** - Run multiple searches with different keywords & locations
- **Full data extraction** - Business name, address, phone, website, ratings, reviews, opening hours
- **Website enrichment** - Auto-scrape websites for emails, social links, and about text
- **Lead scoring** - Smart scoring based on rating, reviews, data completeness (0-100)
- **Deduplication** - Automatic duplicate detection & prevention
- **Rate limiting** - Respect API quotas with automatic delays

### Export Options
- CSV, JSON, Excel (.xlsx)
- Google Sheets integration
- Customizable fields

### Storage
- SQLite (default, zero-config)
- PostgreSQL support
- Data retention policies

### Advanced Features
- Proxy rotation for high-volume searches
- Batch processing & concurrent searches
- Command-line interface with interactive mode
- Web dashboard for monitoring (built-in Express server)
- Email notifications (SMTP)
- Webhook integrations (Slack, Discord)
- Audit logging
- GDPR data retention

## 📦 Installation

```bash
cd lead
npm install
```

## ⚙️ Configuration

1. Copy the example env file:
```bash
cp .env.example .env
```

2. **Edit `.env` and choose your data source:**

**Option A: Yelp (FREE, no credit card)**
```env
DATA_SOURCE=yelp
YELP_API_KEY=free_key_here
```
Get free key: https://www.yelp.com/developers/v3/manage_app

**Option B: Google Places (BEST DATA)**
```env
DATA_SOURCE=google
GOOGLE_PLACES_API_KEY=your_api_key_here
```

**Option C: OpenStreetMap (ALWAYS FREE)**
```env
DATA_SOURCE=openstreetmap
# No API key needed!
```

## 🔑 Getting API Keys

### Google Places API (if using Google source)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Navigate to **APIs & Services** → **Library**
4. Enable **Places API** and **Maps JavaScript API**
5. Go to **Credentials** → **Create Credentials** → **API Key**
6. Copy the key to your `.env`

**Cost:** First $300 free credit (90 days). After: ~$0.017 per 1000 searches.

### Yelp Fusion API (if using Yelp source - RECOMMENDED, FREE!)

1. Sign up at [Yelp Developers](https://www.yelp.com/developers/v3/manage_app)
2. Click **Create App** → Fill in details
3. Copy the **API Key** (starts with `https://...`)
4. Paste into `.env`: `YELP_API_KEY=your_key_here`
5. **No credit card required!**

**Quota:** 5,000 calls/day (plenty for most users)

### OpenStreetMap (if using OSM)

No API key needed! Just set `DATA_SOURCE=openstreetmap` and you're ready.

## 🚀 Quick Start

### Search for leads (interactive mode):
```bash
npm run search -- --interactive
```

### Search from command line:
```bash
npm run search -- --query "restaurants" --location "New York, NY" --max 50
```

### Batch search from file:
Create `queries.json`:
```json
[
  { "keyword": "restaurants", "location": "New York, NY", "radius": 5000 },
  { "keyword": "coffee shops", "location": "Brooklyn, NY", "radius": 3000 }
]
```

Run:
```bash
npm run batch -- --file queries.json
```

### View statistics:
```bash
npm run start -- stats
```

### Export all leads to CSV:
```bash
npm run start -- export --all --format csv
```

## 📖 CLI Reference

Global options (available on all commands):
```
-s, --source <type>     Data source: google, yelp, openstreetmap, all (default: google)
```

```
lead-finder search [options]
  --query, -q        Search keyword (required for non-interactive)
  --location, -l     Location (city, address, or "lat,lng")
  --radius, -r       Search radius in meters (default: 5000)
  --max, -m          Max results per query (default: 100, max: 200)
  --no-enrich        Skip website scraping
  --min-score        Minimum lead score (0-100)
  --output, -o       Export format: csv, json, xlsx (default: csv)
  --interactive      Run in interactive mode with prompts
```

Example with source selection:
```bash
# Use Yelp (free, no credit card)
npm run search -- -s yelp -q "restaurants" -l "NYC" -m 20

# Use Google (best quality)
npm run search -- -s google -q "lawyers" -l "Los Angeles" -m 50
```

```
lead-finder batch --file <queries.json>
  Run multiple searches from a JSON file
```
lead-finder search [options]
  --query, -q        Search keyword (required for non-interactive)
  --location, -l     Location (city, address, or "lat,lng")
  --radius, -r       Search radius in meters (default: 5000)
  --max, -m          Max results per query (default: 100, max: 200)
  --type, -t         Business type filter (e.g., "restaurant", "cafe")
  --no-enrich        Skip website scraping
  --min-score        Minimum lead score (0-100)
  --output, -o       Export format: csv, json, xlsx (default: csv)
  --interactive      Run in interactive mode with prompts

lead-finder batch --file <queries.json>
  Run multiple searches from a JSON file

lead-finder export [options]
  --all              Export all leads
  --limit            Max leads to export (default: 1000)
  --filter-score     Minimum score filter
  --enriched         Include scraped data
  --format           Export format (csv, json, xlsx)

lead-finder stats
  Show database statistics

lead-finder cleanup
  Remove old leads based on retention policy
```

## 🌐 Web Dashboard

Start the built-in dashboard:
```bash
npm run dashboard
```

Visit http://localhost:3000 to:
- View real-time statistics
- Browse leads with filtering
- Trigger new searches
- Export data
- Monitor system health

**Authentication** (optional): Set `DASHBOARD_USER` and `DASHBOARD_PASS` in `.env`.

## 📊 Lead Scoring Algorithm

Leads are scored 0-100 based on:

| Factor | Weight | Description |
|--------|--------|-------------|
| Rating | up to 100 | 5★ = 100pts, 4★ = 80pts, 3★ = 60pts |
| Reviews | up to 50 | Logarithmic: 10 reviews ≈ 10pts, 1000 reviews ≈ 50pts |
| Website | +10 | Has official website |
| Email | +15 | Email found on website |
| Phone | +10 | Phone number available |
| Completeness | up to 50 | Data field completion percentage |

**Minimum score filter:** Use `--min-score 50` to only get high-quality leads.

## 🗄️ Database Schema

### leads
- `place_id` - Google Places ID (unique)
- `name` - Business name
- `address` - Full address
- `phone` - Formatted phone
- `website` - Business website
- `email` - Extracted email
- `rating` - Google rating (1-5)
- `user_ratings_total` - Number of reviews
- `price_level` - $, $$, $$$, $$$$
- `types` - Business categories
- `opening_hours` - Hours JSON
- `latitude/longitude` - Coordinates
- `scraped_data` - Additional enrichment data
- `score` - Calculated lead score
- `source_query` - Search query that found this lead
- `created_at`, `updated_at` - Timestamps

### search_sessions
Tracks each search campaign (query, location, results count, status).

### audit_log
Full audit trail for compliance.

## 🔄 Data Enrichment

When `enrich: true` (default), the system:

1. Visits business website
2. Extracts email addresses
3. Finds social media links (Facebook, Twitter, Instagram, LinkedIn, YouTube)
4. Scrapes meta descriptions & about text
5. Respects `robots.txt`
6. Adds delay between requests (configurable)

**Disable enrichment** if you only need basic business info (faster, fewer API costs).

## 📈 Export Formats

### CSV
Human-readable, Excel compatible.

### JSON
Structured data for APIs, databases.

### Excel (.xlsx)
Formatted spreadsheet with multiple sheets possible.

### Google Sheets
Direct export to Google Sheets (requires service account).

## 🛡️ Legal & Compliance

- Uses official Google Places API (fully compliant with Google Terms)
- Respects `robots.txt` for website scraping (configurable)
- Rate limiting to avoid overwhelming servers
- Data retention policies (auto-cleanup)
- Audit logging for GDPR compliance

**Disclaimer:** Always check local laws and website terms before collecting data. Use responsibly.

## 💰 Cost Estimates

Typical search costs (Places API pricing as of 2024):

- **100 searches** × 20 results each = 2,000 API calls
- Cost: 2,000 × $0.017/1000 = **~$0.034**
- **1,000 searches** × 20 results = **~$0.34**
- **10,000 searches** × 20 results = **~$3.40**

**Free tier:** $300 credit for first 90 days.

**Tips:**
- Start small, monitor usage in Google Cloud Console
- Set budget alerts ($10, $50, etc.)
- Cache results to avoid re-searching
- Use `--max` to limit results per query

## 🔧 Advanced Configuration

### Proxy Rotation
```env
ROTATE_PROXIES=true
PROXY_FILE=./config/proxies.txt
```
`proxies.txt` format (one per line):
```
proxy1.example.com:8080
user:pass@proxy2.example.com:3128
```

### Email Notifications
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=app-password
NOTIFICATION_EMAIL=you@company.com
```

### Webhooks (Slack/Discord)
```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### Database Options
**SQLite (default):**
```env
DATABASE_PATH=./data/leads.db
```

**PostgreSQL:**
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/leads
```

## 📁 Project Structure

```
lead/
├── src/
│   ├── config/           # Configuration management
│   ├── google-places/    # Google Places API client
│   ├── lead/             # Lead search engine
│   ├── enrichment/       # Website scraping
│   ├── export/           # CSV/JSON/Excel/Sheets export
│   ├── database/         # SQLite/PostgreSQL operations
│   ├── proxy/            # Proxy rotation
│   ├── scoring/          # Lead scoring algorithm
│   ├── utils/            # Helpers & logger
│   ├── dashboard/        # Express web dashboard
│   ├── cli.ts            # CLI entry point
│   └── index.ts          # Main entry
├── .env.example          # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## 🐛 Troubleshooting

### "Google Places API key is required"
→ Ensure `.env` file exists with `GOOGLE_PLACES_API_KEY` set.

### "OVER_QUERY_LIMIT"
→ You've hit your API quota. Enable billing or wait for quota reset.

### "REQUEST_DENIED"
→ API key invalid or Places API not enabled. Check Google Cloud Console.

### "Network timeout" during scraping
→ Increase timeout or disable enrichment. Some sites block bots.

### Database locked errors
→ Ensure only one instance running. Use proper shutdown.

### Port 3000 already in use
→ Change `DASHBOARD_PORT` in `.env` or stop other service.

## 🤝 Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a PR with tests

## 📄 License

MIT - See LICENSE file for details.

## 🙋 Support

File issues at: https://github.com/your-repo/lead-finder/issues

---

**Built with ❤️ by Kilo AI**
