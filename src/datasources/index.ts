import { OpenStreetMapSource } from './openstreetmap';
import { YelpSource } from './yelp';
import { GooglePlacesClient, getPlacesClient } from '../google-places/client';
import { IDataSource, SearchParams, BusinessSearchResult, BusinessDetails } from './base';
import { config } from '../config';
import logger from '../utils/logger';

/**
 * Data source registry and factory
 * Supports multiple data sources with normalization
 */
export class DataSourceManager {
  private sources: IDataSource[] = [];
  private initialized = false;
  private sourceOverride?: string;

  /**
   * Initialize data sources
   * @param sourceOverride - Optional data source to use instead of config
   */
  async initialize(sourceOverride?: string): Promise<void> {
    if (this.initialized) return;

    this.sourceOverride = sourceOverride || config.data_source;
    const effectiveSource = sourceOverride || config.data_source;

    logger.info(`Initializing data sources (mode: ${effectiveSource})`);

    switch (effectiveSource) {
      case 'google':
        this.sources = [await this.createGoogleSource()];
        break;
      case 'yelp':
        this.sources = [this.createYelpSource()];
        break;
      case 'openstreetmap':
        this.sources = [new OpenStreetMapSource()];
        break;
      case 'all':
        this.sources = await this.createAllSources();
        break;
      default:
        this.sources = [await this.createGoogleSource()];
    }

    const activeSources = this.sources.map(s => s.getSourceName()).join(', ');
    logger.info(`Active data sources: ${activeSources}`);

    this.initialized = true;
  }

  /**
   * Reset (for testing)
   */
  reset(): void {
    this.initialized = false;
    this.sources = [];
    this.sourceOverride = undefined;
  }

  /**
   * Create Google Places source (with API key validation)
   */
  private async createGoogleSource(): Promise<IDataSource> {
    if (!config.google_places_api_key) {
      throw new Error('Google Places API key not configured. Set GOOGLE_PLACES_API_KEY in .env');
    }
    const client = getPlacesClient();

    // Wrap Google client to match IDataSource interface
    return {
      getSourceName: () => 'Google Places',
      isConfigured: () => !!config.google_places_api_key && config.google_places_api_key.length > 10,
      getQuotaStatus: () => ({
        remaining: Infinity, // Google quota tracking would need separate logic
        limit: 150000, // daily limit
      }),
      search: async (params: SearchParams): Promise<BusinessSearchResult[]> => {
        const results = await client.searchAll({
          query: params.query,
          location: params.location,
          radius: params.radius,
          type: params.category,
          maxResults: params.limit,
        });

        return results.map(r => ({
          id: r.place_id,
          name: r.name,
          address: r.formatted_address || r.vicinity,
          latitude: r.geometry?.location?.lat,
          longitude: r.geometry?.location?.lng,
          rating: r.rating,
          reviewCount: r.user_ratings_total,
          category: r.types?.[0],
          rawData: r,
          source: 'Google Places',
        }));
      },
      getDetails: async (id: string): Promise<BusinessDetails> => {
        const details = await client.getDetails({ place_id: id });
        return {
          id: details.place_id,
          name: details.name,
          address: details.formatted_address,
          latitude: details.geometry?.location?.lat,
          longitude: details.geometry?.location?.lng,
          rating: details.rating,
          reviewCount: details.user_ratings_total,
          phone: details.formatted_phone_number,
          website: details.website,
          category: details.types?.[0],
          formattedAddress: details.formatted_address,
          openingHours: details.opening_hours ? {
            isOpenNow: details.opening_hours.open_now,
            hours: details.opening_hours.weekday_text?.map((day: string) => {
              const [dayName, hours] = day.split(': ');
              const [open, close] = hours.split(' - ');
              return { day: dayName, open, close };
            }) || [],
          } : undefined,
          priceLevel: details.price_level,
          additionalInfo: {
            types: details.types,
            businessStatus: details.business_status,
          },
        };
      },
      normalizeBusiness: (data: BusinessSearchResult, details?: BusinessDetails): BusinessDetails => {
        // Use Google normalization (they already provide normalized data)
        return details || {
          id: data.id,
          name: data.name,
          address: data.address,
          formattedAddress: data.address || '',
          latitude: data.latitude,
          longitude: data.longitude,
          rating: data.rating,
          reviewCount: data.reviewCount,
          phone: data.phone,
          website: data.website,
          category: data.category,
          openingHours: undefined,
          priceLevel: undefined,
          additionalInfo: {},
        };
      },
    };
  }

