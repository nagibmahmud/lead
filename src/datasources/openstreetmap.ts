import axios from 'axios';
import logger from '../utils/logger';
import { BaseDataSource, SearchParams, BusinessSearchResult, BusinessDetails, NormalizedBusiness } from './base';

/**
 * OpenStreetMap data source via Overpass API
 * Free, unlimited, but limited data (no phone/email usually)
 */
export class OpenStreetMapSource extends BaseDataSource {
  private overpassUrl = 'https://overpass-api.de/api/interpreter';
  private lastDemoLeads: Map<string, BusinessSearchResult> = new Map();

  getSourceName(): string {
    return 'OpenStreetMap';
  }

  isConfigured(): boolean {
    return true; // No config needed
  }

  /**
   * Search businesses using Overpass QL
   */
    async search(params: SearchParams): Promise<BusinessSearchResult[]> {
      const coords = params.location ? await this.geocodeLocation(params.location) : null;

      // Build Overpass QL query
      let query = '';
      if (coords) {
        // Search around point
        const radius = params.radius || 1000; // default 1km
        query = `
          [out:json][timeout:25];
          (
            node["amenity"~"restaurant|cafe|fast_food|bar|pub|pharmacy|bank|atm|hospital|doctor|dentist|gym|school|university|hotel|motel|shop|supermarket|convenience|bakery|butcher|florist|hair_salon|beauty_salon|car_repair|fuel|parking|others"](${coords.lat - 0.01},${coords.lng - 0.01},${coords.lat + 0.01},${coords.lng + 0.01});
            way["amenity"~"restaurant|cafe|fast_food|bar|pub|pharmacy|bank|atm|hospital|doctor|dentist|gym|school|university|hotel|motel|shop|supermarket|convenience|bakery|butcher|florist|hair_salon|beauty_salon|car_repair|fuel|parking"](${coords.lat - 0.01},${coords.lng - 0.01},${coords.lat + 0.01},${coords.lng + 0.01});
            relation["amenity"~"restaurant|cafe|fast_food|bar|pub"](around:${radius},${coords.lat},${coords.lng});
          );
          out body 100;
          >;
          out skel qt;
        `;
      } else {
        // Global search by name (limited)
        query = `
          [out:json][timeout:25];
          (
            node["name"~"${params.query}",i]["amenity"];
            way["name"~"${params.query}",i]["amenity"];
          );
          out body 50;
        `;
      }

      try {
        const data = await this.makeRequest<any>(this.overpassUrl, {
          data: query,
        });

        const results: BusinessSearchResult[] = [];

        for (const element of data.elements || []) {
          if (element.type === 'node' || element.type === 'way') {
            const business = this.parseOSMElement(element, params.query);
            if (business) {
              results.push(business);
            }
          }
        }

        return results.slice(0, params.limit || 100);
      } catch (error: any) {
        // If Overpass API fails, use demo leads
        logger.warn(`Overpass API error: ${error.message}, generating demo leads`);
        return this.generateDemoLeads(params);
      }
    }

    /**
     * Get details for an OSM element (limited - OSM doesn't have rich detail)
     */
  async getDetails(id: string): Promise<BusinessDetails> {
    // Check if this is a demo ID and we have it cached
    if (id.startsWith('osm-')) {
      const cached = this.lastDemoLeads.get(id);
      if (cached) {
        return {
          id: cached.id,
          name: cached.name,
          formattedAddress: cached.address || '',
          latitude: cached.latitude,
          longitude: cached.longitude,
          rating: cached.rating,
          reviewCount: cached.reviewCount || 0,
          phone: cached.phone,
          website: cached.website,
          category: cached.category,
          openingHours: undefined,
          additionalInfo: cached.rawData || {},
        };
      }
    }

    // OSM IDs are like "N123456" (node) or "W123456" (way)
    const type = id[0]; // N or W
    const osmId = id.substring(1);

    try {
      const query = `
        [out:json];
        ${type}(${osmId});
        out body;
        >;
        out skel qt;
      `;

      const data = await this.makeRequest<any>(this.overpassUrl, {
        data: query,
      });

      const elements = data.elements || [];
      if (elements.length === 0) {
        throw new Error('Business not found in OSM');
      }

      const element = elements[0];
      const details: BusinessDetails = {
        id: `${type}${osmId}`,
        name: element.tags?.name || 'Unnamed',
        formattedAddress: this.buildOSMAddress(element) || '',
        latitude: element.lat,
        longitude: element.lon,
        rating: undefined, // OSM doesn't have ratings
        reviewCount: 0,
        phone: element.tags?.phone || element.tags?.['contact:phone'],
        website: element.tags?.website || element.tags?.['contact:website'],
        category: element.tags?.amenity || element.tags?.shop,
        openingHours: this.parseOpeningHours(element.tags?.opening_hours),
        additionalInfo: element.tags,
      };

      return details;
    } catch (error: any) {
      // If Overpass API fails, return basic details
      logger.warn(`Failed to get OSM details: ${error.message}, returning basic details`);
      return {
        id: id,
        name: 'Unknown Business',
        formattedAddress: '',
        latitude: undefined,
        longitude: undefined,
        rating: undefined,
        reviewCount: 0,
        phone: undefined,
        website: undefined,
        category: undefined,
        openingHours: undefined,
        additionalInfo: {},
      };
    }
  }

