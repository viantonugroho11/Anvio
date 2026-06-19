export type AnvioErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'AGENT_RUNTIME_ERROR'
  | 'MODEL_PROVIDER_ERROR'
  | 'MEMORY_ERROR'
  | 'TOOL_EXECUTION_ERROR'
  | 'APPROVAL_REQUIRED'
  | 'INTERNAL_ERROR';

export class AnvioError extends Error {
  readonly code: AnvioErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: AnvioErrorCode,
    message: string,
    options?: { statusCode?: number; details?: unknown; cause?: Error },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'AnvioError';
    this.code = code;
    this.statusCode = options?.statusCode ?? AnvioError.defaultStatusCode(code);
    this.details = options?.details;
  }

  private static defaultStatusCode(code: AnvioErrorCode): number {
    switch (code) {
      case 'VALIDATION_ERROR':
        return 400;
      case 'UNAUTHORIZED':
        return 401;
      case 'FORBIDDEN':
        return 403;
      case 'NOT_FOUND':
        return 404;
      case 'CONFLICT':
        return 409;
      case 'APPROVAL_REQUIRED':
        return 422;
      case 'AGENT_RUNTIME_ERROR':
      case 'MODEL_PROVIDER_ERROR':
      case 'MEMORY_ERROR':
      case 'TOOL_EXECUTION_ERROR':
        return 502;
      case 'INTERNAL_ERROR':
        return 500;
      default: {
        const _exhaustive: never = code;
        return _exhaustive;
      }
    }
  }
}
