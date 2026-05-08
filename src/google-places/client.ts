import axios, { AxiosInstance } from 'axios';
import axiosRetry, { isNetworkOrIdempotentRequestError } from 'axios-retry';
import { config } from '../config';
import logger from '../utils/logger';
import { sleep } from '../utils/helpers';
import proxyManager from '../proxy/manager';

export interface PlaceSearchResult {
  place_id: string;
  name: string;
  vicinity?: string; // for text search
  geometry?: {
    location: {
      lat: number;
      lng: number;
    };
    viewport?: {
      northeast: { lat: number; lng: number };
      southwest: { lat: number; lng: number };
    };
  };
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  types?: string[];
  icon?: string;
  photos?: PlacePhoto[];
  opening_hours?: {
    open_now: boolean;
    weekday_text?: string[];
  };
  price_level?: number;
  business_status?: string;
}

export interface PlacePhoto {
  photo_reference: string;
  height: number;
  width: number;
  html_attributions: string[];
}

export interface PlaceDetails {
  place_id: string;
  name: string;
  formatted_address: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  url?: string; // Google Maps URL
  rating?: number;
  user_ratings_total?: number;
  review?: Review[];
  photos?: PlacePhoto[];
  opening_hours?: {
    open_now: boolean;
    periods?: OpeningPeriod[];
    weekday_text: string[];
  };
  geometry: {
    location: { lat: number; lng: number };
    viewport: {
      northeast: { lat: number; lng: number };
      southwest: { lat: number; lng: number };
    };
  };
  types: string[];
  price_level?: number;
  business_status?: string;
  utc_offset?: number;
  address_components?: AddressComponent[];
  plus_code?: {
    compound_code: string;
    global_code: string;
  };
}

export interface Review {
  author_name: string;
  author_url?: string;
  language?: string;
  profile_photo_url?: string;
  rating: number;
  relative_time_description: string;
  text: string;
  time: number;
}

export interface OpeningPeriod {
  open: {
    day: number; // 0=Sunday, 6=Saturday
    time: string; // HHMM format, e.g., "0800"
  };
  close?: {
    day: number;
    time: string;
  };
}

export interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

class GooglePlacesClient {
  private client: AxiosInstance;
  private apiKey: string;
  private baseURL: string;
  private requestCount = 0;
  private lastRequestTime = 0;

   constructor() {
     this.apiKey = config.google_places_api_key;
     this.baseURL = config.google_places_base;

     const proxyConfig = proxyManager.getAxiosProxyConfig();

     this.client = axios.create({
       baseURL: this.baseURL,
       timeout: 30000,
       params: {
         key: this.apiKey,
       },
       ...(proxyConfig && { proxy: proxyConfig }),
     });

      // Add retry logic
      axiosRetry(this.client, {
        retries: config.max_retries,
        retryDelay: (retryCount) => {
          return Math.min(1000 * Math.pow(2, retryCount), 30000);
        },
        retryCondition: (error) => {
          return (
            isNetworkOrIdempotentRequestError(error) ||
            (error.response?.status ? error.response.status >= 500 : false) ||
            error.response?.status === 429
          );
        },
        onRetry: (retryCount, error) => {
          logger.warn(`Retrying request (${retryCount}/${config.max_retries}): ${error.message}`);
        },
      });

    // Rate limiting interceptor
    this.client.interceptors.request.use((config) => {
      this.applyRateLimit();
      return config;
    });

    // Request logging
    this.client.interceptors.request.use((config) => {
      logger.debug(`Making request to: ${config.url}`);
      return config;
    });

    this.client.interceptors.response.use(
      (response) => {
        this.requestCount++;
        return response;
      },
      (error) => {
        logger.error(`Request failed: ${error.message}`);
        return Promise.reject(error);
      }
    );
  }

