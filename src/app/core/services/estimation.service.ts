import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { from, Observable, of } from 'rxjs';
import { catchError, concatMap, delay, map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  AIUseCase,
  AITaskType,
  DeliveryPlatform,
  ProjectInput,
  ProjectScale,
} from '../models/project.model';
import {
  AIvsStandardComparison,
  AzureServiceCost,
  ConfidenceAssessment,
  ConfidenceFactor,
  CostBreakdown,
  Estimation,
  EstimationSSEChunk,
  FeasibilityResult,
  FeasibilitySubScores,
  InfrastructureCost,
  ModelTokenBreakdown,
  Recommendation,
  RecommendationArchetype,
  RepoContext,
  ROICurvePoint,
  ROIProjection,
  TokenProjection,
  UseCaseAnalysis,
  ValueDriver,
  Verdict,
} from '../models/estimation.model';
import { EstimateSummary } from '../models/dashboard.model';
import { MockDataService } from './mock-data.service';
import { archetypeBlurb, archetypeLabel, ratingForScore } from '../../shared/utils/feasibility';

/* ── Rate card (blended USD) ── */
const DEV_HOURLY_RATE = 115;
const MAINT_HOURLY_RATE = 95;
const HOURS_PER_DEV_WEEK = 32; // effective, not nominal

/* ── ROI benefit basis ──
 * value/call = minutes ÷ 60 × loadedHourlyRate × automationRate%, so every
 * figure traces to two defensible dials: the loaded cost of the offset worker
 * and the share of calls AI handles end-to-end (deflection), not a flat 100%. */
const LOADED_HOURLY_RATE = 75;
const AUTOMATION_RATE_PERCENT = 70;

const COMPLEXITY_HOURS: Record<string, number> = {
  low: 24,
  medium: 64,
  high: 130,
  very_high: 240,
};

const PRIORITY_WEIGHT: Record<AIUseCase['priority'], number> = {
  must_have: 1,
  nice_to_have: 0.6,
  exploratory: 0.3,
};

/* ── Model pricing catalog (USD per 1M tokens) ── */
interface ModelPrice {
  provider: string;
  inPer1M: number;
  outPer1M: number;
}
const MODEL_CATALOG: Record<string, ModelPrice> = {
  'gpt-4o': { provider: 'Azure OpenAI', inPer1M: 2.5, outPer1M: 10 },
  'gpt-4o-mini': { provider: 'Azure OpenAI', inPer1M: 0.15, outPer1M: 0.6 },
  'claude-sonnet-4': { provider: 'Anthropic', inPer1M: 3, outPer1M: 15 },
  'claude-haiku': { provider: 'Anthropic', inPer1M: 0.8, outPer1M: 4 },
  'gemini-2-pro': { provider: 'Google', inPer1M: 1.25, outPer1M: 5 },
  'gemini-2-flash': { provider: 'Google', inPer1M: 0.075, outPer1M: 0.3 },
};

/* ── Per-task-type profile: token shape, default model, and scoring weights ── */
interface TaskProfile {
  inTokens: number;
  outTokens: number;
  model: string;
  aiN: number; // contribution to AI-necessity
  agentic: number; // contribution to agentic suitability
  trad: number; // contribution to traditional suitability
  minutesPerCall: number; // minutes of manual work one automated call replaces
}
const TASK_PROFILES: Record<AITaskType, TaskProfile> = {
  text_classification: { inTokens: 800, outTokens: 80, model: 'gpt-4o-mini', aiN: 55, agentic: 20, trad: 70, minutesPerCall: 1 },
  summarization: { inTokens: 4000, outTokens: 600, model: 'gpt-4o-mini', aiN: 66, agentic: 25, trad: 45, minutesPerCall: 4 },
  code_generation: { inTokens: 2500, outTokens: 1200, model: 'claude-sonnet-4', aiN: 80, agentic: 55, trad: 25, minutesPerCall: 20 },
  conversational_agent: { inTokens: 1500, outTokens: 500, model: 'gpt-4o', aiN: 80, agentic: 72, trad: 25, minutesPerCall: 6 },
  rag_qa: { inTokens: 3500, outTokens: 700, model: 'gpt-4o-mini', aiN: 78, agentic: 55, trad: 30, minutesPerCall: 6 },
  multi_agent_orchestration: { inTokens: 6000, outTokens: 2500, model: 'gpt-4o', aiN: 88, agentic: 92, trad: 15, minutesPerCall: 25 },
  document_analysis: { inTokens: 8000, outTokens: 1000, model: 'gpt-4o', aiN: 75, agentic: 50, trad: 35, minutesPerCall: 15 },
  image_analysis: { inTokens: 1200, outTokens: 400, model: 'gpt-4o', aiN: 82, agentic: 35, trad: 30, minutesPerCall: 4 },
  translation: { inTokens: 1000, outTokens: 1000, model: 'gemini-2-flash', aiN: 60, agentic: 20, trad: 55, minutesPerCall: 8 },
  data_extraction: { inTokens: 2000, outTokens: 400, model: 'gpt-4o-mini', aiN: 62, agentic: 35, trad: 60, minutesPerCall: 6 },
  recommendation: { inTokens: 1500, outTokens: 300, model: 'gemini-2-pro', aiN: 70, agentic: 40, trad: 50, minutesPerCall: 3 },
  anomaly_detection: { inTokens: 1000, outTokens: 120, model: 'gemini-2-flash', aiN: 58, agentic: 30, trad: 72, minutesPerCall: 5 },
  // Deterministic capabilities standard software handles best — low AI-necessity so a
  // mostly-deterministic product can honestly land on "Standard" instead of AI-by-default.
  rules_workflow: { inTokens: 600, outTokens: 80, model: 'gpt-4o-mini', aiN: 22, agentic: 12, trad: 88, minutesPerCall: 2 },
  crud_lookup: { inTokens: 400, outTokens: 60, model: 'gpt-4o-mini', aiN: 15, agentic: 8, trad: 92, minutesPerCall: 1 },
  threshold_alerting: { inTokens: 500, outTokens: 60, model: 'gpt-4o-mini', aiN: 28, agentic: 15, trad: 85, minutesPerCall: 2 },
};

const SCALE_INFRA_BASE: Record<ProjectScale, number> = {
  small: 120,
  medium: 320,
  large: 850,
  enterprise: 2200,
};
const SCALE_APIM: Record<ProjectScale, number> = {
  small: 0,
  medium: 50,
  large: 250,
  enterprise: 700,
};
const SCALE_MAINT_HOURS: Record<ProjectScale, number> = {
  small: 12,
  medium: 24,
  large: 48,
  enterprise: 90,
};

/* ── Azure infrastructure catalog (mirrors backend app/azure_catalog.py) ──
 * The offline engine selects services by deterministic rule and prices them
 * from these baselines (priceSource 'estimate'/'fallback'). The backend adds
 * LLM selection + live Retail-Prices refinement on top of the same catalog.
 */
const HOURS_PER_MONTH = 730;
const CALC_BASE = 'https://azure.microsoft.com/en-in/pricing/calculator/?service=';

const SCALE_DEFENDER: Record<ProjectScale, number> = { small: 15, medium: 45, large: 120, enterprise: 300 };
const SCALE_REDIS: Record<ProjectScale, number> = { small: 16, medium: 55, large: 180, enterprise: 410 };
const SCALE_CONTENT_SAFETY: Record<ProjectScale, number> = { small: 8, medium: 20, large: 60, enterprise: 150 };
const SCALE_SERVICE_BUS: Record<ProjectScale, number> = { small: 10, medium: 25, large: 70, enterprise: 160 };
const SCALE_FRONT_DOOR: Record<ProjectScale, number> = { small: 35, medium: 35, large: 120, enterprise: 300 };
const SCALE_DOC_INTEL: Record<ProjectScale, number> = { small: 30, medium: 75, large: 200, enterprise: 480 };
const SCALE_VISION: Record<ProjectScale, number> = { small: 20, medium: 50, large: 140, enterprise: 320 };
const SCALE_TRANSLATOR: Record<ProjectScale, number> = { small: 15, medium: 40, large: 110, enterprise: 260 };
const SCALE_PRIVATE_NET: Record<ProjectScale, number> = { small: 20, medium: 40, large: 90, enterprise: 180 };
const SEARCH_SKU: Record<ProjectScale, [string, number]> = {
  small: ['Basic', 0.101],
  medium: ['Standard S1', 0.336],
  large: ['Standard S1', 0.336],
  enterprise: ['Standard S2', 1.344],
};

const CATEGORY_ORDER = ['Compute', 'AI', 'Data & Storage', 'Integration', 'Security', 'Networking', 'Observability'];

interface InfraCtx {
  scale: ProjectScale;
  dataGB: number;
  requestsPerDay: number;
  dailyUsers: number;
  compliance: string[];
  taskTypes: Set<string>;
  usesAzureOpenAI: boolean;
  projectType: 'new' | 'enhancement';
  monthlyTokenCost: number;
  monthlyTokens: number;
  regionPrimary: string;
  regionOpenAI: string;
  regionSearch: string;
  needsSearch: boolean;
  needsDocIntel: boolean;
  needsVision: boolean;
  needsTranslation: boolean;
  hasMultiAgent: boolean;
  hasAI: boolean;
  hasCompliance: boolean;
}

