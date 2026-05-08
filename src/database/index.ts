import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { config } from '../config';
import logger from '../utils/logger';
import { PlaceDetails, PlaceSearchResult } from '../google-places/client';

export interface Lead {
  id?: number;
  place_id: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
  email?: string;
  rating?: number;
  user_ratings_total?: number;
  review_count?: number;
  price_level?: number;
  business_status?: string;
  types: string[];
  opening_hours?: string;
  latitude?: number;
  longitude?: number;
  source_query?: string;
  scraped_data?: Record<string, any>;
  screenshot_path?: string;
  created_at: string;
  updated_at: string;
  score?: number;
}

export interface LeadFilter {
  minRating?: number;
  minReviews?: number;
  hasPhone?: boolean;
  hasWebsite?: boolean;
  hasEmail?: boolean;
  types?: string[];
  keywords?: string[];
}

class Database {
  private db: sqlite3.Database | null = null;

  async initialize(): Promise<void> {
    try {
      this.db = await open({
        filename: config.database_path,
        driver: sqlite3.Database,
      });

      await this.createTables();
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize database: ${error}`);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        place_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        phone TEXT,
        website TEXT,
        email TEXT,
        rating REAL,
        user_ratings_total INTEGER,
        review_count INTEGER DEFAULT 0,
        price_level INTEGER,
        business_status TEXT,
        types TEXT DEFAULT '[]',
        opening_hours TEXT,
        latitude REAL,
        longitude REAL,
        source_query TEXT,
        scraped_data TEXT DEFAULT '{}',
        screenshot_path TEXT,
        score REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_place_id ON leads(place_id);
      CREATE INDEX IF NOT EXISTS idx_name ON leads(name);
      CREATE INDEX IF NOT EXISTS idx_rating ON leads(rating);
      CREATE INDEX IF NOT EXISTS idx_score ON leads(score);
      CREATE INDEX IF NOT EXISTS idx_created_at ON leads(created_at);

      CREATE TABLE IF NOT EXISTS search_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        location TEXT,
        results_count INTEGER DEFAULT 0,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        status TEXT DEFAULT 'running'
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        details TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  /**
   * Insert or update a lead (upsert)
   */
  async upsertLead(lead: Omit<Lead, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    const now = new Date().toISOString();
    const typesJson = JSON.stringify(lead.types);
    const scrapedDataJson = JSON.stringify(lead.scraped_data || {});

    try {
      // Try to insert first
      const result = await this.db.run(
        `
        INSERT OR REPLACE INTO leads (
          place_id, name, address, phone, website, email, rating,
          user_ratings_total, review_count, price_level, business_status,
          types, opening_hours, latitude, longitude, source_query,
          scraped_data, screenshot_path, score, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          lead.place_id,
          lead.name,
          lead.address,
          lead.phone || null,
          lead.website || null,
          lead.email || null,
          lead.rating || null,
          lead.user_ratings_total || null,
          lead.review_count || 0,
          lead.price_level || null,
          lead.business_status || null,
          typesJson,
          lead.opening_hours || null,
          lead.latitude || null,
          lead.longitude || null,
          lead.source_query || null,
          scrapedDataJson,
          lead.screenshot_path || null,
          lead.score || 0,
          now,
        ]
      );

      // Log audit
      await this.logAudit('upsert_lead', 'lead', lead.place_id, { name: lead.name });

      return result.lastID || result.id || 0;
    } catch (error: any) {
      logger.error(`Failed to upsert lead ${lead.place_id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Insert multiple leads (bulk)
   */
  async bulkUpsertLeads(leads: Omit<Lead, 'id' | 'created_at' | 'updated_at'>[]): Promise<number[]> {
    const ids: number[] = [];

    for (const lead of leads) {
      try {
        const id = await this.upsertLead(lead);
        ids.push(id);
      } catch (error) {
        logger.error(`Failed to insert lead ${lead.place_id}: ${error}`);
      }
    }

    return ids;
  }

  /**
   * Check if lead exists
   */
  async leadExists(placeId: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.get(
      'SELECT id FROM leads WHERE place_id = ?',
      [placeId]
    );

    return !!result;
  }

  /**
   * Get a single lead by place_id
   */
  async getLead(placeId: string): Promise<Lead | null> {
    if (!this.db) throw new Error('Database not initialized');

    const row = await this.db.get(
      'SELECT * FROM leads WHERE place_id = ?',
      [placeId]
    );

    return row ? this.mapRowToLead(row) : null;
  }

  /**
   * Get leads with filtering and pagination
   */
  async getLeads(
    filter: LeadFilter = {},
    options: {
      limit?: number;
      offset?: number;
      sortBy?: 'created_at' | 'rating' | 'score';
      sortOrder?: 'ASC' | 'DESC';
    } = {}
  ): Promise<{ leads: Lead[]; total: number }> {
    if (!this.db) throw new Error('Database not initialized');

    let query = 'SELECT * FROM leads WHERE 1=1';
    const params: any[] = [];

    // Apply filters
    if (filter.minRating) {
      query += ' AND rating >= ?';
      params.push(filter.minRating);
    }

    if (filter.minReviews) {
      query += ' AND user_ratings_total >= ?';
      params.push(filter.minReviews);
    }

    if (filter.hasPhone) {
      query += ' AND phone IS NOT NULL AND phone != ""';
    }

    if (filter.hasWebsite) {
      query += ' AND website IS NOT NULL AND website != ""';
    }

    if (filter.hasEmail) {
      query += ' AND email IS NOT NULL AND email != ""';
    }

    if (filter.types && filter.types.length > 0) {
      const typeConditions = filter.types.map(() => 'types LIKE ?').join(' OR ');
      query += ` AND (${typeConditions})`;
      filter.types.forEach(type => params.push(`%"${type}"%`));
    }

    if (filter.keywords && filter.keywords.length > 0) {
      const keywordConditions = filter.keywords.map(() =>
        '(name LIKE ? OR address LIKE ?)'
      ).join(' OR ');
      query += ` AND (${keywordConditions})`;
      filter.keywords.forEach(keyword => {
        params.push(`%${keyword}%`, `%${keyword}%`);
      });
    }

    // Get total count
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countResult = await this.db.get(countQuery, params);
    const total = countResult?.total || 0;

    // Apply sorting
    const sortBy = options.sortBy || 'created_at';
    const sortOrder = options.sortOrder || 'DESC';
    query += ` ORDER BY ${sortBy} ${sortOrder}`;

    // Apply pagination
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = await this.db.all(query, params);
    const leads = rows.map(this.mapRowToLead);

    return { leads, total };
  }

  /**
   * Delete a lead
   */
  async deleteLead(placeId: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    const result = await this.db.run(
      'DELETE FROM leads WHERE place_id = ?',
      [placeId]
    );

    if (result.changes > 0) {
      await this.logAudit('delete_lead', 'lead', placeId, {});
      return true;
    }

    return false;
  }

  /**
   * Delete old leads based on retention policy
   */
  async cleanupOldLeads(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    if (config.data_retention_days <= 0) return 0;

    const result = await this.db.run(
      `DELETE FROM leads WHERE created_at < datetime('now', '-${config.data_retention_days} days')`
    );

    const deleted = result.changes || 0;
    if (deleted > 0) {
      logger.info(`Cleaned up ${deleted} old leads`);
      await this.logAudit('cleanup_leads', 'batch', String(deleted), {});
    }

    return deleted;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<Record<string, any>> {
    if (!this.db) throw new Error('Database not initialized');

    const [
      totalLeads,
      avgRating,
      totalWithPhone,
      totalWithWebsite,
      totalWithEmail,
      recentLeads,
    ] = await Promise.all([
      this.db.get('SELECT COUNT(*) as count FROM leads'),
      this.db.get('SELECT AVG(rating) as avg FROM leads WHERE rating IS NOT NULL'),
      this.db.get('SELECT COUNT(*) as count FROM leads WHERE phone IS NOT NULL AND phone != ""'),
      this.db.get('SELECT COUNT(*) as count FROM leads WHERE website IS NOT NULL AND website != ""'),
      this.db.get('SELECT COUNT(*) as count FROM leads WHERE email IS NOT NULL AND email != ""'),
      this.db.get(`
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM leads
        WHERE created_at >= datetime('now', '-7 days')
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `),
    ]);

    return {
      totalLeads: totalLeads?.count || 0,
      averageRating: avgRating?.avg || null,
      withPhone: totalWithPhone?.count || 0,
      withWebsite: totalWithWebsite?.count || 0,
      withEmail: totalWithEmail?.count || 0,
      weeklyActivity: recentLeads || [],
    };
  }

  /**
   * Log audit event
   */
  private async logAudit(
    action: string,
    entityType: string,
    entityId: string,
    details: Record<string, any>
  ): Promise<void> {
    if (!this.db) return;

    try {
      await this.db.run(
        'INSERT INTO audit_log (action, entity_type, entity_id, details) VALUES (?, ?, ?, ?)',
        [action, entityType, entityId, JSON.stringify(details)]
      );
    } catch (error) {
      logger.error(`Failed to log audit: ${error}`);
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  /**
   * Map database row to Lead object
   */
  private mapRowToLead(row: any): Lead {
    return {
      id: row.id,
      place_id: row.place_id,
      name: row.name,
      address: row.address,
      phone: row.phone,
      website: row.website,
      email: row.email,
      rating: row.rating,
      user_ratings_total: row.user_ratings_total,
      review_count: row.review_count,
      price_level: row.price_level,
      business_status: row.business_status,
      types: JSON.parse(row.types || '[]'),
      opening_hours: row.opening_hours,
      latitude: row.latitude,
      longitude: row.longitude,
      source_query: row.source_query,
      scraped_data: JSON.parse(row.scraped_data || '{}'),
      screenshot_path: row.screenshot_path,
      score: row.score,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

// Singleton instance
const database = new Database();

export default database;
export { Database, Lead, LeadFilter };