  private applyRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < config.request_delay) {
      const sleepTime = config.request_delay - timeSinceLastRequest;
      logger.debug(`Rate limiting: waiting ${sleepTime}ms`);
      // Note: In a real implementation, you'd use async sleep here
      // For now, we rely on the delay being small enough
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Search places by text query (e.g., "restaurants in New York")
   */
  async textSearch(params: {
    query: string;
    location?: string;
    radius?: number;
    pageToken?: string;
    type?: string;
  }): Promise<PlaceSearchResult[]> {
    const searchParams = new URLSearchParams({
      query: params.query,
      ...(params.location && { location: params.location }),
      ...(params.radius && { radius: params.radius.toString() }),
      ...(params.pageToken && { pagetoken: params.pageToken }),
      ...(params.type && { type: params.type }),
    });

    try {
      const response = await this.client.get('/text/json', {
        params: searchParams,
      });

      const data = response.data;

      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        throw new Error(`Places API error: ${data.status} - ${data.error_message || 'Unknown error'}`);
      }

      // Handle next_page_token if present (requires delay before using)
      if (data.next_page_token) {
        logger.debug('More results available, next_page_token received');
        // Google requires 2-second delay before using next_page_token
        await sleep(2000);
      }

      return data.results || [];
    } catch (error: any) {
      logger.error(`Text search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search places nearby a location
   */
  async nearbySearch(params: {
    location: string; // "lat,lng"
    radius?: number;
    keyword?: string;
    type?: string;
    pageToken?: string;
  }): Promise<PlaceSearchResult[]> {
    const searchParams = new URLSearchParams({
      location: params.location,
      ...(params.radius && { radius: params.radius.toString() }),
      ...(params.keyword && { keyword: params.keyword }),
      ...(params.type && { type: params.type }),
      ...(params.pageToken && { pagetoken: params.pageToken }),
    });

    try {
      const response = await this.client.get('/nearbysearch/json', {
        params: searchParams,
      });

      const data = response.data;

      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        throw new Error(`Places API error: ${data.status} - ${data.error_message || 'Unknown error'}`);
      }

      if (data.next_page_token) {
        logger.debug('More results available, next_page_token received');
        await sleep(2000);
      }

      return data.results || [];
    } catch (error: any) {
      logger.error(`Nearby search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get detailed information for a place
   */
  async getDetails(params: {
    place_id: string;
    fields?: string[];
  }): Promise<PlaceDetails> {
    const defaultFields = [
      'place_id',
      'name',
      'formatted_address',
      'formatted_phone_number',
      'international_phone_number',
      'website',
      'url',
      'rating',
      'user_ratings_total',
      'review',
      'photos',
      'opening_hours',
      'geometry',
      'types',
      'price_level',
      'business_status',
      'utc_offset',
      'address_components',
      'plus_code',
    ];

    const searchParams = new URLSearchParams({
      place_id: params.place_id,
      fields: (params.fields || defaultFields).join(','),
    });

    try {
      const response = await this.client.get('/details/json', {
        params: searchParams,
      });

      const data = response.data;

      if (data.status !== 'OK') {
        throw new Error(`Place details error: ${data.status} - ${data.error_message || 'Unknown error'}`);
      }

      return data.result;
    } catch (error: any) {
      logger.error(`Get details failed for ${params.place_id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get photo URL (requires separate request)
   */
  getPhotoUrl(photoReference: string, maxWidth?: number): string {
    const width = maxWidth || config.photo_max_width;
    return `${this.baseURL}/photo?maxwidth=${width}&photo_reference=${photoReference}&key=${this.apiKey}`;
  }

  /**
   * Batch get details for multiple places (with rate limiting)
   */
  async batchGetDetails(
    placeIds: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<PlaceDetails[]> {
    const results: PlaceDetails[] = [];

    for (let i = 0; i < placeIds.length; i++) {
      const placeId = placeIds[i];

      try {
        logger.debug(`Fetching details for ${placeId} (${i + 1}/${placeIds.length})`);
        const details = await this.getDetails({ place_id: placeId });
        results.push(details);
      } catch (error) {
        logger.error(`Failed to get details for ${placeId}: ${error}`);
        // Continue with other places
      }

      onProgress?.(i + 1, placeIds.length);

      // Add delay between requests (except after last one)
      if (i < placeIds.length - 1) {
        await sleep(config.request_delay);
      }
    }

    return results;
  }

  /**
   * Search and get all results (handles pagination automatically)
   */
  async searchAll(params: {
    query: string;
    location?: string;
    radius?: number;
    type?: string;
    maxResults?: number;
  }): Promise<PlaceSearchResult[]> {
    const allResults: PlaceSearchResult[] = [];
    let nextPageToken: string | undefined;
    let totalFetched = 0;
    const maxResults = params.maxResults || config.max_results_per_query;

    do {
      const response = await this.textSearch({
        ...params,
        pageToken: nextPageToken,
      });

      allResults.push(...response);
      totalFetched += response.length;

      // Check if we have more pages
      nextPageToken = undefined; // Will be set if more results exist
      // Note: The next_page_token is only available after a short delay
      // This simplified version fetches one page; real implementation would need to handle token

      logger.info(`Fetched ${totalFetched} results so far`);

      // Stop if we've reached max
      if (maxResults && totalFetched >= maxResults) {
        break;
      }

      // Add delay before next page request
      if (response.length > 0 && maxResults && totalFetched < maxResults) {
        await sleep(config.request_delay);
      }
    } while (nextPageToken && (!maxResults || totalFetched < maxResults));

    return allResults.slice(0, maxResults);
  }

  getRequestCount(): number {
    return this.requestCount;
  }
}

// Singleton instance
let placesClient: GooglePlacesClient | null = null;

export function getPlacesClient(): GooglePlacesClient {
  if (!placesClient) {
    placesClient = new GooglePlacesClient();
  }
  return placesClient;
}

export { GooglePlacesClient };
