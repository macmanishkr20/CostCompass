import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { CurrencyPipe } from '@angular/common';
import { EstimationService } from '../../../core/services/estimation.service';
import { GithubAnalyzerService } from '../../../core/services/github-analyzer.service';
import {
  AITaskType,
  DeliveryPlatform,
  ProjectInput,
  ProjectScale,
  REGION_OPTIONS,
} from '../../../core/models/project.model';
import { RepoAnalysis, SuggestedUseCase } from '../../../core/models/github.model';

interface StepDef {
  key: string;
  label: string;
}

@Component({
  selector: 'app-enhance-wizard',
  imports: [ReactiveFormsModule, CurrencyPipe],
  templateUrl: './enhance-wizard.html',
  styleUrl: './enhance-wizard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnhanceWizard {
  private readonly fb = inject(FormBuilder);
  private readonly estimation = inject(EstimationService);
  private readonly gh = inject(GithubAnalyzerService);
  private readonly router = inject(Router);

  protected readonly steps: StepDef[] = [
    { key: 'connect', label: 'Connect repo' },
    { key: 'stack', label: 'Review stack' },
    { key: 'useCases', label: 'Enhancement use cases' },
    { key: 'volume', label: 'Volume & scale' },
    { key: 'assumptions', label: 'Assumptions' },
    { key: 'review', label: 'Review' },
  ];

  protected readonly step = signal(0);

  /* analysis state */
  protected readonly analyzing = signal(false);
  protected readonly analyzeError = signal<string | null>(null);
  protected readonly analysis = signal<RepoAnalysis | null>(null);

  /* generation state */
  protected readonly generating = signal(false);
  protected readonly progress = signal(0);
  protected readonly genMessage = signal('');

  protected readonly scaleOptions: { value: ProjectScale; label: string }[] = [
    { value: 'small', label: 'Small — single team / pilot' },
    { value: 'medium', label: 'Medium — department' },
    { value: 'large', label: 'Large — org-wide' },
    { value: 'enterprise', label: 'Enterprise — mission-critical' },
  ];

  protected readonly taskTypeOptions: { value: AITaskType; label: string }[] = [
    { value: 'rag_qa', label: 'RAG Q&A over your data' },
    { value: 'conversational_agent', label: 'Conversational agent' },
    { value: 'multi_agent_orchestration', label: 'Multi-agent orchestration' },
    { value: 'document_analysis', label: 'Document analysis' },
    { value: 'summarization', label: 'Summarization' },
    { value: 'text_classification', label: 'Text classification' },
    { value: 'data_extraction', label: 'Data extraction' },
    { value: 'code_generation', label: 'Code generation' },
    { value: 'image_analysis', label: 'Image analysis' },
    { value: 'translation', label: 'Translation' },
    { value: 'recommendation', label: 'Recommendation' },
    { value: 'anomaly_detection', label: 'Anomaly detection' },
    { value: 'rules_workflow', label: 'Business rules / workflow (no AI)' },
    { value: 'crud_lookup', label: 'Data lookup / CRUD (no AI)' },
    { value: 'threshold_alerting', label: 'Threshold alerting / monitoring (no AI)' },
  ];

  protected readonly priorityOptions = [
    { value: 'must_have', label: 'Must have' },
    { value: 'nice_to_have', label: 'Nice to have' },
    { value: 'exploratory', label: 'Exploratory' },
  ];

  protected readonly providerOptions = ['Azure OpenAI', 'OpenAI', 'Anthropic', 'Google Gemini'];
  protected readonly deploymentOptions = [
    { value: 'cloud', label: 'Cloud' },
    { value: 'hybrid', label: 'Hybrid' },
    { value: 'edge', label: 'Edge' },
  ];

  // Delivery platform whose cost model the estimate is built against. Blank = let
  // the engine infer it from the detected hosting platform / provider / topics.
  protected readonly deliveryPlatformOptions: { value: '' | DeliveryPlatform; label: string }[] = [
    { value: '', label: 'Auto-detect from inputs' },
    { value: 'azure_paas', label: 'Azure PaaS — consumption' },
    { value: 'aws', label: 'AWS — consumption' },
    { value: 'gcp', label: 'Google Cloud — consumption' },
    { value: 'm365_copilot', label: 'Microsoft 365 + Copilot — per seat' },
    { value: 'on_prem', label: 'On-premises / private cloud — capex' },
  ];

  // Azure regions the extra-service estimate is priced against (ARM names).
  protected readonly regionOptions = REGION_OPTIONS;

  protected readonly form = this.fb.nonNullable.group({
    repoUrl: ['', Validators.required],
    token: [''],
    // Detected architecture — patched after analysis, editable.
    framework: [''],
    language: [''],
    database: [''],
    apiPattern: [''],
    hostingPlatform: [''],
    ciCd: [''],
    scale: ['medium' as ProjectScale],
    aiUseCases: this.fb.array([this.useCaseGroup()]),
    preferredLLMProvider: ['Azure OpenAI'],
    deploymentModel: ['cloud'],
    deliveryPlatform: ['' as '' | DeliveryPlatform],
    azureRegion: ['eastus'],
    azureOpenAIRegion: ['eastus'],
    azureSearchRegion: ['eastus'],
    complianceRequirements: [''],
    budgetCeiling: [null as number | null],
    budgetCurrency: ['USD'],
    expectedDailyUsers: [400],
    requestsPerDay: [3000],
    dataVolumeGB: [30],
    growthRatePercent: [20],
    peakLoadPattern: ['Business hours'],
    // Overridable rate card / resourcing dials (default to platform baselines).
    devHourlyRate: [115],
    maintHourlyRate: [95],
    effectiveHoursPerWeek: [32],
    // ROI benefit dials: fully-loaded rate of the offset worker and the share
    // of calls AI handles end-to-end. Drive the per-call dollar value.
    loadedHourlyRate: [75],
    automationRatePercent: [70],
  });

  protected get aiUseCases(): FormArray {
    return this.form.get('aiUseCases') as FormArray;
  }

  private useCaseGroup(seed?: SuggestedUseCase) {
    return this.fb.nonNullable.group({
      name: [seed?.name ?? '', Validators.required],
      taskType: [(seed?.taskType ?? 'rag_qa') as AITaskType],
      description: [seed?.rationale ?? ''],
      priority: [seed?.priority ?? 'must_have'],
      // Blank = use the task-type's default minutes-of-manual-work saved.
      minutesPerCall: [null as number | null],
    });
  }

  /** Catalog default minutes-saved-per-call for a task type (placeholder hinting). */
  protected defaultMinutesPerCall(taskType: AITaskType): number {
    return this.estimation.defaultMinutesPerCall(taskType);
  }

  /** Human label for a selected delivery platform (Review step). */
  protected deliveryPlatformLabel(value: string): string {
    return this.deliveryPlatformOptions.find((o) => o.value === value)?.label ?? value;
  }

  /** Live preview of the derived $/call from the current benefit dials. */
  protected previewValuePerCall(taskType: AITaskType, minutes: number | null): number {
    const mins = minutes ?? this.estimation.defaultMinutesPerCall(taskType);
    const loaded = this.form.controls.loadedHourlyRate.value ?? 75;
    const automation = this.form.controls.automationRatePercent.value ?? 70;
    return this.estimation.deriveValuePerCall(mins, loaded, automation);
  }

  protected addUseCase(): void {
    this.aiUseCases.push(this.useCaseGroup());
  }
  protected removeUseCase(i: number): void {
    if (this.aiUseCases.length > 1) this.aiUseCases.removeAt(i);
  }

  protected readonly isLastStep = computed(() => this.step() === this.steps.length - 1);

  /* ── Repo analysis ─────────────────────────────────────────────── */

  protected analyze(): void {
    const ref = this.gh.parseRepo(this.form.controls.repoUrl.value);
    if (!ref) {
      this.analyzeError.set('Could not parse that — use owner/repo or a full GitHub URL.');
      return;
    }
    this.analyzing.set(true);
    this.analyzeError.set(null);
    const token = this.form.controls.token.value.trim() || undefined;

    this.gh.analyze(ref, token).subscribe({
      next: (a) => {
        this.analysis.set(a);
        this.form.patchValue({
          framework: a.stack.framework,
          language: a.stack.language,
          database: a.stack.database,
          apiPattern: a.stack.apiPattern,
          hostingPlatform: a.stack.hostingPlatform,
          ciCd: a.stack.ciCd,
        });
        // Seed use cases from the analyzer's suggestions.
        this.aiUseCases.clear();
        const seeds = a.suggestedUseCases.length ? a.suggestedUseCases : [];
        for (const s of seeds) this.aiUseCases.push(this.useCaseGroup(s));
        if (this.aiUseCases.length === 0) this.aiUseCases.push(this.useCaseGroup());
        this.analyzing.set(false);
        this.step.set(1);
      },
      error: (err: HttpErrorResponse) => {
        this.analyzing.set(false);
        this.analyzeError.set(this.describeError(err));
      },
    });
  }

  private describeError(err: HttpErrorResponse): string {
    const status = err?.status;
    if (status === 404) return 'Repository not found. Check the URL — for a private repo, add a token below.';
    if (status === 401) return 'Token rejected (401). Verify it is valid and has Contents: read.';
    if (status === 403) {
      const remaining = err?.headers?.get?.('x-ratelimit-remaining');
      if (remaining === '0') {
        return 'GitHub rate limit reached for anonymous requests. Add a fine-grained token to raise the limit.';
      }
      return 'Access forbidden (403). For private repos, add a fine-grained token with Contents: read.';
    }
    if (status === 0) return 'Could not reach the GitHub API (network or CORS). Check your connection and try again.';
    return `Analysis failed${status ? ` (HTTP ${status})` : ''}. Please try again.`;
  }

  /* ── Stepper ───────────────────────────────────────────────────── */

  protected stepValid(index: number): boolean {
    switch (index) {
      case 0:
        return this.analysis() !== null;
      case 2:
        return this.aiUseCases.controls.some((c) => c.get('name')!.valid);
      default:
        return true;
    }
  }

  protected next(): void {
    if (!this.stepValid(this.step())) {
      if (this.step() === 2) this.aiUseCases.controls.forEach((c) => c.get('name')!.markAsTouched());
      return;
    }
    if (!this.isLastStep()) this.step.update((s) => s + 1);
  }
  protected back(): void {
    if (this.step() > 0) this.step.update((s) => s - 1);
  }
  protected goTo(index: number): void {
    // Can't skip ahead past the connect step until the repo is analyzed.
    if (index > 0 && this.analysis() === null) return;
    if (index <= this.step() || this.stepValid(this.step())) this.step.set(index);
  }

  /* ── Submit ────────────────────────────────────────────────────── */

  protected submit(): void {
    if (this.form.invalid || !this.analysis()) {
      this.form.markAllAsTouched();
      return;
    }
    this.generating.set(true);
    this.estimation.generate(this.buildInput()).subscribe((chunk) => {
      this.progress.set(chunk.progress ?? 0);
      this.genMessage.set(chunk.content ?? '');
      if (chunk.status === 'complete' && chunk.data?.id) {
        this.router.navigate(['/estimate', chunk.data.id, 'report']);
      }
    });
  }

  private buildInput(): ProjectInput {
    const v = this.form.getRawValue();
    const a = this.analysis()!;
    return {
      projectName: a.fullName,
      projectType: 'enhancement',
      description: a.description || `AI enhancement of ${a.fullName}`,
      industryDomain: a.topics[0] ?? 'Software',
      targetUsers: 'Existing application users',
      scale: v.scale,
      features: [], // Enhancement mode: no greenfield feature build.
      aiUseCases: v.aiUseCases.map((u, i) => ({
        id: `u${i}`,
        name: u.name,
        taskType: u.taskType,
        description: u.description,
        priority: u.priority as 'must_have' | 'nice_to_have' | 'exploratory',
        linkedFeatureIds: [],
        minutesPerCall: u.minutesPerCall ?? undefined,
      })),
      technicalPreferences: {
        preferredLLMProvider: v.preferredLLMProvider,
        deploymentModel: v.deploymentModel as 'cloud' | 'hybrid' | 'edge',
        deliveryPlatform: v.deliveryPlatform || undefined,
        existingInfra: v.hostingPlatform,
        complianceRequirements: v.complianceRequirements
          ? v.complianceRequirements.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        budgetCeiling: v.budgetCeiling ?? undefined,
        budgetCurrency: v.budgetCurrency,
        azureRegion: v.azureRegion,
        azureOpenAIRegion: v.azureOpenAIRegion,
        azureSearchRegion: v.azureSearchRegion,
      },
      volumeAndScale: {
        expectedDailyUsers: v.expectedDailyUsers,
        requestsPerDay: v.requestsPerDay,
        dataVolumeGB: v.dataVolumeGB,
        peakLoadPattern: v.peakLoadPattern,
        growthRatePercent: v.growthRatePercent,
      },
      costAssumptions: {
        devHourlyRate: v.devHourlyRate ?? 115,
        maintHourlyRate: v.maintHourlyRate ?? 95,
        effectiveHoursPerWeek: v.effectiveHoursPerWeek ?? 32,
        loadedHourlyRate: v.loadedHourlyRate ?? 75,
        automationRatePercent: v.automationRatePercent ?? 70,
      },
      repoUrl: a.htmlUrl,
      repoBranch: a.branch,
      currentArchitecture: {
        framework: v.framework,
        language: v.language,
        database: v.database,
        apiPattern: v.apiPattern,
        hostingPlatform: v.hostingPlatform,
        ciCd: v.ciCd,
      },
      repoFullName: a.fullName,
      repoStars: a.stars,
      repoFileCount: a.fileCount,
      repoManifests: a.manifestsFound,
      repoTopics: a.topics,
    };
  }
}
