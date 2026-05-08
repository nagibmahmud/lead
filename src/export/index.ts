import { createObjectCsvWriter } from 'csv-writer';
import { utils, writeFile } from 'xlsx';
import { config } from '../config';
import logger from '../utils/logger';
import { Lead } from '../database';
import { sanitizeFilename } from '../utils/helpers';
import fs from 'fs';
import path from 'path';

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'sheets';

export interface ExportOptions {
  filename?: string;
  format?: ExportFormat;
  includeScrapedData?: boolean;
  fields?: string[];
}

class Exporter {
  /**
   * Export leads to file
   */
  static async exportToFile(
    leads: Lead[],
    options: ExportOptions = {}
  ): Promise<string> {
    const format = options.format || config.default_export_format;
    const filename = options.filename || this.generateFilename(format);
    const filepath = `${config.export_path}/${filename}`;

    // Ensure export directory exists
    await this.ensureExportDir();

    switch (format) {
      case 'csv':
        return await this.exportToCSV(leads, filepath, options);
      case 'json':
        return await this.exportToJSON(leads, filepath, options);
      case 'xlsx':
        return await this.exportToExcel(leads, filepath, options);
      case 'sheets':
        throw new Error('Google Sheets export must be done via dedicated method');
      default:
        throw new Error(`Unknown export format: ${format}`);
    }
  }

  /**
   * Export to CSV
   */
  private static async exportToCSV(
    leads: Lead[],
    filepath: string,
    options: ExportOptions
  ): Promise<string> {
    const headers = this.getCSVHeaders(options.includeScrapedData);

    const csvWriter = createObjectCsvWriter({
      path: filepath,
      header: headers,
      append: false,
    });

    const rows = leads.map(lead => this.leadToCSVRow(lead, options.includeScrapedData));

    await csvWriter.writeRecords(rows);
    logger.info(`Exported ${leads.length} leads to CSV: ${filepath}`);

    return filepath;
  }

  /**
   * Export to JSON
   */
  private static async exportToJSON(
    leads: Lead[],
    filepath: string,
    options: ExportOptions
  ): Promise<string> {
    const data = leads.map(lead => ({
      ...this.filterLeadFields(lead, options.fields),
      ...(options.includeScrapedData ? { scraped_data: lead.scraped_data } : {}),
    }));

    const json = JSON.stringify(data, null, 2);
    await fs.promises.writeFile(filepath, json, 'utf-8');

    logger.info(`Exported ${leads.length} leads to JSON: ${filepath}`);
    return filepath;
  }

  /**
   * Export to Excel (XLSX)
   */
  private static async exportToExcel(
    leads: Lead[],
    filepath: string,
    options: ExportOptions
  ): Promise<string> {
    const headers = this.getCSVHeaders(options.includeScrapedData);

    // Convert headers to Excel format
    const excelHeaders = headers.map(h => ({ header: h.id, key: h.id }));

    // Convert leads to rows
    const rows = leads.map(lead => this.leadToExcelRow(lead, options.includeScrapedData));

    const worksheet = utils.json_to_sheet(rows, { header: excelHeaders.map(h => h.key) });
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Leads');

    // Auto-fit columns not directly supported, but we can set widths
    worksheet['!cols'] = excelHeaders.map(() => ({ wch: 30 })); // 30 chars width

    writeFile(workbook, filepath);
    logger.info(`Exported ${leads.length} leads to Excel: ${filepath}`);

    return filepath;
  }

  /**
   * Export to Google Sheets
   */
  static async exportToGoogleSheets(
    leads: Lead[],
    sheetId: string,
    sheetName: string = 'Leads',
    options: ExportOptions = {}
  ): Promise<string> {
    const { GoogleSpreadsheet } = await import('google-spreadsheet');
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_DATA || '{}');

    if (!credentials.private_key) {
      throw new Error('Google service account credentials not configured');
    }

    const doc = new GoogleSpreadsheet(sheetId);

