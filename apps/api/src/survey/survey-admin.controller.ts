import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { CurrentTenant } from '../common/current-tenant.decorator';
import { ResolutionStatus } from '@antigravity/database';
import { SurveyService } from './survey.service';
import {
  DetailedSurveyQuery,
  LimitedSurveyQuery,
  SortDir,
  SurveySortField,
  UserMood,
} from './dto/survey-report.types';

// ───────────────────────────────────────────────────────────────
// Helpers de parseo del query string (no hay ValidationPipe global).
// ───────────────────────────────────────────────────────────────
function parseSort(sortBy?: string, sortDir?: string): {
  sortBy: SurveySortField;
  sortDir: SortDir;
} {
  return {
    sortBy: sortBy === 'rating' ? 'rating' : 'createdAt',
    sortDir: sortDir === 'asc' ? 'asc' : 'desc',
  };
}

function parseEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

const MOODS = Object.values(UserMood);
const RESOLUTIONS = Object.values(ResolutionStatus);

// ═══════════════════════════════════════════════════════════════
// 🌎 ENDPOINT 1 — DIAGNÓSTICO SUPER ADMIN (acceso global total)
// ═══════════════════════════════════════════════════════════════
@Controller('superadmin/surveys')
@UseGuards(RolesGuard)
export class SuperadminSurveyController {
  constructor(private readonly surveyService: SurveyService) {}

  // GET /superadmin/surveys/detailed
  @Get('detailed')
  @Roles('SUPER_ADMIN')
  getDetailed(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('organizationId') organizationId?: string,
    @Query('mood') mood?: string,
    @Query('resolutionStatus') resolutionStatus?: string,
  ) {
    const query: DetailedSurveyQuery = {
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
      ...parseSort(sortBy, sortDir),
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      organizationId: organizationId || undefined,
      mood: parseEnum(mood, MOODS),
      resolutionStatus: parseEnum(resolutionStatus, RESOLUTIONS),
    };
    return this.surveyService.findDetailedForSuperAdmin(query);
  }
}

// ═══════════════════════════════════════════════════════════════
// 🏥 ENDPOINT 2 — DIAGNÓSTICO CLINIC ADMIN (scoped + minimalista)
// ═══════════════════════════════════════════════════════════════
@Controller('organizations/:orgId/surveys')
@UseGuards(RolesGuard)
export class ClinicSurveyController {
  constructor(private readonly surveyService: SurveyService) {}

  // GET /organizations/:orgId/surveys/limited
  @Get('limited')
  @Roles('ORG_ADMIN')
  getLimited(
    @Param('orgId') orgId: string,
    @CurrentTenant() tenantOrgId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    // 🔐 SEGURIDAD MULTI-TENANT ESTRICTA: el orgId del token DEBE coincidir
    // con el de la URL. Sin esto, un ORG_ADMIN podría leer encuestas de otra
    // clínica cambiando el :orgId. Prohibido el leak entre tenants.
    if (!tenantOrgId || tenantOrgId !== orgId) {
      throw new ForbiddenException(
        'No tienes acceso a las encuestas de esta organización.',
      );
    }

    const query: LimitedSurveyQuery = {
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
      ...parseSort(sortBy, sortDir),
    };
    return this.surveyService.findLimitedForClinic(orgId, query);
  }
}