interface AzureSpec {
  key: string;
  name: string;
  category: string;
  regionKind: 'primary' | 'openai' | 'search';
  pricing: 'estimate' | 'metered' | 'tokens';
  unit: string;
  calc: string;
  included: boolean;
  netNew: boolean;
  select: (c: InfraCtx) => boolean;
  quantity: (c: InfraCtx) => number;
  unitPrice: (c: InfraCtx) => number;
  tier: (c: InfraCtx) => string;
  details: (c: InfraCtx) => string;
}

const AZURE_SPECS: AzureSpec[] = [
  { key: 'app_hosting', name: 'Azure Container Apps', category: 'Compute', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'container-apps', included: true, netNew: false,
    select: () => true, quantity: () => 1, unitPrice: (c) => SCALE_INFRA_BASE[c.scale], tier: (c) => c.scale, details: () => 'App + API hosting, autoscaling' },
  { key: 'openai', name: 'Azure OpenAI', category: 'AI', regionKind: 'openai', pricing: 'tokens', unit: '1M tokens', calc: 'cognitive-services', included: false, netNew: true,
    select: (c) => c.usesAzureOpenAI, quantity: (c) => round2(c.monthlyTokens / 1e6), unitPrice: (c) => (c.monthlyTokens ? round2(c.monthlyTokenCost / Math.max(c.monthlyTokens / 1e6, 1e-9)) : 0), tier: () => 'Standard', details: () => 'Token spend (counted in the AI-tokens line)' },
  { key: 'ai_search', name: 'Azure AI Search', category: 'AI', regionKind: 'search', pricing: 'metered', unit: 'hour', calc: 'search', included: true, netNew: true,
    select: (c) => c.needsSearch, quantity: () => HOURS_PER_MONTH, unitPrice: (c) => SEARCH_SKU[c.scale][1], tier: (c) => SEARCH_SKU[c.scale][0], details: () => 'Vector + keyword retrieval for RAG' },
  { key: 'doc_intel', name: 'Azure AI Document Intelligence', category: 'AI', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'ai-document-intelligence', included: true, netNew: true,
    select: (c) => c.needsDocIntel, quantity: () => 1, unitPrice: (c) => SCALE_DOC_INTEL[c.scale], tier: () => 'Standard', details: () => 'OCR & structured field extraction' },
  { key: 'vision', name: 'Azure AI Vision', category: 'AI', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'cognitive-services', included: true, netNew: true,
    select: (c) => c.needsVision, quantity: () => 1, unitPrice: (c) => SCALE_VISION[c.scale], tier: () => 'Standard', details: () => 'Image analysis & tagging' },
  { key: 'translator', name: 'Azure AI Translator', category: 'AI', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'cognitive-services', included: true, netNew: true,
    select: (c) => c.needsTranslation, quantity: () => 1, unitPrice: (c) => SCALE_TRANSLATOR[c.scale], tier: () => 'Standard', details: () => 'Text translation & localisation' },
  { key: 'content_safety', name: 'Azure AI Content Safety', category: 'AI', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'cognitive-services', included: true, netNew: true,
    select: (c) => c.hasAI, quantity: () => 1, unitPrice: (c) => SCALE_CONTENT_SAFETY[c.scale], tier: () => 'Standard', details: () => 'Moderation & jailbreak guardrails' },
  { key: 'database', name: 'Azure Cosmos DB', category: 'Data & Storage', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'cosmos-db', included: true, netNew: false,
    select: () => true, quantity: () => 1, unitPrice: (c) => round(40 + c.dataGB * 0.25), tier: () => 'Serverless', details: (c) => `~${c.dataGB} GB operational data` },
  { key: 'storage', name: 'Azure Blob Storage', category: 'Data & Storage', regionKind: 'primary', pricing: 'metered', unit: 'GB/mo', calc: 'storage', included: true, netNew: false,
    select: () => true, quantity: (c) => round2(Math.max(100, c.dataGB)), unitPrice: () => 0.0184, tier: () => 'Hot LRS', details: () => 'Artifacts, exports, raw documents' },
  { key: 'redis', name: 'Azure Cache for Redis', category: 'Data & Storage', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'cache', included: true, netNew: false,
    select: (c) => c.scale === 'medium' || c.scale === 'large' || c.scale === 'enterprise', quantity: () => 1, unitPrice: (c) => SCALE_REDIS[c.scale], tier: () => 'Standard', details: () => 'Session & response cache' },
  { key: 'apim', name: 'Azure API Management', category: 'Integration', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'api-management', included: true, netNew: false,
    select: (c) => c.scale === 'medium' || c.scale === 'large' || c.scale === 'enterprise', quantity: () => 1, unitPrice: (c) => SCALE_APIM[c.scale], tier: (c) => c.scale, details: () => 'Gateway, throttling, keys' },
  { key: 'service_bus', name: 'Azure Service Bus', category: 'Integration', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'service-bus', included: true, netNew: true,
    select: (c) => c.hasMultiAgent || c.scale === 'large' || c.scale === 'enterprise', quantity: () => 1, unitPrice: (c) => SCALE_SERVICE_BUS[c.scale], tier: () => 'Standard', details: () => 'Async messaging & orchestration' },
  { key: 'key_vault', name: 'Azure Key Vault', category: 'Security', regionKind: 'primary', pricing: 'metered', unit: '10K ops', calc: 'key-vault', included: true, netNew: true,
    select: () => true, quantity: (c) => round2((c.requestsPerDay * 30 * 2) / 10000), unitPrice: () => 0.03, tier: () => 'Standard', details: () => 'Secrets, keys & certificates' },
  { key: 'defender', name: 'Microsoft Defender for Cloud', category: 'Security', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'security-center', included: true, netNew: false,
    select: () => true, quantity: () => 1, unitPrice: (c) => SCALE_DEFENDER[c.scale], tier: () => 'Standard', details: () => 'Workload protection & posture' },
  { key: 'private_net', name: 'Azure Private Networking', category: 'Networking', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'virtual-network', included: true, netNew: true,
    select: (c) => c.hasCompliance, quantity: () => 1, unitPrice: (c) => SCALE_PRIVATE_NET[c.scale], tier: () => 'Standard', details: () => 'VNet & private endpoints' },
  { key: 'front_door', name: 'Azure Front Door / WAF', category: 'Networking', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'frontdoor', included: true, netNew: false,
    select: (c) => c.scale === 'large' || c.scale === 'enterprise' || c.hasCompliance, quantity: () => 1, unitPrice: (c) => SCALE_FRONT_DOOR[c.scale], tier: () => 'Standard', details: () => 'Global routing, CDN & WAF' },
  { key: 'monitor', name: 'Azure Monitor', category: 'Observability', regionKind: 'primary', pricing: 'estimate', unit: 'month', calc: 'monitor', included: true, netNew: false,
    select: () => true, quantity: () => 1, unitPrice: (c) => round(30 + c.requestsPerDay * 0.00002), tier: () => 'Pay-as-you-go', details: () => 'Telemetry, logs & alerting' },
];

/* ── Delivery-platform cost-model strategies (mirrors backend app/platforms.py) ──
 * The delivery platform selects the cost *shape*, not just a price book:
 *   consumption (Azure/AWS/GCP) · licensing (M365/Copilot) · capex (on-prem).
 */
interface PlatformProfile {
  key: DeliveryPlatform;
  label: string;
  costModel: 'consumption' | 'licensing' | 'capex';
  metersTokens: boolean; // false = AI usage bundled into a per-seat licence
  provider: 'azure' | 'aws' | 'gcp' | null;
  defaultRegion: string;
}

const PLATFORM_PROFILES: Record<DeliveryPlatform, PlatformProfile> = {
  azure_paas: { key: 'azure_paas', label: 'Azure PaaS', costModel: 'consumption', metersTokens: true, provider: 'azure', defaultRegion: 'eastus' },
  aws: { key: 'aws', label: 'Amazon Web Services', costModel: 'consumption', metersTokens: true, provider: 'aws', defaultRegion: 'us-east-1' },
  gcp: { key: 'gcp', label: 'Google Cloud', costModel: 'consumption', metersTokens: true, provider: 'gcp', defaultRegion: 'us-central1' },
  m365_copilot: { key: 'm365_copilot', label: 'Microsoft 365 + Copilot', costModel: 'licensing', metersTokens: false, provider: null, defaultRegion: '' },
  on_prem: { key: 'on_prem', label: 'On-premises / private cloud', costModel: 'capex', metersTokens: true, provider: null, defaultRegion: '' },
};

const DEFAULT_PLATFORM: DeliveryPlatform = 'azure_paas';

// First family whose keyword appears wins.
const PLATFORM_KEYWORDS: [DeliveryPlatform, string[]][] = [
  ['m365_copilot', ['sharepoint', 'microsoft 365', 'm365', 'office 365', 'o365', 'power platform', 'power apps', 'powerapps', 'power automate', 'dataverse', 'copilot studio', 'copilot', 'power bi']],
  ['aws', ['aws', 'amazon web services', 'lambda', 'bedrock', 'dynamodb', 'ec2', 'fargate', 'amazon s3', 's3 bucket', 'eks', 'sagemaker']],
  ['gcp', ['gcp', 'google cloud', 'vertex ai', 'bigquery', 'gke', 'cloud run', 'firebase', 'firestore']],
  ['on_prem', ['on-prem', 'on prem', 'on-premise', 'on premise', 'on-premises', 'bare metal', 'bare-metal', 'vmware', 'data center', 'datacenter', 'data centre', 'self-hosted', 'self hosted', 'private cloud', 'openshift']],
];

const AWS_CALC = 'https://calculator.aws/#/';
const GCP_CALC = 'https://cloud.google.com/products/calculator';

