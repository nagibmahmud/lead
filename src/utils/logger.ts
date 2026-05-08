import winston from 'winston';
import { config } from '../config';
import { join } from 'path';
import { mkdirSync } from 'fs';

// Ensure log directory exists
const logDir = join(process.cwd(), 'logs');
try {
  mkdirSync(logDir, { recursive: true });
} catch {
  // Directory may already exist
}

const logger = winston.createLogger({
  level: config.log_level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'lead-finder' },
  transports: [
    new winston.transports.File({
      filename: join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: config.max_log_files,
    }),
    new winston.transports.File({
      filename: join(logDir, 'combined.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: config.max_log_files,
    }),
  ],
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Export logger instance
export default logger;
