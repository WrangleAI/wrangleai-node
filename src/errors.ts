/**
 * Exception classes matching OpenAI SDK and Python WrangleAI SDK
 * Based on HTTP status codes and error types
 */

export interface APIErrorOptions {
  status?: number;
  headers?: Record<string, string>;
  error?: any;
  request_id?: string;
}

/**
 * Base class for all WrangleAI API errors.
 * Matches OpenAI's APIError pattern.
 */
export class WrangleError extends Error {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly error?: any;
  readonly request_id?: string;

  constructor(message: string, options?: APIErrorOptions) {
    super(message);
    this.name = this.constructor.name;
    this.status = options?.status;
    this.headers = options?.headers;
    this.error = options?.error;
    this.request_id = options?.request_id;

    // Maintains proper stack trace for where error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Raised when API key is invalid or missing (401).
 */
export class AuthenticationError extends WrangleError {
  constructor(message: string, options?: APIErrorOptions) {
    super(message, options);
  }
}

/**
 * Raised when rate limit is exceeded (429).
 */
export class RateLimitError extends WrangleError {
  constructor(message: string, options?: APIErrorOptions) {
    super(message, options);
  }
}

/**
 * Raised when Unprocessable Entity (422).
 */
export class UnprocessableEntityError extends WrangleError {
  constructor(message: string, options?: APIErrorOptions) {
    super(message, options);
  }
}

/**
 * Raised when request is malformed or invalid (400).
 */
export class BadRequestError extends WrangleError {
  constructor(message: string, options?: APIErrorOptions) {
    super(message, options);
  }
}

/**
 * Raised when the user does not have permission to access the resource (403).
 */
export class PermissionDeniedError extends WrangleError {
  constructor(message: string, options?: APIErrorOptions) {
    super(message, options);
  }
}

/**
 * Raised when resource is not found (404).
 */
export class NotFoundError extends WrangleError {
  constructor(message: string, options?: APIErrorOptions) {
    super(message, options);
  }
}

/**
 * Raised when the API returns a server error (500+).
 */
export class APIError extends WrangleError {
  constructor(message: string, options?: APIErrorOptions) {
    super(message, options);
  }
}

/**
 * Raised when network connection fails or times out.
 */
export class APIConnectionError extends WrangleError {
  constructor(message: string, options?: APIErrorOptions) {
    super(message, options);
  }
}

/**
 * Maps HTTP status codes to appropriate error classes.
 * Follows OpenAI SDK error mapping.
 */
export function makeStatusError(
  status: number | undefined,
  error: any,
  message: string,
  headers?: Record<string, string>,
): WrangleError {
  /*
Error Details in OpenAI SDK:
Status Code	    Error Type

    400	        BadRequestError
    401	        AuthenticationError
    403	        PermissionDeniedError
    404	        NotFoundError
    422	        UnprocessableEntityError
    429	        RateLimitError
    >=500	      InternalServerError
    N/A	        APIConnectionError

*/
  const request_id = headers?.['x-request-id'];

  if (status === 400) {
    return new BadRequestError(message, { status, error, headers, request_id });
  }

  if (status === 401) {
    return new AuthenticationError(message, {
      status,
      error,
      headers,
      request_id,
    });
  }

  if (status === 403) {
    return new PermissionDeniedError(message, {
      status,
      error,
      headers,
      request_id,
    });
  }
  if (status === 404) {
    return new NotFoundError(message, { status, error, headers, request_id });
  }

  if (status === 422) {
    return new UnprocessableEntityError(message, { status, error, headers, request_id });
  }

  if (status === 429) {
    return new RateLimitError(message, { status, error, headers, request_id });
  }

  if (status && status >= 500) {
    return new APIError(message, { status, error, headers, request_id });
  }

  // Default to generic WrangleError for unknown status codes
  return new WrangleError(message, { status, error, headers, request_id });
}