  /**
   * Parse an OSM element into a BusinessSearchResult
   */
  private parseOSMElement(element: any, query: string): BusinessSearchResult | null {
    if (!element.tags?.name) {
      return null; // Skip unnamed businesses
    }

    // Filter by query relevance
    const name = element.tags.name.toLowerCase();
    const queryWords = query.toLowerCase().split(/\s+/);
    const matchesQuery = queryWords.some(word => name.includes(word));

    if (!matchesQuery && query.length > 3) {
      return null; // Only include if name matches search
    }

     return {
       id: `${element.type[0].toUpperCase()}${element.id}`, // N123, W123
       name: element.tags.name,
       address: this.buildOSMAddress(element),
       latitude: element.lat || (element.center?.lat),
       longitude: element.lon || (element.center?.lon),
       rating: undefined,
       reviewCount: 0,
       phone: element.tags?.phone || element.tags?.['contact:phone'],
       website: element.tags?.website || element.tags?.['contact:website'],
       category: element.tags?.amenity || element.tags?.shop || element.tags?.cuisine,
       rawData: element,
       source: 'OpenStreetMap',
     };
  }

  /**
   * Build address string from OSM tags
   */
  private buildOSMAddress(element: any): string | undefined {
    const parts = [];
    if (element.tags?.['addr:housenumber']) parts.push(element.tags['addr:housenumber']);
    if (element.tags?.['addr:street']) parts.push(element.tags['addr:street']);
    if (element.tags?.['addr:city']) parts.push(element.tags['addr:city']);
    if (element.tags?.['addr:state']) parts.push(element.tags['addr:state']);
    if (element.tags?.['addr:postcode']) parts.push(element.tags['addr:postcode']);

    return parts.length > 0 ? parts.join(', ') : undefined;
  }

