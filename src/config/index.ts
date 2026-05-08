import { z } from 'zod';
import dotenv from 'dotenv';
import fs from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';

dotenv.config();

const configSchema = z.object({
  // ==========================================
  // DATA SOURCE CONFIGURATION
  // ==========================================
  data_source: z.enum(['google', 'yelp', 'openstreetmap', 'all']).default('google'),

  // Google Places API (best quality, paid after $300 free)
  google_places_api_key: z.string().optional(),
  google_service_account_key: z.string().optional(),
  google_sheet_id: z.string().optional(),

  // Yelp Fusion API (free 5,000/day, requires free API key - no credit card)
  yelp_api_key: z.string().optional(),

  // OpenStreetMap/Overpass (completely free, no key needed)
  overpass_url: z.string().default('https://overpass-api.de/api/interpreter'),

  // Search settings
  max_results_per_query: z.number().min(1).max(200).default(100),
  request_delay: z.number().min(0).default(200),
  concurrent_searches: z.number().min(1).max(20).default(5),
  max_retries: z.number().min(0).max(10).default(3),
  default_location: z.string().default('New York, NY'),
  search_radius: z.number().min(1).max(50000).default(5000),
  search_mode: z.enum(['text', 'nearby']).default('text'),

  // Proxy
  http_proxy: z.string().optional(),
  https_proxy: z.string().optional(),
  proxy_file: z.string().optional(),
  rotate_proxies: z.boolean().default(false),

  // Database
  database_path: z.string().default('./data/leads.db'),
  database_url: z.string().optional(),
  dedup_enabled: z.boolean().default(true),
  dedup_fields: z.string().default('name,address'),

  // Export
  default_export_format: z.enum(['csv', 'json', 'xlsx', 'sheets']).default('csv'),
  export_path: z.string().default('./exports'),
  scrape_websites: z.boolean().default(true),
  extract_emails: z.boolean().default(true),
  extract_social: z.boolean().default(true),
  screenshot_websites: z.boolean().default(false),
  include_photos: z.boolean().default(false),
  photo_max_width: z.number().min(1).max(1600).default(800),

  // Lead scoring
  min_rating: z.number().min(1).max(5).default(3.0),
  min_reviews: z.number().min(0).default(10),
  score_website: z.number().default(10),
  score_email: z.number().default(15),
  score_phone: z.number().default(10),

  // Dashboard
  enable_dashboard: z.boolean().default(false),
  dashboard_port: z.number().min(1).max(65535).default(3000),
  dashboard_user: z.string().optional(),
  dashboard_pass: z.string().optional(),
  dashboard_ssl: z.boolean().default(false),
  ssl_key_path: z.string().optional(),
  ssl_cert_path: z.string().optional(),

  // Notifications
  smtp_host: z.string().optional(),
  smtp_port: z.string().optional(),
  smtp_user: z.string().optional(),
  smtp_pass: z.string().optional(),
  notification_email: z.string().email().optional(),
  webhook_url: z.string().url().optional(),
  slack_webhook_url: z.string().url().optional(),
  discord_webhook_url: z.string().url().optional(),

  // Logging
  log_level: z.enum(['error', 'warn', 'info', 'verbose', 'debug']).default('info'),
  log_file: z.string().default('./logs/lead-finder.log'),
  max_log_files: z.number().default(7),
  log_rotation: z.enum(['daily', 'weekly', 'monthly']).default('daily'),

  // Legal
  respect_robotstxt: z.boolean().default(true),
  user_agent: z.string().default('LeadFinderBot/1.0'),
  auto_gdpr_removal: z.boolean().default(false),
  data_retention_days: z.number().default(365),

   // Google Places API
   google_places_base: z.string().default('https://maps.googleapis.com/maps/api/place'),

   // Multi-source: ensure at least one is configured
   // Use custom refinement after parsing
 });

// Custom validation: at least one API key must be present for non-OSS sources
const configWithValidation = configSchema.refine(
  (data) => {
    if (data.data_source === 'google') return !!data.google_places_api_key;
    if (data.data_source === 'yelp') return !!data.yelp_api_key;
    if (data.data_source === 'openstreetmap') return true; // Always available
    if (data.data_source === 'all') {
      // For 'all', require at least Google or Yelp (OSM always works)
      return !!data.google_places_api_key || !!data.yelp_api_key;
    }
    return true;
  },
  {
    message: 'At least one API key must be configured for the selected data source. For Google: google_places_api_key, for Yelp: yelp_api_key',
    path: ['data_source'],
  }
);

type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  // Try to load .env file if it exists
  try {
    const envPath = join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  } catch {
    // Ignore if .env doesn't exist
  }

  // Load service account key if provided
  const serviceAccountKeyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKeyPath) {
    try {
      const keyData = readFileSync(serviceAccountKeyPath, 'utf-8');
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_DATA = keyData;
    } catch (error) {
      console.warn(`Warning: Could not read service account key: ${error}`);
    }
  }

  // Parse env vars with type coercion
  const rawEnv: Record<string, string | undefined> = { ...process.env };

  const parsed = {
    // Add data_source type coercion
    data_source: rawEnv.DATA_SOURCE || 'google',
    // Google/Yelp not required anymore (source selects)
    max_results_per_query: parseInt(rawEnv.MAX_RESULTS_PER_QUERY || '100', 10),
    request_delay: parseInt(rawEnv.REQUEST_DELAY || '200', 10),
    concurrent_searches: parseInt(rawEnv.CONCURRENT_SEARCHES || '5', 10),
    max_retries: parseInt(rawEnv.MAX_RETRIES || '3', 10),
    search_radius: parseInt(rawEnv.SEARCH_RADIUS || '5000', 10),
    photo_max_width: parseInt(rawEnv.PHOTO_MAX_WIDTH || '800', 10),
    dashboard_port: parseInt(rawEnv.DASHBOARD_PORT || '3000', 10),
    max_log_files: parseInt(rawEnv.MAX_LOG_FILES || '7', 10),
    data_retention_days: parseInt(rawEnv.DATA_RETENTION_DAYS || '365', 10),
    min_rating: parseFloat(rawEnv.MIN_RATING || '3.0'),
    min_reviews: parseInt(rawEnv.MIN_REVIEWS || '10', 10),
    score_website: parseInt(rawEnv.SCORE_WEBSITE || '10', 10),
    score_email: parseInt(rawEnv.SCORE_EMAIL || '15', 10),
    score_phone: parseInt(rawEnv.SCORE_PHONE || '10', 10),
  };

  // Merge with raw env vars (strings only)
  const envConfig: Record<string, string | number | boolean> = {
    ...rawEnv,
    ...parsed,
  };

  // Convert boolean strings
  const booleanFields = [
    'rotate_proxies', 'dedup_enabled', 'scrape_websites', 'extract_emails',
    'extract_social', 'screenshot_websites', 'include_photos', 'enable_dashboard',
    'dashboard_ssl', 'respect_robotstxt', 'auto_gdpr_removal',
  ];

  booleanFields.forEach(field => {
    if (envConfig[field] !== undefined) {
      envConfig[field] = String(envConfig[field]).toLowerCase() === 'true';
    }
  });

  // Validate with zod
  const result = configWithValidation.parse(envConfig);
  return result;
}

const config = loadConfig();

export default config;
export { config, configSchema };
export type { Config };
