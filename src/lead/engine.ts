import { config } from '../config';
import dataSourceManager from '../datasources';
import database, { Lead } from '../database';
import scraper, { EnrichedLead } from '../enrichment/scraper';
import { LeadScorer } from '../scoring';
import logger from '../utils/logger';
import { sleep, chunkArray } from '../utils/helpers';
import type { SearchParams, BusinessSearchResult, BusinessDetails } from '../datasources/base';

export interface LeadEngineOptions {
  maxResults?: number;
  enrich?: boolean;
  minScore?: number;
  keywords?: string[];
  continueOnError?: boolean;
  onProgress?: (stats: SearchStats) => void;
  dataSource?: 'google' | 'yelp' | 'openstreetmap' | 'all'; // Override config
}

export interface SearchStats {
  totalSearched: number;
  totalFound: number;
  totalEnriched: number;
  totalSaved: number;
  errors: number;
  sourceStats: Record<string, number>; // per-source results
}

export class LeadEngine {
  private stats: SearchStats = {
    totalSearched: 0,
    totalFound: 0,
    totalEnriched: 0,
    totalSaved: 0,
    errors: 0,
    sourceStats: {},
  };

  /**
   * Execute a lead search campaign
   */
  async search(queries: Array<{ keyword: string; location?: string; radius?: number }>, options: LeadEngineOptions = {}): Promise<Lead[]> {
    const effectiveSource = options.dataSource || config.data_source;
    logger.info(`Starting lead search with ${queries.length} queries using ${effectiveSource} data source`);

    try {
      await dataSourceManager.initialize(options.dataSource);
      await database.initialize();

      for (const query of queries) {
        logger.info(`Processing query: "${query.keyword}" in ${query.location || 'default location'}`);

        try {
          await this.processQuery(query, options);
        } catch (error: any) {
          this.stats.errors++;
          logger.error(`Query failed for "${query.keyword}": ${error.message}`);

          if (!options.continueOnError) {
            throw error;
          }
        }

        options.onProgress?.(this.stats);
      }

      logger.info(`Search completed: ${this.stats.totalFound} found, ${this.stats.totalSaved} saved`);

      // Get results from database
      const filter: any = {};
      if (options.keywords) {
        filter.keywords = options.keywords;
      }

      const result = await database.getLeads(filter, {
        limit: options.maxResults,
        sortBy: 'score',
        sortOrder: 'DESC',
      });

      // Apply score filter
      let leads = result.leads;
      if (options.minScore) {
        leads = leads.filter(l => (l.score || 0) >= options.minScore);
      }

      return leads;

    } catch (error: any) {
      logger.error(`Search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process a single search query across all data sources
   */
  private async processQuery(query: { keyword: string; location?: string; radius?: number; type?: string }, options: LeadEngineOptions): Promise<void> {
    const searchParams: SearchParams = {
      query: query.keyword,
      location: query.location || config.default_location,
      radius: query.radius || config.search_radius,
      limit: options.maxResults || config.max_results_per_query,
      category: query.type,
    };

    // Search all sources
    const allResults = await dataSourceManager.searchAll(searchParams);
    logger.info(`Found ${allResults.length} businesses across all sources`);
    this.stats.totalSearched++;
    this.stats.totalFound += allResults.length;

    if (allResults.length === 0) {
      return;
    }

    // Fetch details for each business
    const detailsList = await this.fetchDetails(allResults);

    // Filter by minimum score
    let filteredPlaces = detailsList;
    if (options.minScore) {
      filteredPlaces = detailsList.filter(place => {
        const score = LeadScorer.fromPlaceDetails(place);
        return score >= options.minScore!;
      });
      logger.info(`Filtered to ${filteredPlaces.length} places meeting score >= ${options.minScore}`);
    }

    // Enrich with website data
    let enrichedLeads: EnrichedLead[] = [];
    if (options.enrich !== false && config.scrape_websites) {
      enrichedLeads = await this.enrichLeads(filteredPlaces);
      this.stats.totalEnriched += enrichedLeads.length;
    } else {
      enrichedLeads = filteredPlaces.map(place => ({
        placeId: place.place_id,
        emails: [],
        phones: [],
        socialLinks: {},
        success: false,
      }));
    }

    // Convert to Lead objects and save
    const leads = this.convertToLeads(enrichedLeads, filteredPlaces, query.keyword);
    await this.saveLeads(leads);
    this.stats.totalSaved += leads.length;

    logger.info(`Saved ${leads.length} leads from query "${query.keyword}"`);
  }

  /**
   * Fetch details for each business (with rate limiting)
   */
  private async fetchDetails(searchResults: BusinessSearchResult[]): Promise<BusinessDetails[]> {
    const detailsList: BusinessDetails[] = [];

    logger.info(`Fetching details for ${searchResults.length} businesses...`);

    // Concurrent batches
    const batchSize = config.concurrent_searches;
    const batches = chunkArray(searchResults, batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.debug(`Processing batch ${i + 1}/${batches.length} (${batch.length} items)`);

      // Track source for each result
      const sourceMap = batch.map(b => b.source || 'unknown');

      const batchPromises = batch.map(async (result, idx) => {
        try {
          const source = sourceMap[idx];
          const details = await dataSourceManager.getDetails(result.id, source);
          if (details) {
            return details;
          }
          // Fallback: create from search result
          return {
            id: result.id,
            name: result.name,
            address: result.address,
            formattedAddress: result.address || '',
            latitude: result.latitude,
            longitude: result.longitude,
            rating: result.rating,
            reviewCount: result.reviewCount,
            phone: result.phone,
            website: result.website,
            category: result.category,
            openingHours: undefined,
            priceLevel: undefined,
            additionalInfo: result.rawData || {},
          } as BusinessDetails;
        } catch (error) {
          logger.error(`Failed to get details for ${result.name}: ${error.message}`);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      detailsList.push(...batchResults.filter(Boolean) as BusinessDetails[]);

      // Delay between batches
      if (i < batches.length - 1) {
        await sleep(config.request_delay * batch.length);
      }
    }

    return detailsList;
  }

  /**
   * Enrich leads by scraping websites
   */
  private async enrichLeads(places: BusinessDetails[]): Promise<EnrichedLead[]> {
    const enriched: EnrichedLead[] = [];

    logger.info(`Enriching ${places.length} leads with website data...`);

    for (const place of places) {
      const website = place.website;

      let scrapeResult: EnrichedLead = {
        placeId: place.id,
        emails: [],
        phones: [],
        socialLinks: {},
        success: false,
      };

      if (website) {
        // For Yelp, try to extract actual website from page
        if (website.includes('yelp.com') && config.data_source === 'yelp') {
          try {
            const actualSite = await (dataSourceManager.getSources()[0] as any).extractWebsiteFromYelp?.(place.id);
            if (actualSite) {
              website = actualSite;
            }
          } catch {
            // Ignore
          }
        }

        if (await scraper.canScrape(website)) {
          scrapeResult = await scraper.scrapeWebsite(website);
          scrapeResult.placeId = place.id;
        }
      }

      enriched.push(scrapeResult);
      await sleep(500); // Be respectful
    }

    return enriched;
  }

  /**
   * Convert enriched leads to database Lead objects
   */
  private convertToLeads(
    enrichedLeads: EnrichedLead[],
    places: BusinessDetails[],
    sourceQuery: string
  ): Omit<Lead, 'id' | 'created_at' | 'updated_at'>[] {
    return enrichedLeads.map((enriched, index) => {
      const place = places.find(p => p.id === enriched.placeId);
      if (!place) {
        logger.warn(`No details found for ${enriched.placeId}, skipping`);
        return null;
      }

      const score = LeadScorer.fromPlaceDetails(place as any);

      return {
        place_id: enriched.placeId,
        name: place.name,
        address: place.formattedAddress || place.address || '',
        phone: place.phone,
        website: place.website,
        email: enriched.emails[0] || undefined,
        rating: place.rating,
        user_ratings_total: place.reviewCount,
        review_count: 0,
        price_level: this.normalizePriceLevel(place.priceLevel),
        business_status: place.additionalInfo?.businessStatus || 'OPERATIONAL',
        types: place.category ? [place.category] : [],
        opening_hours: place.openingHours ? JSON.stringify(place.openingHours) : undefined,
        latitude: place.latitude,
        longitude: place.longitude,
        source_query: sourceQuery,
        scraped_data: {
          emails: enriched.emails,
          phones: enriched.phones,
          socialLinks: enriched.socialLinks,
          aboutText: enriched.aboutText,
        },
        score,
      };
    }).filter(Boolean) as Omit<Lead, 'id' | 'created_at' | 'updated_at'>[];
  }

  /**
   * Normalize price level to number (1-4)
   */
  private normalizePriceLevel(price?: string | number): number | undefined {
    if (typeof price === 'number') return price;
    if (typeof price === 'string') {
      return price.length; // "$" = 1, "$$" = 2, etc.
    }
    return undefined;
  }

  /**
   * Save leads to database with deduplication
   */
  private async saveLeads(leads: Omit<Lead, 'id' | 'created_at' | 'updated_at'>[]): Promise<void> {
    logger.info(`Saving ${leads.length} leads to database...`);

    const toSave: Omit<Lead, 'id' | 'created_at' | 'updated_at'>[] = [];
    const duplicates: string[] = [];

    for (const lead of leads) {
      const exists = await database.leadExists(lead.place_id);
      if (!exists) {
        toSave.push(lead);
      } else {
        duplicates.push(lead.name);
      }
    }

    if (duplicates.length > 0) {
      logger.info(`Skipped ${duplicates.length} duplicate leads`);
    }

    if (toSave.length > 0) {
      await database.bulkUpsertLeads(toSave);
      logger.debug(`Inserted ${toSave.length} new leads`);
    }
  }

  /**
   * Get current statistics
   */
  getStats(): SearchStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalSearched: 0,
      totalFound: 0,
      totalEnriched: 0,
      totalSaved: 0,
      errors: 0,
      sourceStats: {},
    };
  }
}

// Singleton
const leadEngine = new LeadEngine();

export default leadEngine;

