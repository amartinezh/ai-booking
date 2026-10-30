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
import { ResolutionStatus, SurveyExperience } from '@agenia/database';
import { SurveyService } from './survey.service';
import {
  SURVEY_ANSWER_STATUSES,
  SURVEY_SORT_FIELDS,
  SortDir,
  SurveyFilters,
  SurveyListQuery,
  SurveySortField,
  UserMood,
} from './dto/survey-report.types';

// ───────────────────────────────────────────────────────────────
// Helpers de parseo del query string (no hay ValidationPipe global).
// Todo lo que no se reconoce se descarta: nunca llega al WHERE.
// ───────────────────────────────────────────────────────────────
type RawQuery = Record<string, string | string[] | undefined>;

function str(raw: RawQuery, key: string): string | undefined {
  const v = raw?.[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.length > 0 ? s : undefined;
}

function parseEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function parseDay(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

const MOODS = Object.values(UserMood);
const RESOLUTIONS = Object.values(ResolutionStatus);
const EXPERIENCES = Object.values(SurveyExperience);

/** Filtros comunes. `organizationId` solo lo agrega quien puede usarlo. */
export function parseSurveyFilters(raw: RawQuery): SurveyFilters {
  const rating = Number(str(raw, 'rating'));
  const recommend = str(raw, 'recommend');
  return {
    startDate: parseDay(str(raw, 'startDate')),
    endDate: parseDay(str(raw, 'endDate')),
    q: str(raw, 'q')?.slice(0, 100),
    status: parseEnum(str(raw, 'status'), SURVEY_ANSWER_STATUSES),
    rating:
      Number.isInteger(rating) && rating >= 1 && rating <= 5
        ? rating
        : undefined,
    mood: parseEnum(str(raw, 'mood'), MOODS),
    wouldRecommend:
      recommend === 'YES' ? true : recommend === 'NO' ? false : undefined,
    experience: parseEnum(str(raw, 'experience'), EXPERIENCES),
    withComment: str(raw, 'withComment') === 'true' ? true : undefined,
    resolutionStatus: parseEnum(str(raw, 'resolutionStatus'), RESOLUTIONS),
  };
}

export function parseSurveyListQuery(
  raw: RawQuery,
): Omit<SurveyListQuery, 'organizationId'> {
  const sortBy: SurveySortField =
    parseEnum(str(raw, 'sortBy'), SURVEY_SORT_FIELDS) ?? 'createdAt';
  const sortDir: SortDir = str(raw, 'sortDir') === 'asc' ? 'asc' : 'desc';
  return {
    page: Number(str(raw, 'page')) || 1,
    pageSize: Number(str(raw, 'pageSize')) || 25,
    sortBy,
    sortDir,
    ...parseSurveyFilters(raw),
  };
}

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
  getDetailed(@Query() raw: RawQuery = {}) {
    return this.surveyService.findDetailedForSuperAdmin({
      ...parseSurveyListQuery(raw),
      organizationId: str(raw, 'organizationId'),
    });
  }

  // GET /superadmin/surveys/stats
  @Get('stats')
  @Roles('SUPER_ADMIN')
  getStats(@Query() raw: RawQuery = {}) {
    return this.surveyService.getStats({
      ...parseSurveyFilters(raw),
      organizationId: str(raw, 'organizationId'),
    });
  }

  // GET /superadmin/surveys/export
  @Get('export')
  @Roles('SUPER_ADMIN')
  export(@Query() raw: RawQuery = {}) {
    return this.surveyService.exportDetailedForSuperAdmin({
      ...parseSurveyListQuery(raw),
      organizationId: str(raw, 'organizationId'),
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// 🏥 ENDPOINT 2 — DIAGNÓSTICO CLINIC ADMIN (scoped a su clínica)
// ═══════════════════════════════════════════════════════════════
@Controller('organizations/:orgId/surveys')
@UseGuards(RolesGuard)
export class ClinicSurveyController {
  constructor(private readonly surveyService: SurveyService) {}

  // 🔐 SEGURIDAD MULTI-TENANT ESTRICTA: el orgId del token DEBE coincidir
  // con el de la URL. Sin esto, un ORG_ADMIN podría leer encuestas de otra
  // clínica cambiando el :orgId. Prohibido el leak entre tenants.
  private assertOwnOrg(orgId: string, tenantOrgId: string | null | undefined) {
    if (!tenantOrgId || tenantOrgId !== orgId) {
      throw new ForbiddenException(
        'No tienes acceso a las encuestas de esta organización.',
      );
    }
  }

  // GET /organizations/:orgId/surveys/limited
  @Get('limited')
  @Roles('ORG_ADMIN')
  getLimited(
    @Param('orgId') orgId: string,
    @CurrentTenant() tenantOrgId: string,
    @Query() raw: RawQuery = {},
  ) {
    this.assertOwnOrg(orgId, tenantOrgId);
    return this.surveyService.findLimitedForClinic(
      orgId,
      parseSurveyListQuery(raw),
    );
  }

  // GET /organizations/:orgId/surveys/stats
  @Get('stats')
  @Roles('ORG_ADMIN')
  getStats(
    @Param('orgId') orgId: string,
    @CurrentTenant() tenantOrgId: string,
    @Query() raw: RawQuery = {},
  ) {
    this.assertOwnOrg(orgId, tenantOrgId);
    // organizationId SIEMPRE el de la URL ya validada; nunca el del query.
    return this.surveyService.getStats({
      ...parseSurveyFilters(raw),
      organizationId: orgId,
    });
  }

  // GET /organizations/:orgId/surveys/export
  @Get('export')
  @Roles('ORG_ADMIN')
  export(
    @Param('orgId') orgId: string,
    @CurrentTenant() tenantOrgId: string,
    @Query() raw: RawQuery = {},
  ) {
    this.assertOwnOrg(orgId, tenantOrgId);
    return this.surveyService.exportLimitedForClinic(
      orgId,
      parseSurveyListQuery(raw),
    );
  }
}