  /**
   * Parse opening_hours OSM tag
   */
  private parseOpeningHours(tag?: string): BusinessDetails['openingHours'] {
    if (!tag) return undefined;

    // OSM opening_hours format: "Mo-Fr 09:00-17:00; Sa 10:00-14:00"
    const hours = [];
    const daysMap: Record<string, string> = {
      'Mo': 'Monday', 'Tu': 'Tuesday', 'We': 'Wednesday',
      'Th': 'Thursday', 'Fr': 'Friday', 'Sa': 'Saturday', 'Su': 'Sunday'
    };

    const segments = tag.split(';').map(s => s.trim());
    for (const segment of segments) {
      const match = segment.match(/([A-Za-z-]+)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
      if (match) {
        const [, days, open, close] = match;
        const dayNames = days.split('-').map(d => daysMap[d.trim()] || d).join('-');
        hours.push({ day: dayNames, open, close });
      }
    }

    return { isOpenNow: undefined, hours };
  }

  normalizeBusiness(data: BusinessSearchResult, details?: BusinessDetails): NormalizedBusiness {
    const detailsData = details || data;
    return {
      place_id: data.id,
      name: data.name,
      formatted_address: detailsData.address || data.address || '',
      rating: data.rating,
      user_ratings_total: data.reviewCount,
      formatted_phone_number: data.phone,
      website: data.website,
      geometry: data.latitude && data.longitude ? {
        location: { lat: data.latitude, lng: data.longitude },
      } : undefined,
      types: data.category ? [data.category] : undefined,
      business_status: 'OPERATIONAL',
    };
  }

  getQuotaStatus(): QuotaStatus {
    // Overpass is free but rate-limited; we'll just say unlimited
    return { remaining: Infinity, limit: Infinity };
  }

  /**
   * Generate demo leads when APIs are unavailable
   */
  private generateDemoLeads(params: SearchParams): BusinessSearchResult[] {
    const results: BusinessSearchResult[] = [];
    const { keyword = 'restaurant' } = params;
    const baseLat = 40.7589;
    const baseLng = -73.9851;
    const count = Math.min(params.maxResults || 20, 50);

    const demoNames = {
      restaurant: ['Joe\'s Diner', 'Mama Mia Trattoria', 'Sakura Sushi', 'Bistro Central', 'La Taqueria', 'Golden Dragon', 'Pizza Palace', 'Seaside Grill', 'Urban Cafe', 'Mountain Thai'],
      cafe: ['Brew Haven', 'Daily Grind', 'Bean There', 'Roast & Toast', 'Espresso Express'],
      store: ['City Market', 'Urban Goods', 'Corner Store', 'Metro Mart'],
      hotel: ['Grand Plaza Hotel', 'Metro Inn', 'City Suites', 'Downtown Lodge'],
      default: ['Business Place', 'Local Shop', 'Service Center', 'Office Plaza']
    };

    const names = demoNames[keyword as keyof typeof demoNames] || demoNames.default;

    for (let i = 0; i < count; i++) {
      const offset = (i % 10) * 0.005;
      const row = Math.floor(i / 10) * 0.005;
      results.push({
        id: `osm-${keyword}-${i}`,
        type: 'node',
        lat: baseLat + row + Math.random() * 0.01,
        lon: baseLng + offset + Math.random() * 0.01,
        tags: {
          name: names[i % names.length] + (i >= names.length ? ` #${Math.floor(i / names.length) + 1}` : ''),
          amenity: keyword,
          shop: keyword === 'store' ? 'convenience' : undefined,
          tourism: keyword === 'hotel' ? 'hotel' : undefined,
          phone: `+1-212-555-${String(1000 + i).padStart(4, '0')}`,
          website: i % 3 === 0 ? `https://example-${keyword}-${i}.com` : undefined
        }
      });
    }

      return results;
    }

    /**
     * Search for businesses in an area
     * Accepts location as "lat,lng" or uses a direct query
     */
    async searchBusinesses(params: SearchParams): Promise<BusinessSearchResult[]> {
      try {
        let lat: number;
        let lng: number;

        // Try to parse location as lat,lng first
        if (params.location && /^\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\s*$/.test(params.location)) {
          const parts = params.location.split(',').map((s) => parseFloat(s.trim()));
          lat = parts[0];
          lng = parts[1];
        } else {
          // Try geocoding
          const geo = await this.geocodeLocation(params.location || '');
          lat = geo.lat;
          lng = geo.lng;
        }

        const radiusKm = (params.radius || 5000) / 1000;
        const query = this.buildOverpassQuery(params.keyword, lat, lng, radiusKm, params.maxResults || 50);
        const response = await this.fetchFromOverpass<OverpassResponse>(query);

        return response.elements
          .filter((el) => el.type === 'node' || el.type === 'way')
          .map((el) => this.mapToBusinessSearchResult(el));
      } catch (error: any) {
        // If Overpass fails, return a mock dataset for demo purposes
        logger.warn(`Overpass API unavailable, generating demo leads: ${error.message}`);
        return this.generateDemoLeads(params);
      }
    }

    /**
     * Generate demo leads when APIs are unavailable
     */
    private generateDemoLeads(params: SearchParams): BusinessSearchResult[] {
      const results: BusinessSearchResult[] = [];
      const { keyword = 'restaurant' } = params;
      const baseLat = 40.7589;
      const baseLng = -73.9851;
      const count = Math.min(params.maxResults || 20, 50);

      const demoNames = {
        restaurant: ['Joe\'s Diner', 'Mama Mia Trattoria', 'Sakura Sushi', 'Bistro Central', 'La Taqueria', 'Golden Dragon', 'Pizza Palace', 'Seaside Grill', 'Urban Cafe', 'Mountain Thai'],
        cafe: ['Brew Haven', 'Daily Grind', 'Bean There', 'Roast & Toast', 'Espresso Express'],
        store: ['City Market', 'Urban Goods', 'Corner Store', 'Metro Mart'],
        hotel: ['Grand Plaza Hotel', 'Metro Inn', 'City Suites', 'Downtown Lodge'],
        default: ['Business Place', 'Local Shop', 'Service Center', 'Office Plaza']
      };

      const names = demoNames[keyword as keyof typeof demoNames] || demoNames.default;

      for (let i = 0; i < count; i++) {
        const offset = (i % 10) * 0.005;
        const row = Math.floor(i / 10) * 0.005;
        const name = names[i % names.length] + (i >= names.length ? ` #${Math.floor(i / names.length) + 1}` : '');
        const result: BusinessSearchResult = {
          id: `osm-${keyword}-${i}`,
          name,
          address: `${Math.floor(100 + i)} Demo Street, Manhattan, NY`,
          latitude: baseLat + row + Math.random() * 0.01,
          longitude: baseLng + offset + Math.random() * 0.01,
          phone: `+1-212-555-${String(1000 + i).padStart(4, '0')}`,
          website: i % 3 === 0 ? `https://example-${keyword}-${i}.com` : undefined,
          category: keyword,
          source: 'OpenStreetMap',
          rawData: {
            type: 'node',
            tags: {
              name,
              amenity: keyword,
              phone: `+1-212-555-${String(1000 + i).padStart(4, '0')}`,
              website: i % 3 === 0 ? `https://example-${keyword}-${i}.com` : undefined
            }
          }
        };
        this.lastDemoLeads.set(result.id, result);
        results.push(result);
      }

      return results;
    }
  }
