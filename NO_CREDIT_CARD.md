# 🆓 No Credit Card? Multi-Source Lead Finder Edition

## ✅ You now have 4 data source options:

| Source | Cost | Credit Card? | Data Quality |
|--------|------|--------------|--------------|
| **Yelp Fusion** | **FREE** 5,000/day | ❌ NO | ★★★★☆ (ratings, phone, reviews) |
| **OpenStreetMap** | **100% FREE** unlimited | ❌ NO | ★★☆☆☆ (name, address, location only) |
| **Google Places** | $300 free credit (90d), then paid | ✅ YES | ★★★★★ (best: phone, website, hours, ratings) |
| **All combined** | Mix | Depends on keys | Merged from configured sources |

## 🎯 Quick Recommendation

**If you have NO credit card:**
```bash
# Option 1: Yelp (recommended - best free data)
echo "DATA_SOURCE=yelp" >> .env
echo "YELP_API_KEY=your_key" >> .env

# Option 2: OpenStreetMap (no key at all)
echo "DATA_SOURCE=openstreetmap" >> .env
```

Both work immediately without any payment.

## 📝 Step-by-Step for Free Users

### Using Yelp (Best free option)

1. **Get free API key** (2 minutes, email only):
   - Visit https://www.yelp.com/developers/v3/manage_app
   - Click "Create App"
   - Fill name/description → "Create"
   - Copy the API Key (starts with `https://`)

2. **Configure**:
   ```bash
   # Edit .env
   DATA_SOURCE=yelp
   YELP_API_KEY=paste_your_key_here
   ```

3. **Search**:
   ```bash
   npm run search -- -s yelp -q "restaurants" -l "New York, NY" -m 50
   ```

4. **Results** → Check `exports/leads-*.csv`

**Quota:** 5,000 calls/day (plenty for small-medium usage). Resets daily at midnight PST.

### Using OpenStreetMap (Completely free, no key)

Just set:
```bash
echo "DATA_SOURCE=openstreetmap" >> .env
# No API key needed!
```

Search:
```bash
npm run search -- -s openstreetmap -q "coffee shops" -l "Seattle, WA" -m 30
```

**Pros:** Unlimited, no signup. **Cons:** No phone/email/ratings typically (data varies by area).

### Using Google Places (if you have $300 free trial)

If you can add a credit card for verification (won't be charged until free credit used), you get comprehensive data.

**Get key**: See README full guide.

## 🔄 Switching Data Sources

Change one line in `.env`:

```env
# For Yelp (free)
DATA_SOURCE=yelp
YELP_API_KEY=...

# For Google
DATA_SOURCE=google
GOOGLE_PLACES_API_KEY=...

# For OSM
DATA_SOURCE=openstreetmap

# To combine results from all configured sources
DATA_SOURCE=all
```

Then re-run searches. The database stores all results together; you can query with any source.

## 🎯 Maximizing Free Usage

**Yelp tips:**
- Use `MAX_RESULTS_PER_QUERY=50` (default 100) to double your daily quota
- Schedule one batch per day
- Use `CONCURRENT_SEARCHES=3` to stay well within limits

**OSM tips:**
- Unlimited, but slower (Overpass API may timeout on huge queries)
- Best for location-based searches: "amenity=restaurant" type queries
- You get coordinates for mapping

**Combined strategy:**
```env
DATA_SOURCE=all
YELP_API_KEY=your_yelp_key
# OSM always active, no key needed
```
This gives you: Yelp's ratings + OSM's global coverage.

## 📊 Data Comparison

| Field | Google | Yelp | OpenStreetMap |
|-------|--------|------|---------------|
| Business Name | ✅ | ✅ | ✅ |
| Address | ✅ | ✅ | ✅ |
| Phone | ✅ (best) | ✅ | ❌ rare |
| Website | ✅ (official) | ❌ (Yelp page only) | ❌ |
| Email | ✅ (via scrape) | ✅ (via scrape) | ❌ |
| Rating | ✅ (Google) | ✅ (Yelp) | ❌ |
| Review Count | ✅ | ✅ | ❌ |
| Opening Hours | ✅ | ✅ | ❌ sometimes |
| Photos | ✅ | ✅ | ❌ |

**Bottom line:** Use Yelp for US businesses with good reviews. Use Google if you can get the free trial. Use OSM for bulk location data.

## 🚀 Example Free Workflow (Yelp + OSM Combined)

`.env`:
```env
DATA_SOURCE=all
YELP_API_KEY=your_free_key
MAX_RESULTS_PER_QUERY=50
SCRAPE_WEBSITES=true
```

`queries.json`:
```json
[
  { "keyword": "yoga studios", "location": "Los Angeles, CA", "maxResults": 50 },
  { "keyword": "yoga studios", "location": "San Francisco, CA", "maxResults": 50 }
]
```

Run:
```bash
npm run batch -- -f queries.json
npm run stats
```

Result: ~200 leads (Yelp + OSM) with contact info scraped from websites where available.

---

**No credit card needed. All features work with free sources. 🎉**