// AWS / GCP service names for each Azure catalog key (consumption overlay).
const PROVIDER_NAMES: Record<'aws' | 'gcp', Record<string, string>> = {
  aws: {
    app_hosting: 'AWS Fargate (ECS)', openai: 'Amazon Bedrock', ai_search: 'Amazon OpenSearch (vector)',
    doc_intel: 'Amazon Textract', vision: 'Amazon Rekognition', translator: 'Amazon Translate',
    content_safety: 'Amazon Bedrock Guardrails', database: 'Amazon DynamoDB', storage: 'Amazon S3',
    redis: 'Amazon ElastiCache (Redis)', apim: 'Amazon API Gateway', service_bus: 'Amazon SQS',
    key_vault: 'AWS Secrets Manager', defender: 'Amazon GuardDuty', private_net: 'Amazon VPC + PrivateLink',
    front_door: 'Amazon CloudFront + WAF', monitor: 'Amazon CloudWatch',
  },
  gcp: {
    app_hosting: 'Cloud Run', openai: 'Vertex AI', ai_search: 'Vertex AI Vector Search',
    doc_intel: 'Document AI', vision: 'Cloud Vision API', translator: 'Cloud Translation',
    content_safety: 'Vertex AI Safety', database: 'Cloud Firestore', storage: 'Cloud Storage',
    redis: 'Memorystore (Redis)', apim: 'Apigee API Management', service_bus: 'Pub/Sub',
    key_vault: 'Secret Manager', defender: 'Security Command Center', private_net: 'VPC Service Controls',
    front_door: 'Cloud CDN + Cloud Armor', monitor: 'Cloud Monitoring',
  },
};

function providerDisplay(provider: PlatformProfile['provider'], specKey: string, azureName: string, azureUrl: string): [string, string | undefined] {
  if (provider === 'aws') return [PROVIDER_NAMES['aws'][specKey] ?? azureName, AWS_CALC];
  if (provider === 'gcp') return [PROVIDER_NAMES['gcp'][specKey] ?? azureName, GCP_CALC];
  return [azureName, azureUrl];
}

// Shared line-item builder for the licensing/capex strategies.
function platformLine(o: {
  name: string; category: string; tier: string; qty: number; unit: string;
  unitPrice: number; details: string; url?: string; included?: boolean; region?: string;
}): AzureServiceCost {
  return {
    serviceName: o.name, category: o.category, tier: o.tier, region: o.region ?? '',
    quantity: round2(o.qty), unit: o.unit, unitPrice: round2(o.unitPrice),
    monthlyCost: round2(o.unitPrice * o.qty), priceSource: 'estimate',
    includedInTotal: o.included ?? true, details: o.details, azurePricingUrl: o.url,
  };
}

/* Licensing strategy: Microsoft 365 + Copilot — per-seat, scales with headcount. */
const M365_E3 = 36.0, M365_E5 = 57.0, COPILOT = 30.0, POWER_APPS = 20.0, AI_BUILDER = 500.0, POWER_AUTOMATE = 100.0;
const M365_PRICING = 'https://www.microsoft.com/microsoft-365/enterprise/microsoft365-plans-and-pricing';
const POWER_PRICING = 'https://www.microsoft.com/power-platform/pricing';

function m365Services(ctx: InfraCtx): AzureServiceCost[] {
  const seats = Math.max(1, ctx.dailyUsers);
  const e5 = ctx.hasCompliance;
  const services: AzureServiceCost[] = [
    platformLine({ name: `Microsoft 365 ${e5 ? 'E5' : 'E3'}`, category: 'Licensing', tier: e5 ? 'E5' : 'E3', qty: seats, unit: 'seat/mo', unitPrice: e5 ? M365_E5 : M365_E3, details: 'Per-seat productivity, SharePoint & security licence', url: M365_PRICING }),
  ];
  if (ctx.hasAI) {
    services.push(platformLine({ name: 'Microsoft 365 Copilot', category: 'AI', tier: 'Add-on', qty: seats, unit: 'seat/mo', unitPrice: COPILOT, details: 'Generative-AI assistant — model usage included (replaces metered tokens)', url: 'https://www.microsoft.com/microsoft-365/copilot' }));
  }
  services.push(platformLine({ name: 'Power Apps Premium', category: 'Compute', tier: 'Per user', qty: seats, unit: 'user/mo', unitPrice: POWER_APPS, details: 'Custom app surface built on Power Platform', url: POWER_PRICING }));
  services.push(platformLine({ name: 'Dataverse capacity', category: 'Data & Storage', tier: 'Database', qty: 1, unit: 'month', unitPrice: round(40 + ctx.dataGB * 5), details: `~${ctx.dataGB} GB Dataverse database & file storage`, url: POWER_PRICING }));
  if (ctx.needsDocIntel || ctx.needsVision || ctx.needsTranslation) {
    services.push(platformLine({ name: 'AI Builder credits', category: 'AI', tier: 'Capacity', qty: 1, unit: 'pack/mo', unitPrice: AI_BUILDER, details: 'Custom forms processing / prediction models', url: POWER_PRICING }));
  }
  if (ctx.hasMultiAgent || ctx.taskTypes.has('rules_workflow')) {
    services.push(platformLine({ name: 'Power Automate (hosted process)', category: 'Integration', tier: 'Per flow', qty: 1, unit: 'month', unitPrice: POWER_AUTOMATE, details: 'Automated workflows & RPA flows', url: POWER_PRICING }));
  }
  return services;
}

/* Capex strategy: on-premises / private cloud — hardware amortized + ops staff. */
const SERVER_AMORT = 250.0, GPU_AMORT = 833.0, OPS_FTE = 12000.0;
const ONPREM_SERVERS: Record<ProjectScale, number> = { small: 2, medium: 4, large: 8, enterprise: 16 };
const ONPREM_GPU: Record<ProjectScale, number> = { small: 1, medium: 2, large: 4, enterprise: 8 };
const ONPREM_OPS: Record<ProjectScale, number> = { small: 0.5, medium: 1.0, large: 2.0, enterprise: 4.0 };
const ONPREM_FACILITIES: Record<ProjectScale, number> = { small: 400, medium: 900, large: 2000, enterprise: 4500 };
const ONPREM_SEC_HW: Record<ProjectScale, number> = { small: 300, medium: 700, large: 1500, enterprise: 3200 };

function onpremServices(ctx: InfraCtx): AzureServiceCost[] {
  const s = ctx.scale;
  const services: AzureServiceCost[] = [
    platformLine({ name: 'Application servers (amortized)', category: 'Compute', tier: 'Capex / 48 mo', qty: ONPREM_SERVERS[s], unit: 'server/mo', unitPrice: SERVER_AMORT, details: 'Rack servers for app + API tier, 4-year amortization' }),
  ];
  if (ctx.hasAI) {
    services.push(platformLine({ name: 'GPU inference servers (amortized)', category: 'AI', tier: 'Capex / 48 mo', qty: ONPREM_GPU[s], unit: 'server/mo', unitPrice: GPU_AMORT, details: 'GPU nodes for self-hosted model inference' }));
  }
  services.push(platformLine({ name: 'Storage array (amortized)', category: 'Data & Storage', tier: 'SAN/NAS', qty: 1, unit: 'month', unitPrice: round(120 + ctx.dataGB * 2), details: `~${ctx.dataGB} GB primary operational storage` }));
  services.push(platformLine({ name: 'Backup & disaster recovery', category: 'Data & Storage', tier: 'Standard', qty: 1, unit: 'month', unitPrice: round(150 + ctx.dataGB), details: 'Offsite backup & DR replication' }));
  if (ctx.hasCompliance) {
    services.push(platformLine({ name: 'Security appliances (amortized)', category: 'Security', tier: 'Capex / 48 mo', qty: 1, unit: 'month', unitPrice: ONPREM_SEC_HW[s], details: 'Firewalls, HSM & compliance hardware' }));
  }
  services.push(platformLine({ name: 'Networking & facilities', category: 'Networking', tier: s, qty: 1, unit: 'month', unitPrice: ONPREM_FACILITIES[s], details: 'Power, cooling, colocation & egress' }));
  services.push(platformLine({ name: 'Operations & SRE staff', category: 'Observability', tier: 'FTE', qty: ONPREM_OPS[s], unit: 'FTE/mo', unitPrice: OPS_FTE, details: 'Dedicated infra ops to run the self-hosted platform' }));
  return services;
}

