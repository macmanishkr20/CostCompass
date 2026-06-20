import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { AITaskType } from '../models/project.model';
import {
  DetectedStack,
  LanguageShare,
  RepoAnalysis,
  RepoRef,
  SuggestedUseCase,
} from '../models/github.model';

/* ── GitHub REST shapes (only the fields we read) ── */
interface GhRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  topics?: string[];
  pushed_at: string;
  license: { spdx_id?: string; name?: string } | null;
}
interface GhTreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
}
interface GhTree {
  tree: GhTreeEntry[];
  truncated: boolean;
}
interface GhContent {
  content?: string;
  encoding?: string;
}

/* Manifest files we read to fingerprint the stack. Kept short to bound API calls. */
const MANIFEST_NAMES = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'go.mod',
  'Cargo.toml',
  'composer.json',
  'Gemfile',
];

@Injectable({ providedIn: 'root' })
export class GithubAnalyzerService {
  private readonly http = inject(HttpClient);
  private readonly base = 'https://api.github.com';

  /** Accepts full URLs, `owner/repo`, or `github.com/owner/repo`; null if unparseable. */
  parseRepo(input: string): RepoRef | null {
    const s = (input ?? '').trim();
    if (!s) return null;

    // owner/repo shorthand
    const shorthand = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(s);
    if (shorthand && !s.includes('github.com') && !s.includes('://')) {
      return { owner: shorthand[1], repo: shorthand[2] };
    }

    const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([\w./-]+))?\/?$/i.exec(s);
    if (m) {
      return { owner: m[1], repo: m[2], branch: m[3] };
    }
    return null;
  }

  analyze(ref: RepoRef, token?: string): Observable<RepoAnalysis> {
    const headers = this.headers(token);
    const repoUrl = `${this.base}/repos/${ref.owner}/${ref.repo}`;

    return this.http.get<GhRepo>(repoUrl, { headers }).pipe(
      switchMap((meta) => {
        const branch = ref.branch || meta.default_branch;
        return forkJoin({
          meta: of(meta),
          branch: of(branch),
          languages: this.http
            .get<Record<string, number>>(`${repoUrl}/languages`, { headers })
            .pipe(catchError(() => of({} as Record<string, number>))),
          tree: this.http
            .get<GhTree>(`${repoUrl}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers })
            .pipe(catchError(() => of({ tree: [], truncated: false } as GhTree))),
        });
      }),
      switchMap(({ meta, branch, languages, tree }) => {
        const paths = tree.tree.filter((t) => t.type === 'blob').map((t) => t.path);
        const manifests = this.pickManifests(paths);
        const fetches = manifests.map((p) =>
          this.fileContent(ref, p, branch, token).pipe(
            map((content) => ({ path: p, content })),
            catchError(() => of({ path: p, content: '' })),
          ),
        );
        const contents$ = fetches.length ? forkJoin(fetches) : of([] as { path: string; content: string }[]);
        return contents$.pipe(
          map((contents) => this.build(meta, branch, languages, tree, paths, manifests, contents)),
        );
      }),
    );
  }

  /* ── internals ──────────────────────────────────────────────── */

  private headers(token?: string): HttpHeaders {
    let h = new HttpHeaders({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    if (token?.trim()) h = h.set('Authorization', `Bearer ${token.trim()}`);
    return h;
  }

  private fileContent(ref: RepoRef, path: string, branch: string, token?: string): Observable<string> {
    const url = `${this.base}/repos/${ref.owner}/${ref.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
    return this.http.get<GhContent>(url, { headers: this.headers(token) }).pipe(
      map((c) => {
        if (c.encoding === 'base64' && c.content) {
          try {
            return atob(c.content.replace(/\n/g, ''));
          } catch {
            return '';
          }
        }
        return c.content ?? '';
      }),
    );
  }

  /** Root-level manifests first (most representative), capped to bound API calls. */
  private pickManifests(paths: string[]): string[] {
    const root = paths.filter((p) => !p.includes('/'));
    const picked: string[] = [];
    for (const name of MANIFEST_NAMES) {
      if (root.includes(name)) picked.push(name);
    }
    // a .NET project file can live anywhere; grab the shallowest one
    const csproj = paths
      .filter((p) => p.endsWith('.csproj'))
      .sort((a, b) => a.split('/').length - b.split('/').length)[0];
    if (csproj) picked.push(csproj);
    return picked.slice(0, 6);
  }

  private build(
    meta: GhRepo,
    branch: string,
    languages: Record<string, number>,
    tree: GhTree,
    paths: string[],
    manifests: string[],
    contents: { path: string; content: string }[],
  ): RepoAnalysis {
    const totalBytes = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
    const langShares: LanguageShare[] = Object.entries(languages)
      .map(([name, bytes]) => ({ name, bytes, percent: Math.round((bytes / totalBytes) * 100) }))
      .sort((a, b) => b.bytes - a.bytes);

    const primaryLanguage = meta.language || langShares[0]?.name || 'Unknown';
    const text = contents.map((c) => c.content).join('\n').toLowerCase();
    const pathSet = new Set(paths);
    const lowerPaths = paths.map((p) => p.toLowerCase());

    const stack = this.detectStack(primaryLanguage, text, paths, lowerPaths, pathSet, manifests);
    const suggestedUseCases = this.suggestUseCases(meta, stack, lowerPaths);

    return {
      fullName: meta.full_name,
      htmlUrl: meta.html_url,
      description: meta.description ?? '',
      defaultBranch: meta.default_branch,
      branch,
      primaryLanguage,
      languages: langShares,
      fileCount: paths.length,
      topics: meta.topics ?? [],
      stars: meta.stargazers_count,
      license: meta.license?.spdx_id && meta.license.spdx_id !== 'NOASSERTION' ? meta.license.spdx_id : null,
      lastPushed: meta.pushed_at,
      truncated: tree.truncated,
      manifestsFound: manifests,
      stack,
      suggestedUseCases,
    };
  }

  private detectStack(
    primaryLanguage: string,
    text: string,
    paths: string[],
    lowerPaths: string[],
    pathSet: Set<string>,
    manifests: string[],
  ): DetectedStack {
    const has = (frag: string) => lowerPaths.some((p) => p.includes(frag));
    const dep = (name: string) => text.includes(`"${name}"`) || text.includes(name);

    // Framework
    let framework = 'Unknown';
    if (dep('next')) framework = 'Next.js';
    else if (dep('@angular/core')) framework = 'Angular';
    else if (dep('nuxt')) framework = 'Nuxt';
    else if (dep('@nestjs/core')) framework = 'NestJS';
    else if (dep('svelte')) framework = 'Svelte';
    else if (dep('"vue"') || dep('vue@')) framework = 'Vue';
    else if (dep('"react"')) framework = 'React';
    else if (dep('express')) framework = 'Express';
    else if (dep('fastapi')) framework = 'FastAPI';
    else if (dep('django')) framework = 'Django';
    else if (dep('flask')) framework = 'Flask';
    else if (dep('spring-boot') || dep('springframework')) framework = 'Spring Boot';
    else if (dep('gin-gonic') || dep('labstack/echo')) framework = 'Go (Gin/Echo)';
    else if (dep('laravel')) framework = 'Laravel';
    else if (dep('rails')) framework = 'Ruby on Rails';
    else if (manifests.some((m) => m.endsWith('.csproj'))) framework = 'ASP.NET';

    // Database
    let database = 'Unknown';
    if (dep('mongoose') || dep('mongodb') || dep('pymongo')) database = 'MongoDB';
    else if (dep('pg') || dep('psycopg') || dep('postgres')) database = 'PostgreSQL';
    else if (dep('mysql') || dep('mysql2')) database = 'MySQL';
    else if (dep('prisma')) database = 'Prisma (SQL)';
    else if (dep('sqlalchemy')) database = 'SQL (SQLAlchemy)';
    else if (dep('redis')) database = 'Redis';
    else if (dep('sqlite')) database = 'SQLite';

    // API pattern
    let apiPattern = 'REST';
    if (dep('graphql') || dep('apollo')) apiPattern = 'GraphQL';
    else if (has('.proto') || dep('grpc')) apiPattern = 'gRPC';

    // Hosting
    let hostingPlatform = 'Unspecified';
    if (pathSet.has('vercel.json') || has('vercel.json')) hostingPlatform = 'Vercel';
    else if (has('netlify.toml')) hostingPlatform = 'Netlify';
    else if (has('fly.toml')) hostingPlatform = 'Fly.io';
    else if (has('serverless.yml') || has('serverless.yaml')) hostingPlatform = 'Serverless';
    else if (has('azure-pipelines') || text.includes('azure')) hostingPlatform = 'Azure';
    else if (has('dockerfile') || has('docker-compose')) hostingPlatform = 'Containerized';

    // CI/CD
    let ciCd = 'None detected';
    if (has('.github/workflows')) ciCd = 'GitHub Actions';
    else if (has('.gitlab-ci.yml')) ciCd = 'GitLab CI';
    else if (has('azure-pipelines')) ciCd = 'Azure Pipelines';
    else if (has('jenkinsfile')) ciCd = 'Jenkins';
    else if (has('.circleci')) ciCd = 'CircleCI';

    const packageManagers: string[] = [];
    if (manifests.includes('package.json')) packageManagers.push('npm/yarn');
    if (manifests.some((m) => ['requirements.txt', 'pyproject.toml', 'Pipfile'].includes(m))) packageManagers.push('pip');
    if (manifests.includes('go.mod')) packageManagers.push('go mod');
    if (manifests.includes('Cargo.toml')) packageManagers.push('cargo');
    if (manifests.some((m) => ['pom.xml', 'build.gradle', 'build.gradle.kts'].includes(m))) packageManagers.push('maven/gradle');
    if (manifests.includes('composer.json')) packageManagers.push('composer');
    if (manifests.includes('Gemfile')) packageManagers.push('bundler');

    return {
      language: primaryLanguage,
      framework,
      database,
      apiPattern,
      hostingPlatform,
      ciCd,
      packageManagers,
      hasTests: lowerPaths.some((p) => /(^|\/)(test|tests|spec|__tests__)(\/|$)/.test(p) || /\.(test|spec)\./.test(p)),
      hasDocker: has('dockerfile') || has('docker-compose'),
      hasDocs: lowerPaths.some((p) => p.startsWith('docs/') || p.endsWith('readme.md') || p.includes('/docs/')),
    };
  }

  private suggestUseCases(meta: GhRepo, stack: DetectedStack, lowerPaths: string[]): SuggestedUseCase[] {
    const out: SuggestedUseCase[] = [];
    const isBackend = /express|fastapi|django|flask|spring|nestjs|gin|laravel|rails|asp\.net/i.test(stack.framework);
    const isFrontend = /angular|react|vue|svelte|next|nuxt/i.test(stack.framework);

    if (stack.hasDocs) {
      out.push({
        name: 'Docs & knowledge Q&A assistant',
        taskType: 'rag_qa',
        rationale: 'The repo ships docs/README content that can ground a retrieval-augmented assistant.',
        priority: 'must_have',
      });
    }
    if (isFrontend) {
      out.push({
        name: 'In-app conversational copilot',
        taskType: 'conversational_agent',
        rationale: `A ${stack.framework} UI is a natural surface for an embedded assistant.`,
        priority: 'must_have',
      });
    }
    if (isBackend) {
      out.push({
        name: 'Structured data extraction endpoint',
        taskType: 'data_extraction',
        rationale: `Add an AI extraction route to the existing ${stack.framework} API.`,
        priority: 'nice_to_have',
      });
    }
    if (stack.hasTests || /typescript|javascript|python|go|java|c#/i.test(stack.language)) {
      out.push({
        name: 'AI code-review & test generation',
        taskType: 'code_generation',
        rationale: 'An existing codebase benefits from AI-assisted review and test scaffolding.',
        priority: 'exploratory',
      });
    }
    // Always offer a broadly useful default if we found little signal.
    if (out.length < 2) {
      out.push({
        name: 'Content summarization',
        taskType: 'summarization',
        rationale: 'Summarize records, threads, or documents the app already handles.',
        priority: 'nice_to_have',
      });
    }
    return out.slice(0, 4);
  }
}
