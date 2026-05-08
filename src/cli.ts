#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import leadEngine, { SearchQuery } from './lead/engine';
import database from './database';
import Exporter from './export';
import logger from './utils/logger';
import { config } from './config';
import dataSourceManager from './datasources';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function ensureDirs() {
  const dirs = ['data', 'exports', 'logs', 'config'];
  for (const dir of dirs) {
    try {
      fs.mkdirSync(resolve(__dirname, '..', dir), { recursive: true });
    } catch {}
  }
}

const program = new Command();

program
  .name('lead-finder')
  .description('Advanced lead search system (Google Places, Yelp, OpenStreetMap)')
  .version('1.0.0')
  .option('-s, --source <type>', 'Data source: google, yelp, openstreetmap, all');

/**
 * Search command
 */
program
  .command('search')
  .description('Search for leads')
  .option('-q, --query <keyword>', 'Search keyword (e.g., "restaurants")')
  .option('-l, --location <place>', 'Location (e.g., "New York, NY")')
  .option('-r, --radius <meters>', 'Search radius in meters', parseInt, 5000)
  .option('-m, --max <number>', 'Maximum results per query', parseInt, 100)
  .option('-t, --type <category>', 'Business type/category filter')
  .option('--no-enrich', 'Skip website enrichment')
  .option('--min-score <number>', 'Minimum lead score (0-100)', parseInt)
  .option('--output <format>', 'Export format (csv, json, xlsx)', 'csv')
  .option('--file <filename>', 'Custom export filename')
  .option('--interactive', 'Run in interactive mode')
  .action(async (options) => {
    ensureDirs();

    if (options.interactive) {
      await runInteractive();
      return;
    }

    if (!options.query) {
      log('Error: --query is required. Use --interactive for guided mode.', 'red');
      process.exit(1);
    }

    const queries: SearchQuery[] = [{
      keyword: options.query,
      location: options.location,
      radius: options.radius,
      type: options.type,
    }];

    const globalOpts = program.opts();
    await runSearch(queries, { ...options, dataSource: globalOpts.source });
  });

/**
 * Batch command
 */
program
  .command('batch')
  .description('Run multiple searches from a JSON file')
  .option('-f, --file <path>', 'Path to queries JSON file')
  .option('-o, --output <dir>', 'Output directory', './exports')
  .action(async (options) => {
    ensureDirs();

    if (!options.file) {
      log('Error: --file is required', 'red');
      process.exit(1);
    }

    const queriesPath = resolve(__dirname, '..', options.file);
    if (!fs.existsSync(queriesPath)) {
      log(`File not found: ${queriesPath}`, 'red');
      process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(queriesPath, 'utf-8'));
    const queries: SearchQuery[] = Array.isArray(data) ? data : [data];

    log(`Loaded ${queries.length} queries from ${options.file}`, 'blue');

    const globalOpts = program.opts();
    await runSearch(queries, { ...options, output: options.output, dataSource: globalOpts.source });
  });

/**
 * Export command
 */
program
  .command('export')
  .description('Export leads to file')
  .option('-f, --format <type>', 'Export format (csv, json, xlsx)')
  .option('-o, --output <file>', 'Output filename')
  .option('--all', 'Export all leads')
  .option('--limit <number>', 'Maximum leads to export', parseInt, 1000)
  .option('--filter-score <min>', 'Minimum score', parseInt)
  .option('--enriched', 'Include scraped data')
  .action(async (options) => {
    ensureDirs();
    const spinner = ora('Loading leads...').start();

    try {
      const filter: any = {};
      if (options.filterScore) {} // handled after

      const result = await database.getLeads(filter, {
        limit: options.limit,
        sortBy: 'score',
        sortOrder: 'DESC',
      });

      spinner.text = `Found ${result.leads.length} leads. Exporting...`;

      if (result.leads.length === 0) {
        spinner.warn('No leads to export');
        return;
      }

      const exportOpts = {
        format: options.format as any,
        filename: options.output,
        includeScrapedData: options.enriched,
      };

      const filepath = await Exporter.exportToFile(result.leads, exportOpts);
      spinner.succeed(`Exported ${result.leads.length} leads to ${filepath}`);

    } catch (error: any) {
      spinner.fail(`Export failed: ${error.message}`);
      logger.error(error);
      process.exit(1);
    }
  });

/**
 * Stats command
 */
program
  .command('stats')
  .description('Show database statistics')
  .action(async () => {
    try {
      const stats = await database.getStats();

      console.log('\n' + colors.bright + '📊 Lead Database Statistics');
      console.log('─'.repeat(50));
      console.log(`Total Leads:      ${colors.bright}${stats.totalLeads}`);
      console.log(`Avg Rating:       ${stats.averageRating?.toFixed(2) || 'N/A'}`);
      console.log(`With Phone:       ${stats.withPhone}`);
      console.log(`With Website:     ${stats.withWebsite}`);
      console.log(`With Email:       ${stats.withEmail}`);

      if (stats.weeklyActivity?.length) {
        console.log('\n' + colors.bright + '📈 Last 7 Days Activity:');
        stats.weeklyActivity.forEach((day: any) => {
          console.log(`  ${day.date}: ${colors.green}${day.count}`);
        });
      }

      console.log('─'.repeat(50) + '\n');

    } catch (error: any) {
      log(`Failed to get stats: ${error.message}`, 'red');
      process.exit(1);
    }
  });

