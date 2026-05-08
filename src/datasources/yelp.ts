import axios from 'axios';
import { BaseDataSource, SearchParams, BusinessSearchResult, BusinessDetails, NormalizedBusiness } from './base';

/**
 * Yelp Fusion API data source
 * Free tier: 5,000 calls/day
 * No credit card required - just register for API key
 */
export class YelpSource extends BaseDataSource {
  private apiKey: string;
  private baseUrl = 'https://api.yelp.com/v3';
  private dailyLimit = 5000;
  private usedToday = 0;
  private lastReset = new Date();

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey || process.env.YELP_API_KEY || '';
  }

  getSourceName(): string {
    return 'Yelp';
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 10;
  }

  getQuotaStatus(): { remaining: number; limit: number; resetAt?: Date } {
    // Approximate - Yelp resets daily at midnight PST
    const now = new Date();
    const reset = new Date(now);
    reset.setHours(7, 0, 0, 0); // Around 7am UTC (midnight PST)
    if (now > reset) {
      reset.setDate(reset.getDate() + 1);
      this.usedToday = 0;
    }

    return {
      remaining: Math.max(0, this.dailyLimit - this.usedToday),
      limit: this.dailyLimit,
      resetAt: reset,
    };
  }

  /**
   * Search businesses on Yelp
   */
  async search(params: SearchParams): Promise<BusinessSearchResult[]> {
    if (!this.isConfigured()) {
      throw new Error('Yelp API key not configured. Set YELP_API_KEY in .env');
    }

    const coords = params.location ? await this.geocodeLocation(params.location) : null;

    if (!coords) {
      throw new Error('Could not geocode location. Provide a valid city name or "lat,lng" coordinates.');
    }

    // Check quota
    const quota = this.getQuotaStatus();
    if (quota.remaining <= 0) {
      throw new Error('Yelp daily quota exceeded (5,000 calls/day). Try again tomorrow.');
    }

    try {
      const response = await this.makeRequestWithAuth(
        `${this.baseUrl}/businesses/search`,
        {
          term: params.query,
          latitude: coords.lat,
          longitude: coords.lng,
          radius: params.radius || 5000,
          limit: Math.min(params.limit || 50, 50), // Yelp max 50 per request
          sort_by: 'rating',
          categories: this.mapCategoryToYelp(params.category || params.query),
        }
      );

      this.usedToday += 1; // One search counts as 1 call

      const results: BusinessSearchResult[] = (response.businesses || []).map((b: any) => ({
        id: b.id,
        name: b.name,
        address: b.location?.display_address?.join(', '),
        latitude: b.coordinates?.latitude,
        longitude: b.coordinates?.longitude,
        rating: b.rating,
        reviewCount: b.review_count,
        phone: b.display_phone,
        website: b.url, // Yelp URL (not business website)
        category: b.categories?.[0]?.title,
        imageUrl: b.image_url,
        rawData: b,
        source: 'Yelp',
      }));

      return results;
    } catch (error: any) {
      if (error.response?.status === 429) {
        throw new Error('Yelp rate limit exceeded. Try again later.');
      }
      throw error;
    }
  }

  /**
   * Get business details from Yelp
   */
  async getDetails(id: string): Promise<BusinessDetails> {
    if (!this.isConfigured()) {
      throw new Error('Yelp API key not configured');
    }

    try {
      const response = await this.makeRequestWithAuth(`${this.baseUrl}/businesses/${id}`);

      const business = response;
      const details: BusinessDetails = {
        id: business.id,
        name: business.name,
        address: business.location?.display_address?.join(', '),
        latitude: business.coordinates?.latitude,
        longitude: business.coordinates?.longitude,
        rating: business.rating,
        reviewCount: business.review_count,
        phone: business.display_phone,
        website: business.url, // Yelp page
        category: business.categories?.[0]?.title,
        imageUrl: business.image_url,
        formattedAddress: business.location?.address1 || '',
        openingHours: business.hours ? {
          isOpenNow: business.hours[0]?.is_open_now,
          hours: business.hours[0]?.open_hours?.map((h: any) => ({
            day: this.getDayName(h.day),
            open: this.formatTime(h.start),
            close: this.formatTime(h.end),
          })) || [],
        } : undefined,
        priceLevel: business.price, // "$", "$$", "$$$", "$$$$"
        additionalInfo: {
          yelpUrl: business.url,
          categories: business.categories,
          photos: business.photos,
          isClosed: business.is_closed,
        },
      };

      return details;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error('Business not found on Yelp');
      }
      throw error;
    }
  }

  /**
   * Convert Yelp category to standard search category
   */
  private mapCategoryToYelp(category: string): string {
    // Yelp category mapping (partial list)
    const mapping: Record<string, string> = {
      'restaurants': 'restaurants',
      'coffee': 'coffee',
      'cafe': 'cafes',
      'gyms': 'fitness',
      'fitness': 'fitness',
      'salons': 'hair_salons,barbers',
      'hotels': 'hotels',
      'bars': 'bars',
      'pubs': 'pubs',
      'pharmacy': 'pharmacy',
      'banks': 'banks',
      'schools': 'schools',
      'hospitals': 'hospitals',
      'dentists': 'dentists',
      'doctors': 'doctors',
      'shopping': 'shopping',
      'grocery': 'grocery',
      'supermarket': 'groceries',
    };

    const key = category.toLowerCase().trim();
    return mapping[key] || category;
  }

  /**
   * Convert Yelp day number to name
   */
  private getDayName(dayNum: number): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayNum] || '';
  }

  /**
   * Format time (HHMM) to HH:MM
   */
  private formatTime(time: number): string {
    const str = time.toString().padStart(4, '0');
    const hours = str.slice(0, 2);
    const minutes = str.slice(2);
    return `${hours}:${minutes}`;
  }

  /**
   * Make authenticated request to Yelp
   */
  private async makeRequestWithAuth<T>(url: string, params: Record<string, any> = {}): Promise<T> {
    const response = await axios.get(url, {
      params,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
      },
      timeout: 15000,
    });
    return response.data;
  }

  normalizeBusiness(data: BusinessSearchResult, details?: BusinessDetails): NormalizedBusiness {
    const d = details || data;
    return {
      place_id: data.id,
      name: data.name,
      formatted_address: d.address || data.address || '',
      rating: data.rating,
      user_ratings_total: data.reviewCount,
      formatted_phone_number: data.phone,
      website: d.website, // Yelp page URL
      geometry: data.latitude && data.longitude ? {
        location: { lat: data.latitude, lng: data.longitude },
        viewport: undefined,
      } : undefined,
      types: data.category ? [data.category] : undefined,
      business_status: data.rawData?.is_closed ? 'CLOSED' : 'OPERATIONAL',
    };
  }

  /**
   * Try to find actual business website from Yelp URL
   * (Yelp doesn't provide direct website, but we can try to extract from Yelp page)
   */
  async extractWebsiteFromYelp(yelpId: string): Promise<string | null> {
    try {
      const yelpUrl = `https://www.yelp.com/biz/${yelpId}`;
      const response = await axios.get(yelpUrl, {
        headers: { 'User-Agent': 'LeadFinder/1.0' },
        timeout: 10000,
      });
      const html = response.data;
      const match = html.match(/<a[^>]*data-href=["']([^"']+)["'][^>]*>Website<\/a>/i);
      if (match) {
        return match[1];
      }
      // Also try: website url in script
      const jsonMatch = html.match(/["']url["']:\s*["'](https?:\/\/[^"']+)["']/);
      if (jsonMatch) {
        return jsonMatch[1];
      }
    } catch {
      // Ignore
    }
    return null;
  }
}

/**
 * Factory to create Yelp source
 */
export function createYelpSource(apiKey?: string): YelpSource {
  return new YelpSource(apiKey);
}