    try {
      await doc.useServiceAccountAuth(credentials);
      await doc.loadInfo();

      let sheet = doc.sheetsByIndex[0];

      // Check if sheet exists, create if not
      const existingSheet = doc.sheets.find(s => s.title === sheetName);
      if (existingSheet) {
        sheet = existingSheet;
      } else {
        sheet = await doc.addSheet({ title: sheetName });
      }

      // Prepare data
      const headers = this.getCSVHeaders(options.includeScrapedData).map(h => h.id);
      const rows = leads.map(lead => this.leadToArrayRow(lead, options.includeScrapedData));

      // Clear existing data and set new
      await sheet.clear();
      await sheet.addRow([headers]);
      await sheet.addRows(rows);

      logger.info(`Exported ${leads.length} leads to Google Sheets: ${sheetId}/${sheetName}`);
      return `https://docs.google.com/spreadsheets/d/${sheetId}`;
    } catch (error: any) {
      logger.error(`Failed to export to Google Sheets: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate filename with timestamp
   */
  private static generateFilename(format: ExportFormat): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const baseName = sanitizeFilename(`leads-${timestamp}`);
    return `${baseName}.${format}`;
  }

  /**
   * Ensure export directory exists
   */
  private static async ensureExportDir(): Promise<void> {
    try {
      await fs.promises.access(config.export_path);
    } catch {
      await fs.promises.mkdir(config.export_path, { recursive: true });
    }
  }

  /**
   * Get CSV headers configuration
   */
  private static getCSVHeaders(includeScraped: boolean = false) {
    const baseHeaders = [
      { id: 'place_id', title: 'Place ID' },
      { id: 'name', title: 'Business Name' },
      { id: 'address', title: 'Address' },
      { id: 'phone', title: 'Phone' },
      { id: 'website', title: 'Website' },
      { id: 'rating', title: 'Rating' },
      { id: 'user_ratings_total', title: 'Review Count' },
      { id: 'price_level', title: 'Price Level' },
      { id: 'business_status', title: 'Status' },
      { id: 'types', title: 'Categories' },
      { id: 'opening_hours', title: 'Opening Hours' },
      { id: 'latitude', title: 'Latitude' },
      { id: 'longitude', title: 'Longitude' },
      { id: 'email', title: 'Email' },
      { id: 'score', title: 'Lead Score' },
      { id: 'created_at', title: 'Date Added' },
    ];

    if (includeScraped) {
      baseHeaders.push(
        { id: 'scraped_emails', title: 'Scraped Emails' },
        { id: 'scraped_phones', title: 'Scraped Phones' },
        { id: 'social_facebook', title: 'Facebook' },
        { id: 'social_twitter', title: 'Twitter' },
        { id: 'social_instagram', title: 'Instagram' },
        { id: 'social_linkedin', title: 'LinkedIn' },
        { id: 'scraped_about', title: 'About Text' }
      );
    }

    return baseHeaders;
  }

  /**
   * Convert Lead to CSV row object
   */
  private static leadToCSVRow(lead: Lead, includeScraped: boolean = false): Record<string, any> {
    const row: Record<string, any> = {
      place_id: lead.place_id,
      name: lead.name,
      address: lead.address,
      phone: lead.phone || '',
      website: lead.website || '',
      rating: lead.rating || '',
      user_ratings_total: lead.user_ratings_total || '',
      price_level: lead.price_level || '',
      business_status: lead.business_status || '',
      types: lead.types.join('; '),
      opening_hours: lead.opening_hours || '',
      latitude: lead.latitude || '',
      longitude: lead.longitude || '',
      email: lead.email || '',
      score: lead.score?.toFixed(2) || '0.00',
      created_at: lead.created_at,
    };

    if (includeScraped && lead.scraped_data) {
      row.scraped_emails = (lead.scraped_data.emails || []).join('; ');
      row.scraped_phones = (lead.scraped_data.phones || []).join('; ');
      row.social_facebook = lead.scraped_data.socialLinks?.facebook || '';
      row.social_twitter = lead.scraped_data.socialLinks?.twitter || '';
      row.social_instagram = lead.scraped_data.socialLinks?.instagram || '';
      row.social_linkedin = lead.scraped_data.socialLinks?.linkedin || '';
      row.scraped_about = lead.scraped_data.aboutText || '';
    }

    return row;
  }

  /**
   * Convert Lead to Excel row (flat object)
   */
  private static leadToExcelRow(lead: Lead, includeScraped: boolean = false): Record<string, any> {
    return this.leadToCSVRow(lead, includeScraped);
  }

  /**
   * Convert Lead to array row (for Google Sheets)
   */
  private static leadToArrayRow(lead: Lead, includeScraped: boolean = false): any[] {
    const base = [
      lead.place_id,
      lead.name,
      lead.address,
      lead.phone || '',
      lead.website || '',
      lead.rating || '',
      lead.user_ratings_total || '',
      lead.price_level || '',
      lead.business_status || '',
      lead.types.join('; '),
      lead.opening_hours || '',
      lead.latitude || '',
      lead.longitude || '',
      lead.email || '',
      lead.score?.toFixed(2) || '0.00',
      lead.created_at,
    ];

    if (includeScraped && lead.scraped_data) {
      return [
        ...base,
        (lead.scraped_data.emails || []).join('; '),
        (lead.scraped_data.phones || []).join('; '),
        lead.scraped_data.socialLinks?.facebook || '',
        lead.scraped_data.socialLinks?.twitter || '',
        lead.scraped_data.socialLinks?.instagram || '',
        lead.scraped_data.socialLinks?.linkedin || '',
        lead.scraped_data.aboutText || '',
      ];
    }

    return base;
  }

  /**
   * Filter lead fields based on provided field list
   */
  private static filterLeadFields(lead: Lead, fields?: string[]): Record<string, any> {
    const fullLead = {
      place_id: lead.place_id,
      name: lead.name,
      address: lead.address,
      phone: lead.phone,
      website: lead.website,
      email: lead.email,
      rating: lead.rating,
      user_ratings_total: lead.user_ratings_total,
      review_count: lead.review_count,
      price_level: lead.price_level,
      business_status: lead.business_status,
      types: lead.types,
      opening_hours: lead.opening_hours,
      latitude: lead.latitude,
      longitude: lead.longitude,
      source_query: lead.source_query,
      scraped_data: lead.scraped_data,
      screenshot_path: lead.screenshot_path,
      score: lead.score,
      created_at: lead.created_at,
      updated_at: lead.updated_at,
    };

    if (!fields || fields.length === 0) {
      return fullLead;
    }

    const filtered: Record<string, any> = {};
    for (const field of fields) {
      if (field in fullLead) {
        filtered[field] = fullLead[field];
      }
    }

    return filtered;
  }
}

export default Exporter;