/**
 * Cleanup command
 */
program
  .command('cleanup')
  .description('Remove old leads based on retention policy')
  .option('--dry-run', 'Show what would be deleted without doing it')
  .action(async (options) => {
    const spinner = ora('Checking for old leads...').start();

    try {
      if (options.dryRun) {
        const retention = config.data_retention_days;
        log(`Would remove leads older than ${retention} days (dry-run)`, 'yellow');
      } else {
        const deleted = await database.cleanupOldLeads();
        spinner.succeed(`Removed ${deleted} old leads`);
      }
    } catch (error: any) {
      spinner.fail(`Cleanup failed: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Config check command
 */
program
  .command('config:check')
  .description('Validate configuration')
  .action(async () => {
    try {
      log('✅ Configuration loaded successfully', 'green');
      log(`   Data source: ${config.data_source}`, 'info');

      if (config.data_source === 'google') {
        if (config.google_places_api_key) {
          log('   Google Places API: configured', 'green');
        } else {
          log('   Google Places API: NOT configured', 'red');
        }
      } else if (config.data_source === 'yelp') {
        if (config.yelp_api_key) {
          log('   Yelp API: configured', 'green');
        } else {
          log('   Yelp API: NOT configured (get free key at yelp.com/developers)', 'yellow');
        }
      } else if (config.data_source === 'openstreetmap') {
        log('   OpenStreetMap: always available (no key needed)', 'green');
      }

      // Show quotas
      try {
        await dataSourceManager.initialize();
        const quotas = dataSourceManager.getAllQuotas();
        quotas.forEach((q: any) => {
          const remaining = q.quota.remaining === Infinity ? '∞' : q.quota.remaining;
          const limit = q.quota.limit === Infinity ? '∞' : q.quota.limit;
          log(`   ${q.source}: ${remaining}/${limit} remaining`, 'info');
        });
      } catch {}

    } catch (error: any) {
      log(`❌ Config error: ${error.message}`, 'red');
      process.exit(1);
    }
  });

/**
 * Interactive mode
 */
async function runInteractive() {
  console.log('\n' + colors.bright + '🚀 Lead Finder - Interactive Mode\n');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'query',
      message: 'What type of business are you looking for?',
      default: 'restaurants',
    },
    {
      type: 'input',
      name: 'location',
      message: 'Location (city, state or lat,lng):',
      default: config.default_location,
    },
    {
      type: 'number',
      name: 'radius',
      message: 'Search radius (meters, max 50000):',
      default: config.search_radius,
    },
    {
      type: 'number',
      name: 'maxResults',
      message: 'Maximum results to fetch:',
      default: config.max_results_per_query,
    },
    {
      type: 'confirm',
      name: 'enrich',
      message: 'Scrape websites for emails and social links?',
      default: config.scrape_websites,
    },
    {
      type: 'input',
      name: 'minScore',
      message: 'Minimum lead score (0-100, leave blank for none):',
      validate: (input: string) => {
        if (!input) return true;
        const score = parseFloat(input);
        return score >= 0 && score <= 100 ? true : 'Must be 0-100';
      },
    },
    {
      type: 'list',
      name: 'format',
      message: 'Export format:',
      choices: ['csv', 'json', 'xlsx'],
      default: config.default_export_format,
    },
  ]);

  const queries: SearchQuery[] = [{
    keyword: answers.query,
    location: answers.location,
    radius: answers.radius,
  }];

  const globalOpts = program.opts();
  await runSearch(queries, {
    queries,
    maxResults: answers.maxResults,
    enrich: answers.enrich,
    minScore: answers.minScore ? parseFloat(answers.minScore) : undefined,
    dataSource: globalOpts.source,
  }, answers.format);
}

/**
 * Run search with common logic
 */
async function runSearch(
  queries: SearchQuery[],
  options: any,
  exportFormat?: string
) {
  try {
    const leads = await leadEngine.search(queries, {
      maxResults: options.max,
      enrich: options.enrich !== false,
      minScore: options.minScore,
      continueOnError: true,
      dataSource: options.dataSource,
    });

    if (leads.length > 0) {
      const exportOpts = {
        format: exportFormat || options.output || config.default_export_format,
        filename: options.file,
        includeScrapedData: options.enriched !== false,
      };

      const filepath = await Exporter.exportToFile(leads, exportOpts);

      log('\n✅ Search complete!', 'green');
      log(`   Leads found: ${colors.bright}${leads.length}`, 'info');
      log(`   Export file: ${colors.bright}${filepath}`, 'info');
      if (leads.length > 0) {
        const avgScore = leads.reduce((a, b) => a + (b.score || 0), 0) / leads.length;
        log(`   Avg score:  ${avgScore.toFixed(1)}`, 'info');
      }
    } else {
      log('⚠️  No leads found matching your criteria', 'yellow');
    }

  } catch (error: any) {
    log(`\n❌ Error: ${error.message}`, 'red');
    logger.error(error);
    process.exit(1);
  }
}

program.parse();
