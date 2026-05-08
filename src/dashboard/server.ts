import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import logger from '../utils/logger';
import { config } from '../config';
import database from '../database';
import leadEngine from '../lead/engine';
import Exporter from '../export';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

/**
 * Health check
 */
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * GET /api/leads - List leads
 */
app.get('/api/leads', async (req: Request, res: Response) => {
  try {
    const { minRating, minReviews, hasPhone, hasWebsite, hasEmail, types, keywords, limit, offset, sortBy, sortOrder } = req.query;

    const filter: any = {};
    if (minRating) filter.minRating = parseFloat(minRating as string);
    if (minReviews) filter.minReviews = parseInt(minReviews as string, 10);
    if (hasPhone === 'true') filter.hasPhone = true;
    if (hasWebsite === 'true') filter.hasWebsite = true;
    if (hasEmail === 'true') filter.hasEmail = true;
    if (types) filter.types = (types as string).split(',');
    if (keywords) filter.keywords = (keywords as string).split(',');

    const options: any = {};
    if (limit) options.limit = parseInt(limit as string, 10);
    if (offset) options.offset = parseInt(offset as string, 10);
    if (sortBy) options.sortBy = sortBy as string;
    if (sortOrder) options.sortOrder = sortOrder as 'ASC' | 'DESC';

    const result = await database.getLeads(filter, options);

    res.json({
      success: true,
      data: result.leads,
      meta: {
        total: result.total,
        page: Math.floor((options.offset || 0) / (options.limit || 10)) + 1,
        pageSize: options.limit || 10,
      },
    });
  } catch (error: any) {
    logger.error(`API GET /api/leads failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/leads/:id - Get single lead
 */
app.get('/api/leads/:id', async (req: Request, res: Response) => {
  try {
    const lead = await database.getLead(req.params.id);

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    res.json({ success: true, data: lead });
  } catch (error: any) {
    logger.error(`API GET /api/leads/:id failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/leads - Bulk upsert leads
 */
app.post('/api/leads', async (req: Request, res: Response) => {
  try {
    const leads = Array.isArray(req.body) ? req.body : [req.body];
    const ids = await database.bulkUpsertLeads(leads as any);

    res.json({
      success: true,
      data: { insertedIds: ids, count: ids.length },
    });
  } catch (error: any) {
    logger.error(`API POST /api/leads failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/leads/:id - Delete lead
 */
app.delete('/api/leads/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await database.deleteLead(req.params.id);

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Lead not found' });
    }

    res.json({ success: true, data: { deleted: true } });
  } catch (error: any) {
    logger.error(`API DELETE /api/leads/:id failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stats - Get statistics
 */
app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const stats = await database.getStats();
    res.json({ success: true, data: stats });
  } catch (error: any) {
    logger.error(`API GET /api/stats failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/search - Trigger search
 */
app.post('/api/search', async (req: Request, res: Response) => {
  try {
    const { queries, maxResults, enrich, minScore } = req.body as {
      queries: any[];
      maxResults?: number;
      enrich?: boolean;
      minScore?: number;
    };

    if (!queries || !Array.isArray(queries) || queries.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Queries array is required',
      });
    }

    // Run search asynchronously
    leadEngine.search({
      queries,
      maxResults,
      enrich,
      minScore,
      continueOnError: true,
    });

    res.json({
      success: true,
      message: 'Search started',
    });
  } catch (error: any) {
    logger.error(`API POST /api/search failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/export - Export leads
 */
app.post('/api/export', async (req: Request, res: Response) => {
  try {
    const { format = 'csv', includeScrapedData = false, filters } = req.body;

    const result = await database.getLeads(filters || {}, {
      limit: 10000,
      sortBy: 'score',
      sortOrder: 'DESC',
    });

    if (result.leads.length === 0) {
      return res.status(404).json({ success: false, error: 'No leads to export' });
    }

    const filepath = await Exporter.exportToFile(result.leads, {
      format,
      includeScrapedData,
    });

      res.json({
        success: true,
        data: {
          filepath,
          count: result.leads.length,
          filename: path.basename(filepath),
        },
      });
  } catch (error: any) {
    logger.error(`API POST /api/export failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Serve static files
 */
app.use(express.static(path.join(__dirname, '../../public')));

/**
 * Dashboard page
 */
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
});

/**
 * Error handling
 */
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

export default app;
