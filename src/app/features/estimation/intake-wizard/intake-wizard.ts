import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { EstimationService } from '../../../core/services/estimation.service';
import { AITaskType, ProjectInput, ProjectScale } from '../../../core/models/project.model';

interface StepDef {
  key: string;
  label: string;
}

@Component({
  selector: 'app-intake-wizard',
  imports: [ReactiveFormsModule],
  templateUrl: './intake-wizard.html',
  styleUrl: './intake-wizard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntakeWizard {
  private readonly fb = inject(FormBuilder);
  private readonly estimation = inject(EstimationService);
  private readonly router = inject(Router);

  protected readonly steps: StepDef[] = [
    { key: 'basics', label: 'Project basics' },
    { key: 'features', label: 'Features' },
    { key: 'useCases', label: 'AI use cases' },
    { key: 'technical', label: 'Technical' },
    { key: 'volume', label: 'Volume & scale' },
    { key: 'review', label: 'Review' },
  ];

  protected readonly step = signal(0);
  protected readonly generating = signal(false);
  protected readonly progress = signal(0);
  protected readonly genMessage = signal('');

  protected readonly scaleOptions: { value: ProjectScale; label: string }[] = [
    { value: 'small', label: 'Small — single team / pilot' },
    { value: 'medium', label: 'Medium — department' },
    { value: 'large', label: 'Large — org-wide' },
    { value: 'enterprise', label: 'Enterprise — mission-critical' },
  ];

  protected readonly complexityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'very_high', label: 'Very high' },
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

  protected readonly form = this.fb.nonNullable.group({
    projectName: ['', Validators.required],
    description: ['', [Validators.required, Validators.minLength(12)]],
    industryDomain: ['', Validators.required],
    targetUsers: [''],
    scale: ['medium' as ProjectScale],
    features: this.fb.array([this.featureGroup()]),
    aiUseCases: this.fb.array([this.useCaseGroup()]),
    preferredLLMProvider: ['Azure OpenAI'],
    deploymentModel: ['cloud'],
    complianceRequirements: [''],
    budgetCeiling: [null as number | null],
    budgetCurrency: ['USD'],
    expectedDailyUsers: [400],
    requestsPerDay: [3000],
    dataVolumeGB: [30],
    growthRatePercent: [20],
    peakLoadPattern: ['Business hours'],
  });

  protected get features(): FormArray {
    return this.form.get('features') as FormArray;
  }
  protected get aiUseCases(): FormArray {
    return this.form.get('aiUseCases') as FormArray;
  }

  private featureGroup() {
    return this.fb.nonNullable.group({
      name: ['', Validators.required],
      description: [''],
      complexity: ['medium'],
      aiCandidate: [true],
    });
  }
  private useCaseGroup() {
    return this.fb.nonNullable.group({
      name: ['', Validators.required],
      taskType: ['rag_qa' as AITaskType],
      description: [''],
      priority: ['must_have'],
    });
  }

  protected addFeature(): void {
    this.features.push(this.featureGroup());
  }
  protected removeFeature(i: number): void {
    if (this.features.length > 1) this.features.removeAt(i);
  }
  protected addUseCase(): void {
    this.aiUseCases.push(this.useCaseGroup());
  }
  protected removeUseCase(i: number): void {
    if (this.aiUseCases.length > 1) this.aiUseCases.removeAt(i);
  }

  protected readonly isLastStep = computed(() => this.step() === this.steps.length - 1);

  protected stepValid(index: number): boolean {
    switch (index) {
      case 0:
        return ['projectName', 'description', 'industryDomain'].every((k) => this.form.get(k)!.valid);
      case 1:
        return this.features.controls.some((c) => c.get('name')!.valid);
      case 2:
        return this.aiUseCases.controls.some((c) => c.get('name')!.valid);
      default:
        return true;
    }
  }

  protected next(): void {
    if (!this.stepValid(this.step())) {
      this.markStepTouched(this.step());
      return;
    }
    if (!this.isLastStep()) this.step.update((s) => s + 1);
  }
  protected back(): void {
    if (this.step() > 0) this.step.update((s) => s - 1);
  }
  protected goTo(index: number): void {
    if (index <= this.step() || this.stepValid(this.step())) this.step.set(index);
  }

  private markStepTouched(index: number): void {
    if (index === 0) {
      ['projectName', 'description', 'industryDomain'].forEach((k) => this.form.get(k)!.markAsTouched());
    } else if (index === 1) {
      this.features.controls.forEach((c) => c.get('name')!.markAsTouched());
    } else if (index === 2) {
      this.aiUseCases.controls.forEach((c) => c.get('name')!.markAsTouched());
    }
  }

  protected submit(): void {
    if (this.form.invalid) {
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
    return {
      projectName: v.projectName,
      projectType: 'new',
      description: v.description,
      industryDomain: v.industryDomain,
      targetUsers: v.targetUsers,
      scale: v.scale,
      features: v.features.map((f, i) => ({
        id: `f${i}`,
        name: f.name,
        description: f.description,
        complexity: f.complexity as 'low' | 'medium' | 'high' | 'very_high',
        aiCandidate: f.aiCandidate,
      })),
      aiUseCases: v.aiUseCases.map((u, i) => ({
        id: `u${i}`,
        name: u.name,
        taskType: u.taskType,
        description: u.description,
        priority: u.priority as 'must_have' | 'nice_to_have' | 'exploratory',
        linkedFeatureIds: [],
      })),
      technicalPreferences: {
        preferredLLMProvider: v.preferredLLMProvider,
        deploymentModel: v.deploymentModel as 'cloud' | 'hybrid' | 'edge',
        existingInfra: '',
        complianceRequirements: v.complianceRequirements
          ? v.complianceRequirements.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        budgetCeiling: v.budgetCeiling ?? undefined,
        budgetCurrency: v.budgetCurrency,
      },
      volumeAndScale: {
        expectedDailyUsers: v.expectedDailyUsers,
        requestsPerDay: v.requestsPerDay,
        dataVolumeGB: v.dataVolumeGB,
        peakLoadPattern: v.peakLoadPattern,
        growthRatePercent: v.growthRatePercent,
      },
    };
  }
}
