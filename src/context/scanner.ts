import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ProjectProfile {
  roots: string[];
  languages: Array<{ id: string; fileCount: number }>;
  packageManagers: string[];
  frameworks: string[];
  monorepo?: {
    kind: 'pnpm' | 'npm' | 'yarn' | 'turbo' | 'nx' | 'unknown';
    packages: string[];
  };
  typescript?: {
    configs: string[];
    projectReferences: string[];
  };
  prisma?: {
    schemas: string[];
    migrations: string[];
  };
  testRunners: string[];
  hasGit: boolean;
}

export interface ProjectScanOptions {
  roots?: string[];
  signal?: AbortSignal;
  maxFiles?: number;
}

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'coverage',
  'target',
  'vendor',
]);

const FRAMEWORK_FILES: Record<string, string> = {
  'next.config.js': 'next',
  'next.config.mjs': 'next',
  'next.config.ts': 'next',
  'vite.config.js': 'vite',
  'vite.config.mts': 'vite',
  'angular.json': 'angular',
  'svelte.config.js': 'svelte',
  'astro.config.mjs': 'astro',
};

const PACKAGE_MANAGER_FILES: Record<string, string> = {
  'package-lock.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
};

const TEST_RUNNER_FILES: Record<string, string> = {
  'vitest.config.ts': 'vitest',
  'vitest.config.js': 'vitest',
  'vitest.config.mts': 'vitest',
  'jest.config.ts': 'jest',
  'jest.config.js': 'jest',
  'playwright.config.ts': 'playwright',
  'pytest.ini': 'pytest',
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
};

export async function scanProject(options: ProjectScanOptions = {}): Promise<ProjectProfile> {
  const roots = options.roots?.length ? [...options.roots] : [process.cwd()];

  const languages = new Map<string, { id: string; fileCount: number }>();

  let hasGit = false;
  let visited = 0;

  const maxFiles = Math.max(0, options.maxFiles ?? 10_000);

  for (const root of roots) {
    if (options.signal?.aborted) {
      return emptyProfile(roots, hasGit);
    }

    const resolvedRoot = path.resolve(root);

    if (await pathExists(path.join(resolvedRoot, '.git'))) {
      hasGit = true;
    }

    const stack = [resolvedRoot];

    while (stack.length > 0 && visited < maxFiles) {
      if (options.signal?.aborted) {
        return emptyProfile(roots, hasGit);
      }

      const directory = stack.pop() as string;

      let entries: string[];
      try {
        entries = await fs.readdir(directory);
      } catch {
        continue;
      }

      entries.sort((a, b) => a.localeCompare(b));

      for (const entryName of entries) {
        if (options.signal?.aborted) {
          return emptyProfile(roots, hasGit);
        }

        if (IGNORED_DIRECTORIES.has(entryName)) {
          continue;
        }

        if (entryName.startsWith('.')) {
          continue;
        }

        const entryPath = path.join(directory, entryName);

        let stats;

        try {
          stats = await fs.lstat(entryPath);
        } catch {
          continue;
        }

        // Do not follow symlinks outside the workspace.
        if (stats.isSymbolicLink()) {
          continue;
        }

        if (stats.isDirectory()) {
          stack.push(entryPath);
          continue;
        }

        if (!stats.isFile()) {
          continue;
        }

        if (visited >= maxFiles) {
          break;
        }

        visited += 1;

        const extension = path.extname(entryName).toLowerCase();
        const languageId = LANGUAGE_EXTENSIONS[extension];

        if (!languageId) {
          continue;
        }

        const existing = languages.get(languageId);

        languages.set(languageId, {
          id: languageId,
          fileCount: (existing?.fileCount ?? 0) + 1,
        });
      }
    }

    if (visited >= maxFiles) {
      break;
    }
  }

  const [packageManagers, frameworks, monorepo, typescript, prisma, testRunners] =
    await Promise.all([
      detectPackageManagers(roots),
      detectFrameworks(roots),
      detectMonorepo(roots),
      detectTypeScript(roots),
      detectPrisma(roots),
      detectTestRunners(roots),
    ]);

  return {
    roots,
    languages: [...languages.values()].sort((a, b) => a.id.localeCompare(b.id)),
    packageManagers,
    frameworks,
    ...(monorepo ? { monorepo } : {}),
    ...(typescript ? { typescript } : {}),
    ...(prisma ? { prisma } : {}),
    testRunners,
    hasGit,
  };
}

