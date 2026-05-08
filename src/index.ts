#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure required directories exist
const requiredDirs = ['data', 'exports', 'logs', 'config'];
for (const dir of requiredDirs) {
  try {
    mkdirSync(join(__dirname, '..', dir), { recursive: true });
  } catch (err) {
    // Directory may already exist, ignore
  }
}

// Start CLI
import('./cli.js');
