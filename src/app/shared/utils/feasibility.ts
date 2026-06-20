import { RecommendationArchetype } from '../../core/models/estimation.model';

export function archetypeLabel(a: RecommendationArchetype): string {
  switch (a) {
    case 'traditional':
      return 'Traditional Only';
    case 'traditional_plus_ai':
      return 'Traditional + AI';
    case 'rag_assistant':
      return 'RAG Assistant';
    case 'single_agent':
      return 'Single Agent';
    case 'multi_agent':
      return 'Multi-Agent';
    case 'hybrid':
      return 'Hybrid';
  }
}

export function archetypeBlurb(a: RecommendationArchetype): string {
  switch (a) {
    case 'traditional':
      return 'Standard software delivers this best — AI adds cost without proportional value.';
    case 'traditional_plus_ai':
      return 'A conventional build with a few targeted AI features where they clearly pay off.';
    case 'rag_assistant':
      return 'A retrieval-augmented assistant grounded in your own data and documents.';
    case 'single_agent':
      return 'One autonomous agent with tools, handling multi-step tasks end to end.';
    case 'multi_agent':
      return 'Several coordinated agents orchestrated across specialised roles.';
    case 'hybrid':
      return 'A deliberate mix of deterministic services and agents, each where it fits.';
  }
}

export function ratingForScore(score: number): 'low' | 'medium' | 'high' | 'excellent' {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}
