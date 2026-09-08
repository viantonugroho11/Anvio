/** A2A v1.0 error codes. */

export class A2AError extends Error {
  constructor(
    public readonly code: A2AErrorCode,
    message: string,
    public readonly httpStatus: number = 400,
  ) {
    super(message);
    this.name = 'A2AError';
  }
}

export type A2AErrorCode =
  | 'TaskNotFoundError'
  | 'TaskNotCancelableError'
  | 'PushNotificationNotSupportedError'
  | 'UnsupportedOperationError'
  | 'ContentTypeNotSupportedError'
  | 'InvalidAgentResponseError'
  | 'VersionNotSupportedError';

export function taskNotFound(id: string): A2AError {
  return new A2AError('TaskNotFoundError', `Task '${id}' not found`, 404);
}

export function taskNotCancelable(id: string): A2AError {
  return new A2AError('TaskNotCancelableError', `Task '${id}' is in a terminal state`, 409);
}

export function unsupportedOperation(op: string): A2AError {
  return new A2AError('UnsupportedOperationError', `Operation '${op}' not supported`, 501);
}
