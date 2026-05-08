import { NextRequest, NextResponse } from 'next/server';
import logger from '../utils/logger';
import database, { Lead, LeadFilter } from '../database';
import Exporter from '../export';
import { LeadScorer } from '../scoring';
import leadEngine from '../lead/engine';

/**
 * GET /api/leads - List leads with filtering
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filter: LeadFilter = {};
    const options: any = {};

    // Parse filters
    if (searchParams.get('minRating')) {
      filter.minRating = parseFloat(searchParams.get('minRating')!);
    }
    if (searchParams.get('minReviews')) {
      filter.minReviews = parseInt(searchParams.get('minReviews')!, 10);
    }
    if (searchParams.get('hasPhone') === 'true') {
      filter.hasPhone = true;
    }
    if (searchParams.get('hasWebsite') === 'true') {
      filter.hasWebsite = true;
    }
    if (searchParams.get('hasEmail') === 'true') {
      filter.hasEmail = true;
    }
    if (searchParams.get('types')) {
      filter.types = searchParams.get('types')!.split(',');
    }
    if (searchParams.get('keywords')) {
      filter.keywords = searchParams.get('keywords')!.split(',');
    }

    // Pagination
    if (searchParams.get('limit')) {
      options.limit = parseInt(searchParams.get('limit')!, 10);
    }
    if (searchParams.get('offset')) {
      options.offset = parseInt(searchParams.get('offset')!, 10);
    }
    if (searchParams.get('sortBy')) {
      options.sortBy = searchParams.get('sortBy');
    }
    if (searchParams.get('sortOrder')) {
      options.sortOrder = searchParams.get('sortOrder') as 'ASC' | 'DESC';
    }

    const result = await database.getLeads(filter, options);

    return NextResponse.json({
      success: true,
      data: result.leads,
      meta: {
        total: result.total,
        page: Math.floor((options.offset || 0) / (options.limit || 10)) + 1,
        pageSize: options.limit || 10,
      },
    });
  } catch (error: any) {
    logger.error(`API GET /api/leads failed: ${error.message}`);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/leads - Create new lead (bulk upsert)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const leads: Omit<Lead, 'id' | 'created_at' | 'updated_at'>[] = Array.isArray(body) ? body : [body];

    const ids = await database.bulkUpsertLeads(leads);

    return NextResponse.json({
      success: true,
      data: { insertedIds: ids, count: ids.length },
    });
  } catch (error: any) {
    logger.error(`API POST /api/leads failed: ${error.message}`);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/leads/:id - Delete a lead
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const deleted = await database.deleteLead(params.id);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Lead not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error: any) {
    logger.error(`API DELETE /api/leads/${params.id} failed: ${error.message}`);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/stats - Database statistics
 */
export async function GET_STATS() {
  try {
    const stats = await database.getStats();

    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    logger.error(`API GET /api/stats failed: ${error.message}`);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/search - Trigger a lead search
 */
export async function POST_SEARCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { queries, maxResults, enrich, minScore } = body as {
      queries: SearchQuery[];
      maxResults?: number;
      enrich?: boolean;
      minScore?: number;
    };

    if (!queries || !Array.isArray(queries) || queries.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Queries array is required' },
        { status: 400 }
      );
    }

    // Run search in background
    leadEngine.search({
      queries,
      maxResults,
      enrich,
      minScore,
      continueOnError: true,
    });

    return NextResponse.json({
      success: true,
      message: 'Search started',
    });
  } catch (error: any) {
    logger.error(`API POST /api/search failed: ${error.message}`);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/export - Export leads
 */
export async function POST_EXPORT(request: NextRequest) {
  try {
    const body = await request.json();
    const { format = 'csv', includeScrapedData = false, filters } = body;

    // Get leads
    const result = await database.getLeads(filters || {}, {
      limit: 10000, // Max export size
      sortBy: 'score',
      sortOrder: 'DESC',
    });

    if (result.leads.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No leads to export' },
        { status: 404 }
      );
    }

    const filepath = await Exporter.exportToFile(result.leads, {
      format,
      includeScrapedData,
    });

    return NextResponse.json({
      success: true,
      data: {
        filepath,
        count: result.leads.length,
        filename: path.basename(filepath),
      },
    });
  } catch (error: any) {
    logger.error(`API POST /api/export failed: ${error.message}`);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
