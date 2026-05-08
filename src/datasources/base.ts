import axios from 'axios';
import { PlaceSearchResult, PlaceDetails } from '../google-places/client';

/**
 * Unified interface for all lead data sources
 * All sources must implement these methods
 */
export interface IDataSource {
  /** Search for businesses by query/location */
  search(params: SearchParams): Promise<BusinessSearchResult[]>;

  /** Get detailed information for a specific business */
  getDetails(id: string): Promise<BusinessDetails>;

  /** Get source name (for logging) */
  getSourceName(): string;

  /** Check if source is configured and ready */
  isConfigured(): boolean;

  /** Get remaining quota (if applicable) */
  getQuotaStatus(): QuotaStatus;

  /** Normalize business data to standard format */
  normalizeBusiness(data: any, details?: BusinessDetails): NormalizedBusiness;
}

export interface SearchParams {
  query: string;
  location?: string; // city name or "lat,lng"
  radius?: number; // meters
  limit?: number;
  category?: string;
}

export interface BusinessSearchResult {
  id: string;          // Source-specific ID
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  reviewCount?: number;
  phone?: string;
  website?: string;
  category?: string;
  imageUrl?: string;
  rawData?: any;
  source?: string;     // Data source name (optional, for internal tracking)
}

export interface BusinessDetails extends BusinessSearchResult {
  formattedAddress: string;
  openingHours?: OpeningHours;
  priceLevel?: string; // $, $$, $$$, $$$$
  additionalInfo?: Record<string, any>;
}

export interface OpeningHours {
  isOpenNow?: boolean;
  hours: Array<{
    day: string; // "Monday", etc.
    open: string; // "09:00"
    close: string; // "17:00"
  }>;
}

export interface QuotaStatus {
  remaining: number;
  resetAt?: Date;
  limit: number;
}

export interface NormalizedBusiness {
  place_id: string;
  name: string;
  formatted_address: string;
  rating?: number;
  user_ratings_total?: number;
  formatted_phone_number?: string;
  website?: string;
  geometry?: {
    location: { lat: number; lng: number };
    viewport?: any;
  };
  types?: string[];
  business_status?: string;
  opening_hours?: any;
  price_level?: number;
}

/**
 * Abstract base class with common functionality
 */
export abstract class BaseDataSource implements IDataSource {
  abstract getSourceName(): string;
  abstract search(params: SearchParams): Promise<BusinessSearchResult[]>;
  abstract getDetails(id: string): Promise<BusinessDetails>;

  isConfigured(): boolean {
    return true;
  }

  getQuotaStatus(): QuotaStatus {
    return { remaining: Infinity, limit: Infinity };
  }

  normalizeBusiness(data: BusinessSearchResult, details?: BusinessDetails): NormalizedBusiness {
    return {
      place_id: data.id,
      name: data.name,
      formatted_address: data.address || '',
      rating: data.rating,
      user_ratings_total: data.reviewCount,
      formatted_phone_number: data.phone,
      website: data.website,
      geometry: data.latitude && data.longitude ? {
        location: { lat: data.latitude, lng: data.longitude },
      } : undefined,
      types: data.category ? [data.category] : undefined,
    };
  }

  /**
   * Helper: make HTTP request with retry logic
   */
  protected async makeRequest<T>(
    url: string,
    params: Record<string, any> = {},
    method: 'get' | 'post' = 'get'
  ): Promise<T> {
    const axiosInstance = axios.create({
      timeout: 30000,
      retry: {
        retries: 3,
        retryDelay: (count: number) => Math.min(1000 * Math.pow(2, count), 10000),
      },
    });

    try {
      const response = await axiosInstance[method](url, { params });
      return response.data;
    } catch (error: any) {
      throw new Error(`Request failed: ${error.message}`);
    }
  }

  /**
   * Helper: geocode location string to coordinates
   */
  protected async geocodeLocation(location: string): Promise<{ lat: number; lng: number } | null> {
    // Try to parse as "lat,lng"
    const parts = location.split(',').map(s => s.trim());
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }

    // Otherwise use Nominatim (free OpenStreetMap geocoder)
    try {
      const data = await this.makeRequest<any>(
        'https://nominatim.openstreetmap.org/search',
        {
          q: location,
          format: 'json',
          limit: 1,
        }
      );

      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
        };
      }
    } catch (error) {
      console.warn(`Geocoding failed for "${location}": ${error.message}`);
    }

    return null;
  }

  /**
   * Extract email from website (shared logic)
   */
  protected async extractEmailFromWebsite(website: string): Promise<string | null> {
    try {
      const response = await axios.get(website, {
        timeout: 10000,
        headers: { 'User-Agent': 'LeadFinder/1.0' },
        maxRedirects: 5,
      });
      const html = response.data;
      const emailMatch = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
      return emailMatch ? emailMatch[0] : null;
    } catch {
      return null;
    }
  }
}
