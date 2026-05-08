import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config';
import logger from '../utils/logger';
import { extractEmails, extractPhones, sleep } from '../utils/helpers';

export interface ScrapedData {
  emails: string[];
  phones: string[];
  socialLinks: {
    facebook?: string;
    twitter?: string;
    instagram?: string;
    linkedin?: string;
    youtube?: string;
  };
  metaDescription?: string;
  title?: string;
  aboutText?: string;
  language?: string;
  success: boolean;
  error?: string;
}

export interface EnrichedLead extends ScrapedData {
  placeId: string;
}

class WebScraper {
  private client: axios.AxiosInstance;
  private visitedUrls = new Set<string>();

  constructor() {
    this.client = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': config.user_agent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      maxRedirects: 5,
    });
  }

  /**
   * Scrape a website and extract contact info
   */
  async scrapeWebsite(url: string): Promise<ScrapedData> {
    const result: ScrapedData = {
      emails: [],
      phones: [],
      socialLinks: {},
      success: false,
    };

    if (!this.isValidUrl(url)) {
      result.error = 'Invalid URL';
      return result;
    }

    try {
      logger.debug(`Scraping website: ${url}`);

      const response = await this.client.get(url);
      const html = response.data;
      const $ = cheerio.load(html);

      // Extract text content
      const bodyText = $('body').text();

      // Extract emails
      if (config.extract_emails) {
        result.emails = extractEmails(bodyText);
      }

      // Extract phone numbers
      result.phones = extractPhones(bodyText).map(p => ({
        original: p,
        formatted: p.replace(/\D/g, ''),
      }));

      // Extract social links
      result.socialLinks = this.extractSocialLinks($);

      // Extract meta data
      result.metaDescription = $('meta[name="description"]').attr('content') || undefined;
      result.title = $('title').text().trim() || undefined;

      // Extract about text (look for common about sections)
      result.aboutText = this.extractAboutText($);

      // Detect language
      result.language = $('html').attr('lang') || 'en';

      result.success = true;
      logger.debug(`Scraped ${url}: found ${result.emails.length} emails, ${Object.keys(result.socialLinks).length} social links`);

    } catch (error: any) {
      logger.error(`Failed to scrape ${url}: ${error.message}`);
      result.error = error.message;
      result.success = false;
    }

    return result;
  }

  /**
   * Extract social media links from page
   */
  private extractSocialLinks($: cheerio.CheerioAPI): ScrapedData['socialLinks'] {
    const socialLinks: ScrapedData['socialLinks'] = {};

    const links = $('a[href]').map((i, el) => $(el).attr('href')).get() as string[];

    for (const link of links) {
      if (!link) continue;

      if (link.includes('facebook.com')) {
        socialLinks.facebook = this.normalizeUrl(link);
      } else if (link.includes('twitter.com') || link.includes('x.com')) {
        socialLinks.twitter = this.normalizeUrl(link);
      } else if (link.includes('instagram.com')) {
        socialLinks.instagram = this.normalizeUrl(link);
      } else if (link.includes('linkedin.com')) {
        socialLinks.linkedin = this.normalizeUrl(link);
      } else if (link.includes('youtube.com') || link.includes('youtu.be')) {
        socialLinks.youtube = this.normalizeUrl(link);
      }
    }

    return socialLinks;
  }

  /**
   * Extract "about" text from common sections
   */
  private extractAboutText($: cheerio.CheerioAPI): string | undefined {
    // Try various selectors commonly used for about sections
    const selectors = [
      '[class*="about"]',
      '[id*="about"]',
      '[class*="About"]',
      '[id*="About"]',
      'section.about',
      'div.about',
      '.about-us',
      '#about',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = element.text().trim();
        if (text.length > 50 && text.length < 2000) {
          return text;
        }
      }
    }

    // Fallback: first paragraph
    const firstParagraph = $('p').first().text().trim();
    if (firstParagraph.length > 50) {
      return firstParagraph;
    }

    return undefined;
  }

  /**
   * Validate URL
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Normalize URL (remove tracking params, etc.)
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove common tracking parameters
      parsed.searchParams.delete('utm_source');
      parsed.searchParams.delete('utm_medium');
      parsed.searchParams.delete('utm_campaign');
      parsed.searchParams.delete('utm_term');
      parsed.searchParams.delete('utm_content');
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /**
   * Respect robots.txt (basic check)
   */
  async canScrape(url: string): Promise<boolean> {
    if (!config.respect_robotstxt) return true;

    try {
      const parsed = new URL(url);
      const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;

      const response = await this.client.get(robotsUrl, { timeout: 5000 });
      const robotsTxt = response.data;

      // Very basic check - in production, use a proper robots.txt parser
      const userAgentLine = `User-agent: *`;
      const disallowPattern = new RegExp(`Disallow:\\s*(.*)`, 'i');

      const lines = robotsTxt.split('\n');
      let inUserAgentSection = false;

      for (const line of lines) {
        if (line.trim() === userAgentLine) {
          inUserAgentSection = true;
        } else if (line.startsWith('User-agent:')) {
          inUserAgentSection = false;
        } else if (inUserAgentSection && line.toLowerCase().startsWith('disallow:')) {
          const path = line.split(':')[1]?.trim();
          if (path && parsed.pathname.startsWith(path)) {
            return false;
          }
        }
      }
    } catch {
      // If we can't fetch robots.txt, assume it's okay
    }

    return true;
  }

  /**
   * Take a screenshot of a website (requires Puppeteer)
   */
  async takeScreenshot(url: string, outputPath: string): Promise<{ success: boolean; error?: string }> {
    // This would require Puppeteer which is optional
    // Implementation left as stub - puppeteer dependency is installed but not used by default
    return {
      success: false,
      error: 'Screenshot feature requires additional setup'
    };
  }
}

// Singleton
const scraper = new WebScraper();

export default scraper;
export { WebScraper, EnrichedLead };