function platformNotes(platform: DeliveryPlatform): string[] {
  if (platform === 'm365_copilot') {
    return [
      'Cost is licensing-led: it scales with seats (users), not compute hours or requests.',
      'AI usage is bundled into the Microsoft 365 Copilot per-seat add-on, so the metered AI-tokens line is $0 to avoid double-counting.',
      'Microsoft hosts the runtime (SharePoint / Power Platform); there are no app-server or database compute meters.',
    ];
  }
  if (platform === 'on_prem') {
    return [
      'Cost is capex-led: hardware is a capital purchase amortized over 48 months, not a monthly metered bill.',
      'Includes dedicated operations / SRE staffing — self-hosted infrastructure needs people to run it, which cloud folds into the service price.',
      'GPU servers cover self-hosted model inference; if you instead call a hosted LLM API, the AI-tokens line applies on top.',
    ];
  }
  if (platform === 'aws' || platform === 'gcp') {
    const prov = PLATFORM_PROFILES[platform].label;
    return [
      `Consumption model on ${prov}: metered compute × data × AI transactions, same cost shape as Azure with the equivalent ${prov} services.`,
      'Unit prices are deterministic baselines (no live retail-price lookup for this provider yet); quantities are computed from your scale and volume.',
    ];
  }
  return [];
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}
function round(n: number): number {
  return Math.round(n);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ── Confidence scoring constants (mirror engine._DECISION_THRESHOLDS etc.) ── */
const DECISION_THRESHOLDS = [40, 55];
const ARCHETYPE_THRESHOLDS = [35, 55];
const DECISIVE_MARGIN = 15; // distance from a threshold we treat as fully decisive

function impactFor(ratio: number): ConfidenceFactor['impact'] {
  if (ratio >= 0.66) return 'positive';
  if (ratio >= 0.4) return 'neutral';
  return 'negative';
}

@Injectable({ providedIn: 'root' })
export class EstimationService {
  private readonly mock = inject(MockDataService);
  private readonly http = inject(HttpClient);
  private readonly apiBase = environment.apiUrl;
  private readonly store = new Map<string, Estimation>();

  /**
   * Streaming generation against the deterministic backend. Emits a progress
   * chunk per pipeline node, then a final 'complete' chunk carrying the full
   * estimation. If the backend is unreachable, falls back to the in-browser
   * engine so the app still works offline.
   */
  generate(input: ProjectInput): Observable<EstimationSSEChunk> {
    return this.streamFromBackend(input).pipe(catchError(() => this.generateLocal(input)));
  }

  /** POSTs the project to the backend SSE endpoint and parses `data:` chunks. */
  private streamFromBackend(input: ProjectInput): Observable<EstimationSSEChunk> {
    return new Observable<EstimationSSEChunk>((subscriber) => {
      const controller = new AbortController();

      (async () => {
        try {
          const res = await fetch(`${this.apiBase}/estimations/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status}`);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let sawComplete = false;

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let sep: number;
            while ((sep = buffer.indexOf('\n\n')) !== -1) {
              const rawEvent = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);
              const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
              if (!dataLine) continue;
              const json = dataLine.slice(5).trim();
              if (!json) continue;

              const chunk = JSON.parse(json) as EstimationSSEChunk;
              // Cache the final estimation so getById can serve it from memory.
              if (chunk.status === 'complete' && chunk.data?.estimation) {
                const est = chunk.data.estimation as Estimation;
                this.store.set(est.id, est);
                sawComplete = true;
              }
              subscriber.next(chunk);
            }
          }

          if (!sawComplete) throw new Error('Stream ended without a complete chunk');
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();

      return () => controller.abort();
    });
  }

  /**
   * In-browser fallback streaming generation: emits progress chunks per
   * pipeline node, then a final 'complete' chunk carrying the full estimation.
   */
  private generateLocal(input: ProjectInput): Observable<EstimationSSEChunk> {
    const id = `est_${Date.now().toString(36)}`;
    const estimation = this.computeEstimation(input, id, new Date().toISOString());
    this.store.set(id, estimation);

    const steps: EstimationSSEChunk[] = [
      { node: 'intake', status: 'processing', content: 'Parsing project intake…', progress: 10 },
      { node: 'feasibility', status: 'processing', content: 'Scoring AI necessity, agentic & traditional fit…', progress: 35 },
      { node: 'costing', status: 'processing', content: 'Computing development, infra & token costs…', progress: 60 },
      { node: 'comparison', status: 'processing', content: 'Comparing AI vs standard approaches…', progress: 80 },
      { node: 'report', status: 'processing', content: 'Composing the report…', progress: 95 },
      { node: 'report', status: 'complete', content: 'Done', progress: 100, data: { id, estimation } },
    ];

    return from(steps).pipe(concatMap((c, i) => of(c).pipe(delay(i === 0 ? 250 : 550))));
  }

  /**
   * Loads a full estimation: from this session's cache, else the backend, else
   * a synthesised report from a seed summary (offline/demo rows).
   */
  getById(id: string): Observable<Estimation | null> {
    const found = this.store.get(id);
    if (found) return of(found);
    return this.http.get<Estimation>(`${this.apiBase}/estimations/${id}`).pipe(
      tap((est) => this.store.set(est.id, est)),
      map((est) => est as Estimation | null),
      catchError(() =>
        this.mock.getEstimateById(id).pipe(
          map((summary) => (summary ? this.synthesizeFromSummary(summary) : null)),
        ),
      ),
    );
  }

  /** All persisted estimations from the backend (empty list if unreachable). */
  list(): Observable<Estimation[]> {
    return this.http
      .get<Estimation[]>(`${this.apiBase}/estimations`)
      .pipe(catchError(() => of([] as Estimation[])));
  }

  /** Download URL for the server-rendered PDF report. */
  pdfUrl(id: string): string {
    return `${this.apiBase}/estimations/${id}/export/pdf`;
  }

  /** Download URL for the server-rendered Excel workbook. */
  excelUrl(id: string): string {
    return `${this.apiBase}/estimations/${id}/export/excel`;
  }

  /**
   * The catalog's default minutes-of-manual-work a task type's automated call
   * replaces — exposed so the wizard can hint the value being overridden.
   */
  defaultMinutesPerCall(taskType: AITaskType): number {
    return TASK_PROFILES[taskType].minutesPerCall;
  }

  /**
   * Live preview of the derived $/call for the wizard:
   * minutes ÷ 60 × loadedHourlyRate × automationRate%. Mirrors the engine so the
   * number a leader sees while editing equals the one the report computes.
   */
  deriveValuePerCall(minutes: number, loadedHourlyRate: number, automationRatePercent: number): number {
    return round2((minutes / 60) * loadedHourlyRate * (automationRatePercent / 100));
  }

  /* ── Core deterministic engine ──────────────────────────────────── */

  computeEstimation(input: ProjectInput, id: string, generatedAt: string): Estimation {
    const feasibility = this.scoreFeasibility(input);
    const costBreakdown = this.computeCost(input, feasibility);
    const tokenProjection = this.projectTokens(input);
    const comparison = this.compareApproaches(input, feasibility, costBreakdown);
    const roiProjection = this.projectRoi(input, feasibility, costBreakdown);
    const verdict = this.deriveVerdict(feasibility, comparison);
    const confidence = this.assessConfidence(input, feasibility);
    const recommendations = this.buildRecommendations(input, feasibility);

    return {
      id,
      projectId: input.projectName,
      projectName: input.projectName,
      projectType: input.projectType,
      industryDomain: input.industryDomain,
      feasibility,
      verdict,
      confidence,
      costBreakdown,
      tokenProjection,
      comparison,
      roiProjection,
      recommendations,
      reportMarkdown: this.composeMarkdown(input, feasibility, costBreakdown),
      status: 'complete',
      generatedAt,
      repoContext: this.buildRepoContext(input),
    };
  }

  /** Builds the report-facing repo snapshot for enhancement-mode estimates. */
  private buildRepoContext(input: ProjectInput): RepoContext | undefined {
    if (input.projectType !== 'enhancement' || !input.currentArchitecture) return undefined;
    const a = input.currentArchitecture;
    return {
      fullName: input.repoFullName ?? input.repoUrl ?? input.projectName,
      htmlUrl: input.repoUrl ?? '',
      branch: input.repoBranch ?? 'main',
      primaryLanguage: a.language,
      stars: input.repoStars ?? 0,
      fileCount: input.repoFileCount ?? 0,
      architecture: a,
      manifestsFound: input.repoManifests ?? [],
      topics: input.repoTopics ?? [],
    };
  }

  private scoreFeasibility(input: ProjectInput): FeasibilityResult {
    const useCases = input.aiUseCases ?? [];
    const subScores = this.computeSubScores(input);
    const archetype = this.pickArchetype(subScores, useCases);
    const composite = clamp(
      round(0.55 * subScores.aiNecessity + 0.3 * subScores.agenticSuitability + 0.15 * (100 - subScores.traditionalSuitability)),
    );

    const useCaseAnalysis: UseCaseAnalysis[] = useCases.map((uc) => {
      const p = TASK_PROFILES[uc.taskType];
      const cx = p.agentic >= 70 ? 'high' : p.agentic >= 40 ? 'medium' : 'low';
      return {
        useCaseName: uc.name,
        feasibilityScore: clamp(round(p.aiN * 0.6 + p.agentic * 0.4)),
        aiTaskType: uc.taskType,
        justification: `${uc.priority.replace('_', ' ')} · best served by ${p.model} given the ${uc.taskType.replace(/_/g, ' ')} workload.`,
        recommendedModel: p.model,
        complexity: cx,
        recommendedApproach: p.aiN >= 50 ? 'ai' : 'standard',
      };
    });

    return {
      score: composite,
      rating: ratingForScore(composite),
      subScores,
      archetype,
      archetypeLabel: archetypeLabel(archetype),
      archetypeRationale: this.archetypeRationale(archetype, subScores),
      rationale: this.feasibilityRationale(subScores, archetype),
      useCaseAnalysis,
      risks: this.buildRisks(input, archetype),
      opportunities: this.buildOpportunities(archetype, useCases),
    };
  }

  private computeSubScores(input: ProjectInput): FeasibilitySubScores {
    const useCases = input.aiUseCases ?? [];
    if (useCases.length === 0) {
      return { aiNecessity: 18, agenticSuitability: 12, traditionalSuitability: 86 };
    }

    let wSum = 0;
    let aiN = 0;
    let agentic = 0;
    let trad = 0;
    let hasMultiAgent = false;
    for (const uc of useCases) {
      const p = TASK_PROFILES[uc.taskType];
      const w = PRIORITY_WEIGHT[uc.priority];
      wSum += w;
      aiN += p.aiN * w;
      agentic += p.agentic * w;
      trad += p.trad * w;
      if (uc.taskType === 'multi_agent_orchestration') hasMultiAgent = true;
    }
    aiN /= wSum;
    agentic /= wSum;
    trad /= wSum;

    // Feature signal: share of features flagged as AI candidates nudges necessity up.
    const features = input.features ?? [];
    const aiCandidateRatio = features.length ? features.filter((f) => f.aiCandidate).length / features.length : 0.5;
    aiN += (aiCandidateRatio - 0.5) * 16;

    // Interdependence: more must-have use cases boosts agentic suitability.
    const mustHaves = useCases.filter((u) => u.priority === 'must_have').length;
    agentic += Math.min(mustHaves, 4) * 4;
    if (hasMultiAgent) agentic += 8;

    // Fewer/simpler AI use cases means traditional stays viable.
    if (useCases.length <= 1) trad += 10;

    return {
      aiNecessity: clamp(round(aiN)),
      agenticSuitability: clamp(round(agentic)),
      traditionalSuitability: clamp(round(trad)),
    };
  }

  private pickArchetype(s: FeasibilitySubScores, useCases: AIUseCase[]): RecommendationArchetype {
    const hasMultiAgent = useCases.some((u) => u.taskType === 'multi_agent_orchestration');
    const hasRetrieval = useCases.some((u) => u.taskType === 'rag_qa' || u.taskType === 'document_analysis');

    if (s.aiNecessity < 35) return 'traditional';
    if (s.aiNecessity < 55) return 'traditional_plus_ai';

    if (s.agenticSuitability >= 72 && hasMultiAgent) return 'multi_agent';
    if (s.agenticSuitability >= 58) return 'single_agent';
    if (hasRetrieval) return 'rag_assistant';
    if (s.traditionalSuitability >= 50) return 'hybrid';
    return 'rag_assistant';
  }

  private archetypeRationale(a: RecommendationArchetype, s: FeasibilitySubScores): string {
    return `AI-necessity ${s.aiNecessity}, agentic-suitability ${s.agenticSuitability}, traditional-suitability ${s.traditionalSuitability}. ${archetypeBlurb(a)}`;
  }

  private feasibilityRationale(s: FeasibilitySubScores, a: RecommendationArchetype): string {
    if (a === 'traditional') {
      return 'The workload is well-defined and deterministic. AI would add operating cost and unpredictability without a clear accuracy or value gain.';
    }
    if (a === 'multi_agent') {
      return 'Multiple interdependent, multi-step tasks benefit from specialised agents coordinating — the value of autonomy outweighs the added orchestration cost.';
    }
    return `A measured AI investment is justified here (necessity ${s.aiNecessity}/100), with the recommended pattern keeping run-cost proportional to the value delivered.`;
  }

  /**
   * Resolves the rate card / resourcing dials: an org's overrides win, else the
   * platform baselines. An absent `costAssumptions` reproduces default numbers.
   */
  private resolveAssumptions(input: ProjectInput): {
    devRate: number;
    maintRate: number;
    hoursPerWeek: number;
    loadedRate: number;
    automationPct: number;
  } {
    const ca = input.costAssumptions;
    return {
      devRate: ca?.devHourlyRate ?? DEV_HOURLY_RATE,
      maintRate: ca?.maintHourlyRate ?? MAINT_HOURLY_RATE,
      hoursPerWeek: ca?.effectiveHoursPerWeek ?? HOURS_PER_DEV_WEEK,
      loadedRate: ca?.loadedHourlyRate ?? LOADED_HOURLY_RATE,
      automationPct: ca?.automationRatePercent ?? AUTOMATION_RATE_PERCENT,
    };
  }

  private computeCost(input: ProjectInput, feas: FeasibilityResult): CostBreakdown {
    const features = input.features ?? [];
    const useCases = input.aiUseCases ?? [];
    const currency = input.technicalPreferences?.budgetCurrency || 'USD';
    const { devRate, maintRate } = this.resolveAssumptions(input);

    // Development: feature build + AI integration per use case.
    const featureBreakdown = features.map((f) => {
      const hours = COMPLEXITY_HOURS[f.complexity] ?? 64;
      return { category: f.name, hours, cost: round(hours * devRate) };
    });
    const aiIntegrationHours = useCases.reduce((sum, uc) => {
      const base = uc.priority === 'must_have' ? 80 : uc.priority === 'nice_to_have' ? 48 : 28;
      const cx = TASK_PROFILES[uc.taskType].agentic >= 70 ? 1.4 : 1;
      return sum + base * cx;
    }, 0);
    if (aiIntegrationHours > 0) {
      featureBreakdown.push({
        category: 'AI integration & evaluation',
        hours: round(aiIntegrationHours),
        cost: round(aiIntegrationHours * devRate),
      });
    }
    // Enhancement mode: integrating into a live codebase (wiring, API/auth
    // alignment, regression-safe rollout) is real work the greenfield path
    // doesn't have. Kept as its own line so we never double-count features.
    if (input.projectType === 'enhancement') {
      const framework = input.currentArchitecture?.framework || 'existing app';
      const integrationHours = round(40 + useCases.length * 24);
      featureBreakdown.push({
        category: `Integrate with existing ${framework}`,
        hours: integrationHours,
        cost: round(integrationHours * devRate),
      });
    }
    const totalDevHours = featureBreakdown.reduce((s, b) => s + b.hours, 0);
    const developmentCost = round(totalDevHours * devRate);

    // Tokens (monthly) — computed first; infra needs the token totals.
    const modelBreakdown = this.modelTokenBreakdown(input);
    const monthlyTokenCost = round2(modelBreakdown.reduce((s, m) => s + m.monthlyCost, 0));
    const monthlyTokens = modelBreakdown.reduce((s, m) => s + m.monthlyInputTokens + m.monthlyOutputTokens, 0);

    // Infrastructure — the delivery platform selects the cost *model*. On a
    // licensing platform (M365/Copilot) AI usage is bundled into the per-seat
    // Copilot add-on, so the metered token line is zeroed to avoid double
    // counting (token volumes are still reported for transparency).
    const scale = input.scale ?? 'medium';
    const platform = this.classifyPlatform(input);
    const profile = PLATFORM_PROFILES[platform];
    const infrastructure = this.computeInfrastructure(input, modelBreakdown, monthlyTokenCost, monthlyTokens, platform);
    const infraMonthly = infrastructure.monthlyCost;

    const tokenFactor = profile.metersTokens ? 1 : 0;
    const tokenCost = round2(monthlyTokenCost * tokenFactor);
    const tokenBreakdown =
      tokenFactor === 1 ? modelBreakdown : modelBreakdown.map((m) => ({ ...m, monthlyCost: 0 }));

    // Maintenance.
    const maintHours = (SCALE_MAINT_HOURS[scale] ?? 24) + useCases.length * 4;
    const maintMonthly = round(maintHours * maintRate);

    // First-year total (one-off dev + 12 months run).
    const annualRun = (infraMonthly + tokenCost + maintMonthly) * 12;
    const expected = round(developmentCost + annualRun);

    return {
      development: {
        aiIntegrationHours: round(aiIntegrationHours),
        hourlyRate: devRate,
        totalCost: developmentCost,
        breakdown: featureBreakdown,
      },
      infrastructure,
      aiTokens: {
        monthlyTokens: { optimistic: round(monthlyTokens * 0.7), expected: round(monthlyTokens), pessimistic: round(monthlyTokens * 1.6) },
        monthlyCost: { optimistic: round2(tokenCost * 0.7), expected: tokenCost, pessimistic: round2(tokenCost * 1.6) },
        annualCost: { optimistic: round2(tokenCost * 0.7 * 12), expected: round2(tokenCost * 12), pessimistic: round2(tokenCost * 1.6 * 12) },
        modelBreakdown: tokenBreakdown,
      },
      maintenance: {
        monthlyHours: maintHours,
        hourlyRate: maintRate,
        monthlyCost: maintMonthly,
        annualCost: maintMonthly * 12,
        includes: ['Prompt & model upkeep', 'Monitoring & cost guardrails', 'Eval regression checks', 'Dependency updates'],
      },
      total: { min: round(expected * 0.82), expected, max: round(expected * 1.35) },
      currency,
    };
  }

  /** Pick the delivery platform: explicit choice first, else keyword inference. */
  private classifyPlatform(input: ProjectInput): DeliveryPlatform {
    const tp = input.technicalPreferences;
    if (tp?.deliveryPlatform) return tp.deliveryPlatform;
    const haystack = [
      tp?.existingInfra ?? '',
      tp?.preferredLLMProvider ?? '',
      input.currentArchitecture?.hostingPlatform ?? '',
      input.integrationConstraints?.deploymentTarget ?? '',
      input.description ?? '',
    ]
      .join(' ')
      .toLowerCase();
    for (const [key, keywords] of PLATFORM_KEYWORDS) {
      if (keywords.some((kw) => haystack.includes(kw))) return key;
    }
    return DEFAULT_PLATFORM;
  }

  /**
   * Build the infrastructure cost lines for the project's delivery platform.
   * Dispatches on the platform's cost *model*: consumption (Azure/AWS/GCP) reuses
   * the catalog + planner; licensing (M365/Copilot) and capex (on-prem) build
   * their own deterministic line items. Offline mirror of the backend engine —
   * rule-based selection only (no LLM, no live Retail-Prices lookup).
   */
  private computeInfrastructure(
    input: ProjectInput,
    modelBreakdown: ModelTokenBreakdown[],
    monthlyTokenCost: number,
    monthlyTokens: number,
    platform: DeliveryPlatform,
  ): InfrastructureCost {
    const tp = input.technicalPreferences;
    const taskTypes = new Set((input.aiUseCases ?? []).map((u) => u.taskType));
    const usesAzureOpenAI = modelBreakdown.some((m) => MODEL_CATALOG[m.model]?.provider === 'Azure OpenAI');
    const primary = tp?.azureRegion || 'eastus';
    const ctx: InfraCtx = {
      scale: input.scale ?? 'medium',
      dataGB: input.volumeAndScale?.dataVolumeGB ?? 10,
      requestsPerDay: input.volumeAndScale?.requestsPerDay ?? 1000,
      dailyUsers: input.volumeAndScale?.expectedDailyUsers ?? 100,
      compliance: tp?.complianceRequirements ?? [],
      taskTypes,
      usesAzureOpenAI,
      projectType: input.projectType,
      monthlyTokenCost,
      monthlyTokens,
      regionPrimary: primary,
      regionOpenAI: tp?.azureOpenAIRegion || primary,
      regionSearch: tp?.azureSearchRegion || primary,
      needsSearch: taskTypes.has('rag_qa') || taskTypes.has('document_analysis'),
      needsDocIntel: taskTypes.has('document_analysis') || taskTypes.has('data_extraction'),
      needsVision: taskTypes.has('image_analysis'),
      needsTranslation: taskTypes.has('translation'),
      hasMultiAgent: taskTypes.has('multi_agent_orchestration'),
      hasAI: taskTypes.size > 0 || usesAzureOpenAI,
      hasCompliance: (tp?.complianceRequirements?.length ?? 0) > 0,
    };

    const profile = PLATFORM_PROFILES[platform];
    const services =
      profile.costModel === 'consumption'
        ? this.consumptionServices(ctx, profile)
        : platform === 'm365_copilot'
          ? m365Services(ctx)
          : onpremServices(ctx);

    const monthlyCost = round(services.filter((s) => s.includedInTotal).reduce((s, x) => s + x.monthlyCost, 0));
    return {
      monthlyCost,
      annualCost: monthlyCost * 12,
      services,
      platform: profile.key,
      platformLabel: profile.label,
      costModel: profile.costModel,
      metersTokens: profile.metersTokens,
      notes: platformNotes(platform),
    };
  }

  /** Catalog/planner-driven consumption lines (Azure/AWS/GCP). */
  private consumptionServices(ctx: InfraCtx, profile: PlatformProfile): AzureServiceCost[] {
    const isAzure = profile.provider === 'azure';

    // Enhancement mode counts only net-new services on top of the existing app.
    const candidates = ctx.projectType === 'enhancement' ? AZURE_SPECS.filter((s) => s.netNew) : AZURE_SPECS;
    const candidateKeys = new Set(candidates.map((s) => s.key));
    const chosen = new Set(candidates.filter((s) => s.select(ctx)).map((s) => s.key));
    // Mandatory floor (mirrors the backend guardrails).
    if (ctx.projectType !== 'enhancement') {
      for (const k of ['app_hosting', 'database', 'monitor']) if (candidateKeys.has(k)) chosen.add(k);
    }
    if (ctx.usesAzureOpenAI && candidateKeys.has('openai')) chosen.add('openai');
    if (ctx.needsSearch && candidateKeys.has('ai_search')) chosen.add('ai_search');

    const regionFor = (kind: AzureSpec['regionKind']) =>
      kind === 'openai' ? ctx.regionOpenAI : kind === 'search' ? ctx.regionSearch : ctx.regionPrimary;

    return AZURE_SPECS.filter((s) => chosen.has(s.key))
      .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || AZURE_SPECS.indexOf(a) - AZURE_SPECS.indexOf(b))
      .map((spec) => {
        const qty = spec.quantity(ctx);
        const unitPrice = spec.unitPrice(ctx);
        const [name, url] = providerDisplay(profile.provider, spec.key, spec.name, CALC_BASE + spec.calc);
        return {
          serviceName: name,
          category: spec.category,
          tier: spec.tier(ctx),
          region: isAzure ? regionFor(spec.regionKind) : profile.defaultRegion,
          quantity: round2(qty),
          unit: spec.unit,
          unitPrice: round2(unitPrice),
          monthlyCost: round2(unitPrice * qty),
          priceSource: spec.pricing === 'estimate' ? 'estimate' : 'fallback',
          includedInTotal: spec.included,
          details: spec.details(ctx),
          azurePricingUrl: url,
        } satisfies AzureServiceCost;
      });
  }

  private modelTokenBreakdown(input: ProjectInput): ModelTokenBreakdown[] {
    const useCases = input.aiUseCases ?? [];
    if (useCases.length === 0) return [];
    const totalRequestsPerDay = Math.max(input.volumeAndScale?.requestsPerDay ?? 1000, useCases.length);

    // Distribute daily requests across use cases by priority weight.
    const weights = useCases.map((u) => PRIORITY_WEIGHT[u.priority]);
    const wTotal = weights.reduce((a, b) => a + b, 0);

    // Group by model.
    const byModel = new Map<string, { useCases: string[]; inTok: number; outTok: number }>();
    useCases.forEach((uc, i) => {
      const p = TASK_PROFILES[uc.taskType];
      const dailyReq = (totalRequestsPerDay * weights[i]) / wTotal;
      const monthlyReq = dailyReq * 30;
      const entry = byModel.get(p.model) ?? { useCases: [], inTok: 0, outTok: 0 };
      entry.useCases.push(uc.name);
      entry.inTok += monthlyReq * p.inTokens;
      entry.outTok += monthlyReq * p.outTokens;
      byModel.set(p.model, entry);
    });

    return [...byModel.entries()].map(([model, e]) => {
      const price = MODEL_CATALOG[model];
      const monthlyCost = round2((e.inTok / 1e6) * price.inPer1M + (e.outTok / 1e6) * price.outPer1M);
      return {
        model,
        useCases: e.useCases,
        monthlyInputTokens: round(e.inTok),
        monthlyOutputTokens: round(e.outTok),
        monthlyCost,
        inputPricePer1M: price.inPer1M,
        outputPricePer1M: price.outPer1M,
      };
    });
  }

  private projectTokens(input: ProjectInput): TokenProjection {
    const breakdown = this.modelTokenBreakdown(input);
    const monthly = breakdown.reduce((s, m) => s + m.monthlyInputTokens + m.monthlyOutputTokens, 0);
    const daily = monthly / 30;
    const mk = (base: number) => ({ optimistic: round(base * 0.7), expected: round(base), pessimistic: round(base * 1.6) });

    const useCases = input.aiUseCases ?? [];
    const modelRecommendations = useCases.map((uc) => {
      const p = TASK_PROFILES[uc.taskType];
      const cat = MODEL_CATALOG[p.model];
      return {
        useCase: uc.name,
        provider: cat.provider,
        recommendedModel: p.model,
        rationale: `${uc.taskType.replace(/_/g, ' ')} ≈ ${p.inTokens}/${p.outTokens} in/out tokens per call.`,
        avgInputTokens: p.inTokens,
        avgOutputTokens: p.outTokens,
      };
    });

    return {
      daily: mk(daily),
      monthly: mk(monthly),
      annual: mk(monthly * 12),
      modelRecommendations,
      assumptions: [
        `${input.volumeAndScale?.requestsPerDay ?? 1000} requests/day at launch`,
        `${input.volumeAndScale?.growthRatePercent ?? 0}% projected growth`,
        'Pessimistic scenario assumes 60% higher volume and longer contexts',
      ],
    };
  }

  private compareApproaches(input: ProjectInput, feas: FeasibilityResult, cost: CostBreakdown): AIvsStandardComparison {
    const { devRate, hoursPerWeek } = this.resolveAssumptions(input);
    const aiTotal = cost.total;
    const aiMonthlyRun = cost.infrastructure.monthlyCost + cost.aiTokens.monthlyCost.expected + cost.maintenance.monthlyCost;
    const aiDevHours = cost.development.breakdown.reduce((s, b) => s + b.hours, 0);
    const aiTeam = Math.max(2, Math.ceil(aiDevHours / (hoursPerWeek * 8)));
    const aiWeeks = Math.max(4, round(aiDevHours / (hoursPerWeek * aiTeam)));

    // Standard build: to reach parity, traditional effort scales with how much AI was carrying the load.
    const reliance = feas.subScores.aiNecessity / 100;
    const stdDevHours = round(aiDevHours * (0.85 + reliance * 0.8)); // more manual work where AI did heavy lifting
    const stdDevCost = round(stdDevHours * devRate);
    const stdMonthlyRun = round(cost.infrastructure.monthlyCost * 0.5 + cost.maintenance.monthlyCost * 0.8);
    const stdTeam = Math.max(2, Math.ceil(stdDevHours / (hoursPerWeek * 8)));
    const stdWeeks = Math.max(4, round(stdDevHours / (hoursPerWeek * stdTeam)));
    const stdExpected = round(stdDevCost + stdMonthlyRun * 12);

    let recommendation: 'ai' | 'hybrid' | 'standard' = feas.score >= 55 ? 'ai' : feas.score >= 40 ? 'hybrid' : 'standard';
    // A genuinely mixed product — some capabilities AI-led, some standard-led — is
    // "hybrid" by definition. Don't let a borderline composite brand it all-standard
    // while the per-capability split still shows an AI-led feature.
    const approaches = feas.useCaseAnalysis.map((u) => u.recommendedApproach);
    const isMixed = approaches.includes('ai') && approaches.includes('standard');
    if (isMixed && recommendation === 'standard' && feas.score >= 30) {
      recommendation = 'hybrid';
    }

    const dimensions = [
      { dimension: 'Time to market', aiScore: clamp(round(5 + reliance * 4), 0, 10), standardScore: clamp(round(8 - reliance * 3), 0, 10), notes: 'AI accelerates ambiguous tasks; standard is faster for well-specified ones.' },
      { dimension: 'Accuracy on fuzzy input', aiScore: clamp(round(4 + reliance * 5), 0, 10), standardScore: clamp(round(8 - reliance * 5), 0, 10), notes: 'Unstructured input favours AI.' },
      { dimension: 'Run cost', aiScore: clamp(round(9 - reliance * 4), 0, 10), standardScore: 9, notes: 'Tokens add ongoing cost the standard build avoids.' },
      { dimension: 'Scalability', aiScore: 8, standardScore: 7, notes: 'Both scale on Azure; AI adds token-budget management.' },
      { dimension: 'Maintainability', aiScore: clamp(round(7 - reliance * 2), 0, 10), standardScore: 7, notes: 'Prompt/model drift needs evals; rules need manual upkeep.' },
      { dimension: 'Flexibility', aiScore: clamp(round(6 + reliance * 4), 0, 10), standardScore: clamp(round(6 - reliance * 2), 0, 10), notes: 'AI adapts to new cases with less re-coding.' },
    ];

    return {
      aiApproach: {
        totalCost: aiTotal,
        timelineWeeks: aiWeeks,
        teamSize: aiTeam,
        benefits: ['Handles unstructured & ambiguous input', 'Faster to adapt to new cases', 'Higher ceiling on automation'],
        challenges: ['Ongoing token cost', 'Needs evaluation & guardrails', 'Output variability to manage'],
        monthlyRunCost: round(aiMonthlyRun),
      },
      standardApproach: {
        totalCost: { min: round(stdExpected * 0.85), expected: stdExpected, max: round(stdExpected * 1.3) },
        timelineWeeks: stdWeeks,
        teamSize: stdTeam,
        benefits: ['Predictable, testable behaviour', 'No per-request token cost', 'Simpler compliance story'],
        challenges: ['Brittle on unstructured input', 'More manual rules to maintain', 'Lower automation ceiling'],
        monthlyRunCost: stdMonthlyRun,
      },
      summary:
        recommendation === 'ai'
          ? 'AI delivers materially more value here than a standard build, and the run-cost premium is justified.'
          : recommendation === 'hybrid'
            ? 'A hybrid split — AI on the fuzzy parts, standard software elsewhere — gives the best cost/value balance.'
            : 'A standard build meets the requirement at lower total cost; reserve AI for a later, targeted phase.',
      recommendation,
      recommendationRationale: feas.archetypeRationale,
      dimensions,
    };
  }

  /**
   * Deterministic ROI: benefit = automated calls × per-task-type value of the
   * manual work they replace (architect-overridable per use case); run cost
   * mirrors the first-year operating total. Exact twin of engine.project_roi.
   */
  private projectRoi(input: ProjectInput, _feas: FeasibilityResult, cost: CostBreakdown): ROIProjection {
    const useCases = input.aiUseCases ?? [];
    const developmentCost = cost.development.totalCost;
    const aiMonthlyRun = cost.infrastructure.monthlyCost + cost.aiTokens.monthlyCost.expected + cost.maintenance.monthlyCost;
    const annualRunCost = round2(aiMonthlyRun * 12);

    const { loadedRate, automationPct } = this.resolveAssumptions(input);
    const valueDrivers: ValueDriver[] = [];
    let annualBenefit = 0;
    if (useCases.length) {
      const totalRequestsPerDay = Math.max(input.volumeAndScale?.requestsPerDay ?? 1000, useCases.length);
      const weights = useCases.map((u) => PRIORITY_WEIGHT[u.priority]);
      const wTotal = weights.reduce((a, b) => a + b, 0);
      useCases.forEach((uc, i) => {
        const p = TASK_PROFILES[uc.taskType];
        const dailyReq = (totalRequestsPerDay * weights[i]) / wTotal;
        const annualCalls = round(dailyReq * 365);
        // A flat valuePerCall override bypasses the derivation (no decomposition);
        // otherwise build the per-call dollar bottom-up from minutes saved.
        const driver: ValueDriver =
          uc.valuePerCall != null
            ? { useCase: uc.name, valuePerCall: uc.valuePerCall, annualCalls, annualValue: 0 }
            : (() => {
                const minutesPerCall = uc.minutesPerCall ?? p.minutesPerCall;
                const valuePerCall = round2((minutesPerCall / 60) * loadedRate * (automationPct / 100));
                return {
                  useCase: uc.name,
                  valuePerCall,
                  annualCalls,
                  annualValue: 0,
                  minutesPerCall,
                  loadedHourlyRate: loadedRate,
                  automationRatePercent: automationPct,
                };
              })();
        driver.annualValue = round2(annualCalls * driver.valuePerCall);
        annualBenefit += driver.annualValue;
        valueDrivers.push(driver);
      });
    }
    annualBenefit = round2(annualBenefit);

    const netAnnualBenefit = round2(annualBenefit - annualRunCost);
    const paybackMonths = netAnnualBenefit > 0 ? round2(developmentCost / (netAnnualBenefit / 12)) : null;

    const totalInvestment3yr = developmentCost + annualRunCost * 3;
    const threeYearValue = round2(annualBenefit * 3 - totalInvestment3yr);
    const roiPercent = totalInvestment3yr > 0 ? round((threeYearValue / totalInvestment3yr) * 100) : 0;

    const curve: ROICurvePoint[] = [];
    for (let m = 0; m <= 36; m += 3) {
      curve.push({ month: m, cumulativeNet: round2(netAnnualBenefit * (m / 12) - developmentCost) });
    }

    return {
      annualBenefit,
      annualRunCost,
      developmentCost,
      netAnnualBenefit,
      paybackMonths,
      threeYearValue,
      roiPercent,
      curve,
      valueDrivers,
      assumptions: [
        'Benefit/call = minutes saved ÷ 60 × loaded labour rate × automation rate.',
        `Loaded labour rate $${round(loadedRate).toLocaleString('en-US')}/hr; automation rate ${round(automationPct)}% of calls handled end-to-end.`,
        `${input.volumeAndScale?.requestsPerDay ?? 1000} requests/day at launch, distributed across use cases by priority.`,
        'Run cost mirrors the first-year operating total (infra + tokens + maintenance).',
        'Three-year view holds volume and pricing flat — no growth or discounting applied.',
      ],
    };
  }

  /**
   * Collapses the analysis into one actionable decision — including the honest
   * "don't use AI" — keyed on the AI-vs-standard recommendation plus the
   * traditional-only archetype guard. Exact twin of engine.derive_verdict.
   */
  private deriveVerdict(feas: FeasibilityResult, comparison: AIvsStandardComparison): Verdict {
    const label = feas.archetypeLabel;
    const rec = comparison.recommendation; // 'ai' | 'hybrid' | 'standard'

    if (rec === 'standard' || feas.archetype === 'traditional') {
      return {
        decision: 'do_not_use_ai',
        headline: "Don't build this with AI",
        oneLiner:
          'Standard software solves this at lower cost and risk; revisit AI only with a sharper, measured use case.',
        disposition: 'stop',
        recommendAi: false,
      };
    }
    if (rec === 'ai') {
      return {
        decision: 'build_with_ai',
        headline: 'Build this with AI',
        oneLiner: `A measured AI investment pays off here — build it as a ${label}.`,
        disposition: 'go',
        recommendAi: true,
      };
    }
    return {
      decision: 'hybrid',
      headline: 'Take a hybrid approach',
      oneLiner: `Use AI only where it clearly pays — a ${label} blend beats going all-in or skipping it.`,
      disposition: 'caution',
      recommendAi: true,
    };
  }

  /**
   * Scores how much weight to place on this estimate (0–100, deterministic):
   * requirements detail + volume certainty + recommendation margin + grounding.
   * Exact twin of engine.assess_confidence.
   */
  private assessConfidence(input: ProjectInput, feas: FeasibilityResult): ConfidenceAssessment {
    // Factor A — requirements detail: are the descriptive inputs substantive?
    const detailSignals = [
      (input.description ?? '').trim().length >= 30,
      (input.features ?? []).length > 0,
      (input.targetUsers ?? '').trim().length > 0,
      (input.industryDomain ?? '').trim().length > 0,
    ];
    const ratioDetail = detailSignals.filter(Boolean).length / detailSignals.length;

    // Factor B — volume certainty: are the usage drivers given, or defaulted?
    const vs = input.volumeAndScale;
    const volumeSignals = [
      vs?.requestsPerDay != null,
      vs?.dataVolumeGB != null,
      vs?.expectedDailyUsers != null,
      vs?.growthRatePercent != null,
    ];
    const ratioVolume = volumeSignals.filter(Boolean).length / volumeSignals.length;

    // Factor C — decisiveness: how far the scores sit from the decision lines.
    const score = feas.score;
    const aiN = feas.subScores.aiNecessity;
    const distScore = Math.min(...DECISION_THRESHOLDS.map((t) => Math.abs(score - t)));
    const distNec = Math.min(...ARCHETYPE_THRESHOLDS.map((t) => Math.abs(aiN - t)));
    const ratioDecisive =
      (clamp(distScore / DECISIVE_MARGIN, 0, 1) + clamp(distNec / DECISIVE_MARGIN, 0, 1)) / 2;

    // Factor D — grounding: an analyzed codebase beats a greenfield guess.
    const grounded = input.projectType === 'enhancement' && input.currentArchitecture != null;
    const ratioGround = grounded ? 1.0 : 0.5;

    const raw = 100 * (0.3 * ratioDetail + 0.3 * ratioVolume + 0.3 * ratioDecisive + 0.1 * ratioGround);
    const scoreOut = clamp(round(raw), 0, 100);
    const level = scoreOut >= 70 ? 'high' : scoreOut >= 45 ? 'medium' : 'low';

    const factors: ConfidenceFactor[] = [
      {
        label: 'Requirements detail',
        detail:
          ratioDetail >= 0.66
            ? 'Project, features and audience are well described.'
            : 'Some descriptive inputs are thin — add features and context to sharpen the build estimate.',
        impact: impactFor(ratioDetail),
      },
      {
        label: 'Volume certainty',
        detail:
          ratioVolume >= 0.66
            ? 'Usage volumes were specified, anchoring the token and ROI math.'
            : 'Several usage figures fall back to defaults, so run-cost and ROI are indicative.',
        impact: impactFor(ratioVolume),
      },
      {
        label: 'Recommendation margin',
        detail:
          ratioDecisive >= 0.66
            ? 'The feasibility score sits clear of the decision thresholds.'
            : 'The feasibility score is near a decision threshold; small input changes could shift the call.',
        impact: impactFor(ratioDecisive),
      },
      {
        label: 'Grounding',
        detail: grounded
          ? 'Grounded in an analyzed existing codebase.'
          : 'Greenfield estimate with no existing system to measure against.',
        impact: impactFor(ratioGround),
      },
    ];

    const rationale = {
      high: 'Inputs are detailed and the recommendation sits clear of the decision thresholds, so these figures are dependable for planning.',
      medium: 'The core inputs are present but some assumptions rely on defaults; treat the figures as directional and firm up the weak spots.',
      low: 'Several inputs are missing or the recommendation is near a decision boundary; gather more detail before committing budget.',
    }[level];

    return { level, score: scoreOut, rationale, factors };
  }

  private buildRisks(input: ProjectInput, a: RecommendationArchetype) {
    const risks = [];
    if (a !== 'traditional') {
      risks.push({ category: 'Cost', description: 'Token spend can grow faster than usage if contexts or retries balloon.', severity: 'medium' as const, mitigation: 'Set per-feature token budgets, cache, and alert on cost-per-request.' });
      risks.push({ category: 'Quality', description: 'Model output variability may surface incorrect or inconsistent results.', severity: 'high' as const, mitigation: 'Add an eval suite, human-in-the-loop on high-stakes paths, and guardrails.' });
    }
    if (a === 'multi_agent') {
      risks.push({ category: 'Complexity', description: 'Multi-agent orchestration adds failure modes and debugging surface.', severity: 'high' as const, mitigation: 'Start with the smallest agent set; add tracing and step-level retries.' });
    }
    const compliance = input.technicalPreferences?.complianceRequirements ?? [];
    if (compliance.length) {
      risks.push({ category: 'Compliance', description: `Data handling must satisfy: ${compliance.join(', ')}.`, severity: 'high' as const, mitigation: 'Use private/regional model endpoints and data-residency-aware storage.' });
    }
    if (risks.length === 0) {
      risks.push({ category: 'Scope', description: 'Requirements are deterministic; main risk is over-engineering.', severity: 'low' as const, mitigation: 'Ship the standard build; revisit AI only with a measured use case.' });
    }
    return risks;
  }

  private buildOpportunities(a: RecommendationArchetype, useCases: AIUseCase[]): string[] {
    if (a === 'traditional') {
      return ['Bank the savings now; instrument the product to find a future AI use case with real signal.'];
    }
    const ops = ['Phase the rollout: prove value on one use case before expanding.'];
    if (useCases.some((u) => u.taskType === 'rag_qa')) ops.push('Reuse the retrieval layer across future assistant features.');
    if (a === 'multi_agent' || a === 'single_agent') ops.push('Capture agent traces to build an evaluation dataset over time.');
    ops.push('Negotiate committed-throughput pricing once volume stabilises.');
    return ops;
  }

  private buildRecommendations(input: ProjectInput, feas: FeasibilityResult): Recommendation[] {
    const recs: Recommendation[] = [
      {
        priority: 'high',
        category: 'Approach',
        title: `Build as: ${feas.archetypeLabel}`,
        description: feas.archetypeRationale,
        estimatedImpact: 'Sets the cost and complexity envelope for the whole project.',
      },
    ];
    if (feas.archetype !== 'traditional') {
      recs.push({
        priority: 'high',
        category: 'FinOps',
        title: 'Instrument cost-per-request from day one',
        description: 'Tag every model call with a use case and surface $/request in a dashboard.',
        estimatedImpact: 'Keeps token spend predictable and prevents budget surprises.',
      });
      recs.push({
        priority: 'medium',
        category: 'Quality',
        title: 'Stand up an evaluation harness early',
        description: 'A small labelled set + automated scoring catches regressions before users do.',
        estimatedImpact: 'Reduces production incidents and rework.',
      });
    }
    recs.push({
      priority: 'medium',
      category: 'Delivery',
      title: 'Ship a thin vertical slice first',
      description: 'One use case, end to end, in front of real users before scaling breadth.',
      estimatedImpact: 'De-risks the estimate with real usage data.',
    });
    return recs;
  }

  private composeMarkdown(input: ProjectInput, feas: FeasibilityResult, cost: CostBreakdown): string {
    const fmt = (n: number) => `${cost.currency} ${n.toLocaleString()}`;
    return [
      `# ${input.projectName} — AI Feasibility & Cost`,
      ``,
      `**Recommendation:** ${feas.archetypeLabel} (feasibility ${feas.score}/100, ${feas.rating}).`,
      ``,
      feas.rationale,
      ``,
      `## Cost (first year)`,
      `- Development: ${fmt(cost.development.totalCost)}`,
      `- Infrastructure: ${fmt(cost.infrastructure.annualCost)}/yr`,
      `- AI tokens: ${fmt(cost.aiTokens.annualCost.expected)}/yr (expected)`,
      `- Maintenance: ${fmt(cost.maintenance.annualCost)}/yr`,
      `- **Total expected: ${fmt(cost.total.expected)}** (range ${fmt(cost.total.min)}–${fmt(cost.total.max)})`,
    ].join('\n');
  }

  /* ── Seed-summary synthesis (so existing rows open a full report) ── */

  private synthesizeFromSummary(summary: EstimateSummary): Estimation {
    const input = this.summaryToInput(summary);
    const est = this.computeEstimation(input, summary.id, summary.updatedAt);
    // Keep headline numbers consistent with the dashboard/history row.
    est.feasibility.score = summary.feasibilityScore;
    est.feasibility.rating = ratingForScore(summary.feasibilityScore);
    est.feasibility.archetypeLabel = summary.recommendationLabel;
    return est;
  }

  private summaryToInput(s: EstimateSummary): ProjectInput {
    const scale: ProjectScale =
      s.totalCostExpected < 30000 ? 'small' : s.totalCostExpected < 80000 ? 'medium' : s.totalCostExpected < 150000 ? 'large' : 'enterprise';
    const taskTypes = this.tasksForLabel(s.recommendationLabel);
    const aiUseCases: AIUseCase[] = taskTypes.map((t, i) => ({
      id: `uc_${i}`,
      name: t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      taskType: t,
      description: '',
      priority: i === 0 ? 'must_have' : 'nice_to_have',
      linkedFeatureIds: [],
    }));
    return {
      projectName: s.projectName,
      projectType: s.projectType,
      description: `${s.projectName} — ${s.industryDomain}`,
      industryDomain: s.industryDomain,
      targetUsers: 'Internal & external stakeholders',
      scale,
      features: [
        { id: 'f1', name: 'Core application', description: '', complexity: 'high', aiCandidate: taskTypes.length > 0 },
        { id: 'f2', name: 'Reporting & dashboards', description: '', complexity: 'medium', aiCandidate: false },
      ],
      aiUseCases,
      technicalPreferences: {
        preferredLLMProvider: 'Azure OpenAI',
        deploymentModel: 'cloud',
        existingInfra: 'Azure',
        complianceRequirements: [],
        budgetCurrency: s.currency,
      },
      volumeAndScale: {
        expectedDailyUsers: scale === 'enterprise' ? 5000 : scale === 'large' ? 1500 : scale === 'medium' ? 400 : 80,
        requestsPerDay: scale === 'enterprise' ? 40000 : scale === 'large' ? 12000 : scale === 'medium' ? 3000 : 600,
        dataVolumeGB: scale === 'enterprise' ? 500 : scale === 'large' ? 120 : scale === 'medium' ? 30 : 8,
        peakLoadPattern: 'Business hours',
        growthRatePercent: 20,
      },
    };
  }

  private tasksForLabel(label: string): AITaskType[] {
    switch (label) {
      case 'Multi-Agent':
        return ['multi_agent_orchestration', 'rag_qa'];
      case 'Single Agent':
        return ['conversational_agent', 'data_extraction'];
      case 'RAG Assistant':
        return ['rag_qa', 'document_analysis'];
      case 'Traditional + AI':
        return ['text_classification', 'summarization'];
      case 'Traditional Only':
        return [];
      default:
        return ['rag_qa'];
    }
  }
}
