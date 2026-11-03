import { isExcludedPath } from '../security/exclusions';
import { resolveWorkspacePath } from '../security/paths';
import { failure, type JsonSchema, type Tool, type ToolResult } from './types';

const DIAG_TIMEOUT_MS = 5_000;
const objectOutput: JsonSchema = { type: 'object' };

export interface DiagnosticRecord {
  path: string;
  message: string;
  severity: 'error' | 'warning' | 'information' | 'hint';
  source?: string;
  code?: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface DiagnosticsReader {
  get(absolutePath?: string): Promise<DiagnosticRecord[]>;
}

interface DiagnosticsInput {
  path?: string;
}

interface DiagnosticsOutput {
  diagnostics: DiagnosticRecord[];
  count: number;
}

export function createDiagnosticsTool(
  reader: DiagnosticsReader,
): Tool<DiagnosticsInput, DiagnosticsOutput> {
  return {
    id: 'diagnostics.get',
    description: 'Get VS Code diagnostics for files in the workspace.',
    permission: 'read',
    timeoutMs: DIAG_TIMEOUT_MS,
    maxResultBytes: 256 * 1024,
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      additionalProperties: false,
    },
    outputSchema: objectOutput,
    async execute(input, ctx): Promise<ToolResult<DiagnosticsOutput>> {
      let filterPath: string | undefined;
      if (input.path) {
        const resolution = await resolveWorkspacePath(input.path, ctx.workspaceRoots, {
          mustExist: false,
        });
        if (!resolution.ok) {
          if (resolution.reason === 'outside_workspace')
            return failure('unsafe_path', resolution.message);
          if (resolution.reason === 'not_found') return failure('not_found', resolution.message);
          return failure('invalid_arguments', resolution.message);
        }
        if (resolution.path.excluded && !ctx.allowSensitivePaths) {
          return failure(
            'permission_denied',
            `Path ${resolution.path.workspaceRelative} is excluded.`,
          );
        }
        filterPath = resolution.path.absolute;
      }

      const diagnostics = (await reader.get(filterPath)).filter(
        (diagnostic) => ctx.allowSensitivePaths || !isExcludedPath(diagnostic.path).excluded,
      );
      let limited = diagnostics;
      while (
        limited.length > 0 &&
        Buffer.byteLength(JSON.stringify(limited), 'utf8') > 256 * 1024
      ) {
        limited = limited.slice(0, -1);
      }
      return {
        ok: true,
        data: { diagnostics: limited, count: limited.length },
        truncated: limited.length < diagnostics.length,
        bytes: Buffer.byteLength(JSON.stringify(limited), 'utf8'),
      };
    },
  };
}