  /**
   * Create Yelp source
   */
  private createYelpSource(): IDataSource {
    const yelp = new YelpSource(config.yelp_api_key);
    return yelp;
  }

  /**
   * Create all available sources
   */
  private async createAllSources(): Promise<IDataSource[]> {
    const sources: IDataSource[] = [];

    // Always add OpenStreetMap (free, no key needed)
    sources.push(new OpenStreetMapSource());

    // Add Yelp if key present
    if (config.yelp_api_key) {
      sources.push(new YelpSource(config.yelp_api_key));
      logger.info('Yelp source enabled');
    } else {
      logger.warn('Yelp API key not configured - skipping Yelp. Set YELP_API_KEY in .env for free 5k/day searches');
    }

    // Add Google if key present
    if (config.google_places_api_key) {
      sources.push(await this.createGoogleSource());
      logger.info('Google Places source enabled');
    } else {
      logger.warn('Google Places API key not configured - skipping Google');
    }

    if (sources.length === 0) {
      throw new Error('No data sources available. Configure at least one API key (YELP_API_KEY is free, or GOOGLE_PLACES_API_KEY for $300 free trial)');
    }

    return sources;
  }

  /**
   * Get all active sources
   */
  getSources(): IDataSource[] {
    return this.sources;
  }

  /**
   * Search across all sources and merge/deduplicate results
   */
  async searchAll(params: SearchParams): Promise<BusinessSearchResult[]> {
    const allResults: BusinessSearchResult[] = [];

    for (const source of this.sources) {
      if (!source.isConfigured()) {
        logger.warn(`Skipping ${source.getSourceName()} - not configured`);
        continue;
      }

      try {
        logger.info(`Searching with ${source.getSourceName()}...`);
        const results = await source.search(params);
        logger.info(`  Found ${results.length} results from ${source.getSourceName()}`);
        allResults.push(...results);
      } catch (error: any) {
        logger.error(`  ${source.getSourceName()} search failed: ${error.message}`);
        // Continue with other sources
      }
    }

    // Deduplicate by name+address approximation
    const deduped = this.deduplicateResults(allResults);
    logger.info(`Total unique results: ${deduped.length}`);

    return deduped;
  }

  /**
   * Get details for a specific business from appropriate source
   * Tries sources in order until one returns data
   */
  async getDetails(id: string, sourceHint?: string): Promise<BusinessDetails | null> {
    // If we know which source (from search), try that first
    if (sourceHint) {
      const source = this.sources.find(s => s.getSourceName() === sourceHint);
      if (source) {
        try {
          return await source.getDetails(id);
        } catch (error) {
          logger.debug(`${sourceHint} details failed: ${error.message}`);
        }
      }
    }

    // Try all sources
    for (const source of this.sources) {
      try {
        return await source.getDetails(id);
      } catch (error) {
        // Not found in this source, try next
        continue;
      }
    }

    return null;
  }

  /**
   * Normalize a business result to standard format
   */
  normalizeBusiness(result: BusinessSearchResult, details?: BusinessDetails): BusinessDetails {
    // Use source's own normalization if available
    const source = this.sources.find(s => s.getSourceName() === (result.source || ''));
    if (source) {
      return source.normalizeBusiness(result, details);
    }

    // Fallback: basic normalization
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
    };
  }

  /**
   * Deduplicate results (rough matching by name/address)
   */
  private deduplicateResults(results: BusinessSearchResult[]): BusinessSearchResult[] {
    const seen = new Set<string>();

    return results.filter(result => {
      // Create a dedup key from name + normalized address
      const nameNorm = result.name.toLowerCase().trim();
      const addrNorm = (result.address || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const key = `${nameNorm}|||${addrNorm}`;

      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Get quota status for all sources
   */
  getAllQuotas(): Array<{ source: string; quota: ReturnType<IDataSource['getQuotaStatus']> }> {
    return this.sources.map(source => ({
      source: source.getSourceName(),
      quota: source.getQuotaStatus(),
    }));
  }
}

// Singleton
const dataSourceManager = new DataSourceManager();

export default dataSourceManager;