async function detectPackageManagers(roots: string[]): Promise<string[]> {
  const packageManagers = new Set<string>();

  for (const root of roots) {
    for (const [fileName, manager] of Object.entries(PACKAGE_MANAGER_FILES)) {
      if (await fileExists(path.join(root, fileName))) {
        packageManagers.add(manager);
      }
    }

    const packageJson = await readJsonFile(path.join(root, 'package.json'));

    const packageManager = packageJson?.packageManager ?? packageJson?.manager;

    if (typeof packageManager === 'string') {
      packageManagers.add(packageManager.split('@')[0] ?? packageManager);
    }
  }

  return [...packageManagers].sort();
}

async function detectFrameworks(roots: string[]): Promise<string[]> {
  const frameworks = new Set<string>();

  for (const root of roots) {
    for (const [fileName, framework] of Object.entries(FRAMEWORK_FILES)) {
      if (await fileExists(path.join(root, fileName))) {
        frameworks.add(framework);
      }
    }
  }

  return [...frameworks].sort();
}

async function detectMonorepo(roots: string[]): Promise<ProjectProfile['monorepo']> {
  const workspaceFile = await findFile(roots, [
    'pnpm-workspace.yaml',
    'turbo.json',
    'nx.json',
    'lerna.json',
  ]);

  if (!workspaceFile) {
    return undefined;
  }

  const fileName = path.basename(workspaceFile);

  let kind: NonNullable<ProjectProfile['monorepo']>['kind'] = 'unknown';

  switch (fileName) {
    case 'pnpm-workspace.yaml':
      kind = 'pnpm';
      break;
    case 'turbo.json':
      kind = 'turbo';
      break;
    case 'nx.json':
      kind = 'nx';
      break;
  }

  const packageJson = await readJsonFile(path.join(path.dirname(workspaceFile), 'package.json'));

  const workspaces = packageJson?.workspaces ?? packageJson?.packages;

  let packages: string[] = [];

  if (Array.isArray(workspaces)) {
    packages = workspaces.filter((item): item is string => typeof item === 'string');
  } else if (typeof workspaces === 'object' && workspaces !== null && 'packages' in workspaces) {
    const nestedPackages = workspaces.packages;

    if (Array.isArray(nestedPackages)) {
      packages = nestedPackages.filter((item): item is string => typeof item === 'string');
    }
  }

  return { kind, packages };
}

async function detectTypeScript(roots: string[]): Promise<ProjectProfile['typescript']> {
  const configs: string[] = [];
  const projectReferences: string[] = [];

  for (const root of roots) {
    let entries: string[];

    try {
      entries = await fs.readdir(root);
    } catch {
      continue;
    }

    const tsConfigs = entries.filter(
      (entry) => entry.startsWith('tsconfig') && entry.endsWith('.json'),
    );

    for (const configName of tsConfigs) {
      const configPath = path.join(root, configName);

      configs.push(path.relative(root, configPath).split(path.sep).join('/'));

      const config = await readJsonFile(configPath);
      const references = config?.references;

      if (Array.isArray(references)) {
        for (const reference of references) {
          if (
            typeof reference === 'object' &&
            reference !== null &&
            'path' in reference &&
            typeof reference.path === 'string'
          ) {
            projectReferences.push(reference.path);
          }
        }
      }
    }
  }

  if (configs.length === 0) {
    return undefined;
  }

  return { configs, projectReferences };
}

async function detectPrisma(roots: string[]): Promise<ProjectProfile['prisma']> {
  const schemas: string[] = [];
  const migrations: string[] = [];

  for (const root of roots) {
    const rootSchema = path.join(root, 'schema.prisma');
    const prismaSchema = path.join(root, 'prisma', 'schema.prisma');

    if (await fileExists(rootSchema)) {
      schemas.push('schema.prisma');
    }

    if (await fileExists(prismaSchema)) {
      schemas.push('prisma/schema.prisma');
    }

    if (await pathExists(path.join(root, 'prisma', 'migrations'))) {
      migrations.push('prisma/migrations');
    }
  }

  if (schemas.length === 0) {
    return undefined;
  }

  return { schemas, migrations };
}

async function detectTestRunners(roots: string[]): Promise<string[]> {
  const testRunners = new Set<string>();

  for (const root of roots) {
    for (const [fileName, runner] of Object.entries(TEST_RUNNER_FILES)) {
      if (await fileExists(path.join(root, fileName))) {
        testRunners.add(runner);
      }
    }
  }

  return [...testRunners].sort();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(content);

    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function findFile(roots: string[], fileNames: string[]): Promise<string | undefined> {
  for (const root of roots) {
    for (const fileName of fileNames) {
      const filePath = path.join(root, fileName);

      if (await fileExists(filePath)) {
        return filePath;
      }
    }
  }

  return undefined;
}

function emptyProfile(roots: string[], hasGit: boolean): ProjectProfile {
  return {
    roots,
    languages: [],
    packageManagers: [],
    frameworks: [],
    testRunners: [],
    hasGit,
  };
}
