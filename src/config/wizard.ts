#!/usr/bin/env node
/**
 * Configuration wizard for Google Maps Lead Finder
 * Guides users through setting up API keys and preferences
 */

import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, '..', '.env');

console.log('\n' + '='.repeat(60));
console.log('  Google Maps Lead Finder - Configuration Wizard');
console.log('='.repeat(60) + '\n');

async function run() {
  // Check if .env already exists
  let existingEnv: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length) {
        existingEnv[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
      }
    });
    console.log('⚠️  .env file already exists. You can update settings or exit.\n');
  }

  const questions = [
    {
      type: 'input',
      name: 'GOOGLE_PLACES_API_KEY',
      message: 'Google Places API Key:',
      default: existingEnv.GOOGLE_PLACES_API_KEY || '',
      validate: (input: string) => {
        if (!input) return 'API key is required';
        if (input.length < 10) return 'Invalid API key format';
        return true;
      },
    },
    {
      type: 'number',
      name: 'MAX_RESULTS_PER_QUERY',
      message: 'Maximum results per search (1-200):',
      default: parseInt(existingEnv.MAX_RESULTS_PER_QUERY || '100', 10),
    },
    {
      type: 'number',
      name: 'CONCURRENT_SEARCHES',
      message: 'Concurrent searches (1-10):',
      default: parseInt(existingEnv.CONCURRENT_SEARCHES || '5', 10),
    },
    {
      type: 'confirm',
      name: 'SCRAPE_WEBSITES',
      message: 'Scrape websites for emails and social links?',
      default: existingEnv.SCRAPE_WEBSITES !== 'false',
    },
    {
      type: 'confirm',
      name: 'ENABLE_DASHBOARD',
      message: 'Enable web dashboard?',
      default: existingEnv.ENABLE_DASHBOARD === 'true',
    },
    {
      type: 'number',
      name: 'DASHBOARD_PORT',
      message: 'Dashboard port:',
      default: parseInt(existingEnv.DASHBOARD_PORT || '3000', 10),
      when: (answers: any) => answers.ENABLE_DASHBOARD,
    },
    {
      type: 'list',
      name: 'DEFAULT_EXPORT_FORMAT',
      message: 'Default export format:',
      choices: ['csv', 'json', 'xlsx'],
      default: existingEnv.DEFAULT_EXPORT_FORMAT || 'csv',
    },
    {
      type: 'confirm',
      name: 'save',
      message: 'Save configuration?',
      default: true,
    },
  ];

  const answers = await inquirer.prompt(questions);

  if (!answers.save) {
    console.log('\nConfiguration not saved.\n');
    process.exit(0);
  }

  // Generate .env content
  const envLines = [
    '# Google Places API Credentials',
    `GOOGLE_PLACES_API_KEY=${answers.GOOGLE_PLACES_API_KEY}`,
    '',
    '# Search Settings',
    `MAX_RESULTS_PER_QUERY=${answers.MAX_RESULTS_PER_QUERY}`,
    `CONCURRENT_SEARCHES=${answers.CONCURRENT_SEARCHES}`,
    `REQUEST_DELAY=200`,
    `DEFAULT_LOCATION=New York, NY`,
    `SEARCH_RADIUS=5000`,
    '',
    '# Database',
    `DATABASE_PATH=./data/leads.db`,
    `DEDUP_ENABLED=true`,
    '',
    '# Export',
    `DEFAULT_EXPORT_FORMAT=${answers.DEFAULT_EXPORT_FORMAT}`,
    `EXPORT_PATH=./exports`,
    `SCRAPE_WEBSITES=${answers.SCRAPE_WEBSITES}`,
    `EXTRACT_EMAILS=${answers.SCRAPE_WEBSITES}`,
    `EXTRACT_SOCIAL=${answers.SCRAPE_WEBSITES}`,
    '',
    '# Lead Scoring',
    `MIN_RATING=3.0`,
    `MIN_REVIEWS=10`,
    `SCORE_WEBSITE=10`,
    `SCORE_EMAIL=15`,
    `SCORE_PHONE=10`,
    '',
    '# Web Dashboard',
    `ENABLE_DASHBOARD=${answers.ENABLE_DASHBOARD}`,
    `DASHBOARD_PORT=${answers.DASHBOARD_PORT || 3000}`,
    `DASHBOARD_USER=`,
    `DASHBOARD_PASS=`,
    '',
    '# Logging',
    `LOG_LEVEL=info`,
    `LOG_FILE=./logs/lead-finder.log`,
    '',
    '# Legal',
    `RESPECT_ROBOTSTXT=true`,
    `DATA_RETENTION_DAYS=365`,
    '',
  ];

  fs.writeFileSync(envPath, envLines.join('\n'));
  console.log('\n✅ Configuration saved to .env\n');

  // Show next steps
  console.log('📋 Next steps:');
  console.log('1. Verify your API key is correct');
  console.log('2. Test with a small search:');
  console.log('   npm run search -- --query "test" --location "New York, NY" --max 5');
  if (answers.ENABLE_DASHBOARD) {
    console.log('3. Start dashboard: npm run dashboard');
  }
  console.log('\n💡 Need help? Check QUICKSTART.md\n');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
