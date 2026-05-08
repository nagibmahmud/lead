import { config } from '../config';
import { PlaceDetails, PlaceSearchResult } from '../google-places/client';
import { Lead } from '../database';

export interface ScoreBreakdown {
  total: number;
  ratingScore: number;
  reviewScore: number;
  websiteScore: number;
  emailScore: number;
  phoneScore: number;
  completenessScore: number;
}

export class LeadScorer {
  /**
   * Calculate lead score based on multiple factors
   */
  static calculateScore(lead: Lead): number {
    const breakdown = this.calculateScoreBreakdown(lead);
    return breakdown.total;
  }

  /**
   * Get detailed score breakdown
   */
  static calculateScoreBreakdown(lead: Lead): ScoreBreakdown {
    let total = 0;

    // Rating score (0-100)
    // 5 stars = 100, 4 = 80, 3 = 60, etc.
    const ratingScore = lead.rating ? (lead.rating / 5) * 100 : 0;
    total += ratingScore;

    // Review count score (max 50 points)
    // Logarithmic scale: 10 reviews = 10pts, 100 = 25pts, 1000 = 50pts
    const reviewScore = lead.user_ratings_total
      ? Math.min(50, Math.log10(lead.user_ratings_total) * 12.5)
      : 0;
    total += reviewScore;

    // Website bonus
    if (lead.website) {
      total += config.score_website;
    }

    // Email bonus
    if (lead.email) {
      total += config.score_email;
    }

    // Phone bonus
    if (lead.phone) {
      total += config.score_phone;
    }

    // Data completeness score (max 50)
    const completenessScore = this.calculateCompleteness(lead);
    total += completenessScore;

    return {
      total: Math.min(100, total), // Cap at 100
      ratingScore,
      reviewScore,
      websiteScore: lead.website ? config.score_website : 0,
      emailScore: lead.email ? config.score_email : 0,
      phoneScore: lead.phone ? config.score_phone : 0,
      completenessScore,
    };
  }

  /**
   * Calculate data completeness score (0-50)
   */
  private static calculateCompleteness(lead: Lead): number {
    const fields = [
      !!lead.name,
      !!lead.address,
      !!lead.phone,
      !!lead.website,
      !!lead.email,
      !!lead.rating,
      !!lead.user_ratings_total,
      lead.types && lead.types.length > 0,
      lead.opening_hours && lead.opening_hours.length > 0,
      lead.latitude && lead.longitude,
    ];

    const filledCount = fields.filter(Boolean).length;
    return (filledCount / fields.length) * 50;
  }

  /**
   * Score a PlaceDetails object before it's converted to Lead
   */
  static fromPlaceDetails(place: PlaceDetails): number {
    const tempLead = {
      rating: place.rating,
      user_ratings_total: place.user_ratings_total,
      website: place.website,
      email: undefined as string | undefined,
      phone: place.formatted_phone_number || place.international_phone_number,
      types: place.types || [],
      opening_hours: place.opening_hours ? JSON.stringify(place.opening_hours) : undefined,
    };

    return this.calculateScore(tempLead);
  }

  /**
   * Check if a lead meets minimum quality criteria
   */
  static meetsMinimumCriteria(place: PlaceDetails | PlaceSearchResult): boolean {
    // Check rating
    if (place.rating && config.min_rating > 0 && place.rating < config.min_rating) {
      return false;
    }

    // Check review count
    if (place.user_ratings_total && config.min_reviews > 0) {
      if (place.user_ratings_total < config.min_reviews) {
        return false;
      }
    }

    // Check if business is operational
    if ('business_status' in place && place.business_status === 'CLOSED_PERMANENTLY') {
      return false;
    }

    return true;
  }

  /**
   * Sort leads by score (highest first)
   */
  static sortByScore<T extends { score: number }>(leads: T[]): T[] {
    return leads.sort((a, b) => b.score - a.score);
  }

  /**
   * Filter leads by minimum score
   */
  static filterByScore<T extends { score: number }>(leads: T[], minScore: number): T[] {
    return leads.filter(lead => lead.score >= minScore);
  }
}
