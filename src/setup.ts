#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Lead Finder - Setup\n');

// Create required directories
const dirs = ['data', 'exports', 'logs', 'config'];
for (const dir of dirs) {
  const dirPath = path.join(__dirname, '..', dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✅ Created ${dir}/ directory`);
  }
}

// Check/create .env
const envPath = path.join(__dirname, '..', '.env');
const examplePath = path.join(__dirname, '..', '.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log('✅ Created .env from .env.example');
    console.log(`   Edit ${envPath} and set your DATA_SOURCE and API keys\n`);
  } else {
    console.log('⚠️  .env.example not found. Please create .env manually.\n');
  }
} else {
  console.log('✅ .env file already exists\n');
}

console.log('📋 Next Steps:');
console.log('1. Open .env and choose your data source:');
console.log('   - DATA_SOURCE=yelp  (free, no credit card)');
console.log('   - DATA_SOURCE=google  ($300 free trial, requires credit card)');
console.log('   - DATA_SOURCE=openstreetmap  (no key needed, basic data)');
console.log('');
console.log('2. If using Yelp: Get free API key at https://www.yelp.com/developers/v3/manage_app');
console.log('   If using Google: Get API key at https://console.cloud.google.com/apis/credentials');
console.log('');
console.log('3. Test with a small search:');
console.log('   npm run search -- -s yelp -q "restaurants" -l "New York, NY" -m 10');
console.log('');
console.log('4. View results: ls exports/');
console.log('\n💡 Run `npm run config:check` to verify configuration\n');
