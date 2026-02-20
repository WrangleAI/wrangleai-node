import {
  ClientOptions,
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionChunk,
  UsageResponse,
  CostResponse,
  KeyVerifyResponse,
  ModelsListResponse,
  Stream,
  FileObject,
  FileDeleted,
  FileListResponse,
  VectorStore,
  VectorStoreDeleted,
  VectorStoreListResponse,
  VectorStoreFile,
  VectorStoreFileDeleted,
  VectorStoreFileListResponse,
  VectorStoreSearchResponse,
  SustainabilityReport,
  RequestOptions,
  Logger,
  LogLevel
} from './types';
import { StreamChatCompletion } from './streaming';
import {
  WrangleError,
  AuthenticationError,
  RateLimitError,
  BadRequestError,
  NotFoundError,
  APIError,
  APIConnectionError,
  makeStatusError
} from './errors';

// Re-export types and errors so users can access them easily
export * from './types';
export * from './errors';

/**
 * Simple console-based logger
 */
class ConsoleLogger implements Logger {
  constructor(private level: LogLevel) { }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
    const currentIndex = levels.indexOf(this.level);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex && this.level !== 'silent';
  }

  debug(...args: any[]): void {
    if (this.shouldLog('debug')) console.debug('[WrangleAI Debug]', ...args);
  }

  info(...args: any[]): void {
    if (this.shouldLog('info')) console.info('[WrangleAI Info]', ...args);
  }

  warn(...args: any[]): void {
    if (this.shouldLog('warn')) console.warn('[WrangleAI Warn]', ...args);
  }

  error(...args: any[]): void {
    if (this.shouldLog('error')) console.error('[WrangleAI Error]', ...args);
  }
}

/**
 * Internal interface for fetch request configuration
 */
interface FetchRequestConfig {
  method: string;
  path: string;
  body?: any;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
}

export class WrangleAI {
  private apiKey: string;
  private ragBaseURL: string;
  private baseURL: string;
  private timeout: number;
  private maxRetries: number;
  private logger: Logger;

  constructor(options: ClientOptions = {}) {
    // Auto-detect API key from environment
    const apiKey = options.apiKey || process.env.WRANGLEAI_API_KEY || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        "The WrangleAI client requires an apiKey. " +
        "Pass it as an argument or set WRANGLEAI_API_KEY environment variable."
      );
    }

    // Browser safety check
    if (typeof window !== 'undefined' && !options.dangerouslyAllowBrowser) {
      throw new Error(
        "WrangleAI client detected browser environment. " +
        "To use in browser (not recommended for production), " +
        "pass dangerouslyAllowBrowser: true in options."
      );
    }

    this.apiKey = apiKey;
    // Keep hardcoded staging URL as per user request
    this.baseURL = "https://staging-gateway.wrangleai.com/v1";
    this.timeout = options.timeout || 60000;
    this.maxRetries = options.maxRetries ?? 2;

    // Setup logger
    const logLevel = options.logLevel || 'silent';
    this.logger = options.logger || new ConsoleLogger(logLevel);

    // Auto-detect RAG base URL (port 8085) if not provided
    this.ragBaseURL = options.ragBaseURL || this.baseURL.replace(':8080', ':8085');

    this.logger.debug('Initializing WrangleAI client', { baseURL: this.baseURL, ragBaseURL: this.ragBaseURL });
  }

  /**
   * Get the base URL of the client.
   */
  public getBaseURL(): string {
    return this.baseURL;
  }

  /**
   * Get the RAG base URL of the client.
   */
  public getRagBaseURL(): string {
    return this.ragBaseURL;
  }

  /**
   * Create a new client instance with modified options.
   * Useful for per-request customization.
   */
  public withOptions(options: Partial<ClientOptions>): WrangleAI {
    return new WrangleAI({
      apiKey: options.apiKey || this.apiKey,
      baseURL: options.baseURL || this.baseURL,
      ragBaseURL: options.ragBaseURL || this.ragBaseURL,
      timeout: options.timeout || this.timeout,
      maxRetries: options.maxRetries ?? this.maxRetries,
      logger: options.logger || this.logger,
      logLevel: options.logLevel,
      dangerouslyAllowBrowser: options.dangerouslyAllowBrowser,
    });
  }

  /**
   * Check if a response status code should trigger a retry.
   * Matches OpenAI SDK behavior.
   */
  private shouldRetry(status: number | undefined): boolean {
    if (!status) return false;

    // Retry on request timeouts
    if (status === 408) return true;

    // Retry on rate limits
    if (status === 429) return true;

    // Retry on internal errors
    if (status >= 500) return true;

    return false;
  }

  /**
   * Build a full URL from base URL, path, and optional query params.
   * Uses string concatenation instead of new URL(path, base) because
   * paths starting with '/' are absolute from the origin in URL constructor.
   */
  private buildURL(baseURL: string, path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const base = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    const fullURL = base + cleanPath;

    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          params.set(key, String(value));
        }
      }
      const qs = params.toString();
      if (qs) return fullURL + '?' + qs;
    }

    return fullURL;
  }

  /**
   * Core fetch method — replaces axios instances.
   * Handles headers, timeout, and abort signal.
   */
  private async _fetch(
    baseURL: string,
    config: FetchRequestConfig
  ): Promise<Response> {
    const url = this.buildURL(baseURL, config.path, config.query);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      ...config.headers,
    };

    // Only set Content-Type for JSON bodies (not FormData — fetch sets it automatically with boundary)
    if (config.body && !(config.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const effectiveTimeout = config.timeout || this.timeout;

    // Create abort controller for timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), effectiveTimeout);

    // Combine user signal and timeout signal
    let signal: AbortSignal;
    if (config.signal) {
      // If user provided a signal, we need to abort on either
      signal = config.signal;
      // Also wire up timeout abort
      const onTimeout = () => {
        if (!config.signal!.aborted) {
          timeoutController.abort();
        }
      };
      setTimeout(onTimeout, effectiveTimeout);
      // If user aborts, clear timeout
      config.signal.addEventListener('abort', () => clearTimeout(timeoutId), { once: true });
    } else {
      signal = timeoutController.signal;
    }

    const fetchOptions: RequestInit = {
      method: config.method.toUpperCase(),
      headers,
      signal: config.signal || timeoutController.signal,
      ...(config.body ? {
        body: config.body instanceof FormData ? config.body : JSON.stringify(config.body)
      } : {}),
    };

    try {
      const response = await fetch(url, fetchOptions);
      return response;
    } catch (error: any) {
      // Convert fetch errors to WrangleAI errors
      if (error.name === 'AbortError') {
        if (config.signal?.aborted) {
          // User cancelled the request
          throw error;
        }
        // Timeout
        throw new APIConnectionError(`Request timed out after ${effectiveTimeout}ms`, { error });
      }
      throw new APIConnectionError(error.message || 'Network connection failed', { error });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Convert Headers to a plain Record.
   * Uses forEach() instead of entries() for broader TypeScript DOM lib compatibility.
   */
  private headersToRecord(headers: Headers): Record<string, string> {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }

  /**
   * Infer MIME type from filename extension.
   * Prevents server rejection of 'application/octet-stream'.
   */
  private inferMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      jsonl: 'application/jsonl',
      pdf: 'application/pdf',
      md: 'text/markdown',
      html: 'text/html',
      htm: 'text/html',
      xml: 'text/xml',
      yaml: 'text/yaml',
      yml: 'text/yaml',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    };
    return mimeMap[ext || ''] || 'application/octet-stream';
  }

  /**
   * Parse error response body from a failed fetch Response.
   */
  private async parseErrorResponse(response: Response): Promise<{ message: string; errorData: any }> {
    let errorData: any = null;
    let message = `Request failed with status ${response.status}`;

    try {
      const text = await response.text();
      try {
        errorData = JSON.parse(text);
        message = errorData?.error?.message || errorData?.message || errorData?.error || message;
      } catch {
        // Response wasn't JSON
        if (text) message = text;
      }
    } catch {
      // Could not read body
    }

    return { message, errorData };
  }

  /**
   * Make a request with retry and abort signal support.
   * Replaces the old axios-based makeRequest + retryRequest flow.
   */
  private async makeRequest<T>(
    baseURL: string,
    config: FetchRequestConfig,
    options?: RequestOptions,
    requestName?: string
  ): Promise<T> {
    const effectiveMaxRetries = options?.maxRetries ?? this.maxRetries;
    const effectiveTimeout = options?.timeout || this.timeout;

    let lastError: any;

    for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff: 2^attempt * 100ms + jitter
          const baseDelay = Math.pow(2, attempt) * 100;
          const jitter = Math.random() * 100;
          const delay = baseDelay + jitter;

          this.logger.info(`Retrying ${requestName || config.path} (attempt ${attempt + 1}/${effectiveMaxRetries + 1}) after ${delay.toFixed(0)}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        this.logger.debug(`Making request: ${config.method.toUpperCase()} ${config.path}`);

        const response = await this._fetch(baseURL, {
          ...config,
          signal: options?.signal as AbortSignal | undefined,
          timeout: effectiveTimeout,
        });

        if (!response.ok) {
          const status = response.status;
          const headers = this.headersToRecord(response.headers);
          const { message, errorData } = await this.parseErrorResponse(response);

          // Check if we should retry based on status code
          const canRetry = this.shouldRetry(status);

          if (canRetry && attempt < effectiveMaxRetries) {
            this.logger.warn(`Request ${requestName || config.path} failed with status ${status} (attempt ${attempt + 1}/${effectiveMaxRetries + 1}), will retry`, {
              error: message,
              status: status
            });
            lastError = makeStatusError(status, errorData, message, headers);
            continue;
          }

          // No more retries or not retryable
          this.logger.error(`Request ${requestName || config.path} failed after ${attempt + 1} attempts`);
          throw makeStatusError(status, errorData, message, headers);
        }

        // Handle empty responses (e.g., DELETE returning 200 with no body)
        const text = await response.text();
        if (!text) return {} as T;
        const data = JSON.parse(text) as T;
        return data;
      } catch (error: any) {
        lastError = error;

        // If it's already a WrangleError (from status error above), and no more retries, throw it
        if (error instanceof WrangleError) {
          // Check if it's retryable and we have attempts left
          if (this.shouldRetry(error.status) && attempt < effectiveMaxRetries) {
            continue;
          }
          throw error;
        }

        // AbortError from user — don't retry
        if (error.name === 'AbortError') {
          throw error;
        }

        // Network/connection errors — retry if attempts remain
        if (error instanceof APIConnectionError && attempt < effectiveMaxRetries) {
          this.logger.warn(`Request ${requestName || config.path} failed with connection error (attempt ${attempt + 1}/${effectiveMaxRetries + 1}), will retry`);
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Make a request and return the full Response (for streaming).
   * Similar to makeRequest but returns raw Response instead of parsed JSON.
   */
  private async makeStreamRequest(
    baseURL: string,
    config: FetchRequestConfig,
    options?: RequestOptions
  ): Promise<Response> {
    const effectiveTimeout = options?.timeout || this.timeout;

    const response = await this._fetch(baseURL, {
      ...config,
      signal: options?.signal as AbortSignal | undefined,
      timeout: effectiveTimeout,
    });

    if (!response.ok) {
      const status = response.status;
      const headers = this.headersToRecord(response.headers);
      const { message, errorData } = await this.parseErrorResponse(response);
      throw makeStatusError(status, errorData, message, headers);
    }

    return response;
  }

  /**
   * Chat Completions API
   */
  public chat = {
    completions: {
      /**
       * Creates a completion for the chat message.
       */
      create: ((params: ChatCompletionCreateParams, options?: RequestOptions) => {
        return this.createChatRequest(params, options);
      }) as {
        (params: ChatCompletionCreateParams & { stream: true }, options?: RequestOptions): Promise<Stream<ChatCompletionChunk>>;
        (params: ChatCompletionCreateParams & { stream?: false }, options?: RequestOptions): Promise<ChatCompletion>;
        (params: ChatCompletionCreateParams, options?: RequestOptions): Promise<ChatCompletion | Stream<ChatCompletionChunk>>;
      },
    },
  };

  /**
   * Internal method to handle the branching logic for streaming vs standard
   */
  private async createChatRequest(
    params: ChatCompletionCreateParams,
    options?: RequestOptions
  ): Promise<ChatCompletion | Stream<ChatCompletionChunk>> {
    try {
      if (params.stream) {
        // Streaming Request — get raw Response
        const response = await this.makeStreamRequest(
          this.baseURL,
          { method: 'POST', path: '/chat/completions', body: params }
        );

        // Extract request ID from headers
        const requestId = response.headers.get('x-request-id') || undefined;

        if (!response.body) {
          throw new WrangleError('No response body received for streaming request');
        }

        // Pass the ReadableStream to our generator with request ID
        return StreamChatCompletion(response.body, requestId);

      } else {
        // Standard Request
        const response = await this._fetch(this.baseURL, {
          method: 'POST',
          path: '/chat/completions',
          body: params,
          signal: options?.signal as AbortSignal | undefined,
          timeout: options?.timeout || this.timeout,
        });

        if (!response.ok) {
          const status = response.status;
          const headers = this.headersToRecord(response.headers);
          const { message, errorData } = await this.parseErrorResponse(response);
          throw makeStatusError(status, errorData, message, headers);
        }

        const data = await response.json() as ChatCompletion;

        // Extract and attach request ID
        const requestId = response.headers.get('x-request-id');
        if (requestId && data) {
          data.request_id = requestId;
        }

        return data;
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Wrangle-Specific API Routes
   */
  public models = {
    /**
     * Lists the currently available models.
     */
    list: async (options?: RequestOptions) => {
      try {
        return await this.makeRequest<ModelsListResponse>(
          this.baseURL,
          { method: 'GET', path: '/models' },
          options,
          'models.list'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },
  };

  public usage = {
    retrieve: async (
      params?: { startDate?: string; endDate?: string },
      options?: RequestOptions
    ) => {
      try {
        return await this.makeRequest<UsageResponse>(
          this.baseURL,
          { method: 'GET', path: '/usage', query: params as any },
          options,
          'usage.retrieve'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },

    retrieveByModel: async (
      model: string,
      params?: { startDate?: string; endDate?: string },
      options?: RequestOptions
    ) => {
      try {
        return await this.makeRequest<UsageResponse>(
          this.baseURL,
          { method: 'GET', path: '/usage/model', query: { ...params, model } as any },
          options,
          'usage.retrieveByModel'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },
  };

  public cost = {
    retrieve: async (
      params?: { startDate?: string; endDate?: string },
      options?: RequestOptions
    ) => {
      try {
        return await this.makeRequest<CostResponse>(
          this.baseURL,
          { method: 'GET', path: '/cost', query: params as any },
          options,
          'cost.retrieve'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },
  };

  /**
   * Sustainability API - Track environmental impact of AI usage
   */
  public sustainability = {
    /**
     * Get sustainability report for user's AI usage.
     * @param params - Query parameters including startDate and endDate
     * @param options - Request options (abort signal, timeout, retries)
     */
    retrieve: async (
      params?: { startDate?: string; endDate?: string },
      options?: RequestOptions
    ): Promise<SustainabilityReport> => {
      try {
        return await this.makeRequest<SustainabilityReport>(
          this.baseURL,
          { method: 'GET', path: '/sustainability', query: params as any },
          options,
          'sustainability.retrieve'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },
  };

  public keys = {
    verify: async (options?: RequestOptions) => {
      try {
        return await this.makeRequest<KeyVerifyResponse>(
          this.baseURL,
          {
            method: 'GET',
            path: '/keys/verify',
            headers: {
              'X-API-Key': this.apiKey
            }
          },
          options,
          'keys.verify'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },
  };

  /**
   * Files API
   */
  public files = {
    /**
     * Upload a file.
     */
    create: async (file: Buffer | Uint8Array | Blob, purpose: string = 'assistants', filename?: string): Promise<FileObject> => {
      try {
        const formData = new FormData();
        const fname = filename || 'upload';

        // Infer MIME type from filename extension so the server doesn't reject as application/octet-stream
        const mimeType = this.inferMimeType(fname);

        // Convert Buffer/Uint8Array to Blob for native FormData
        const blob = file instanceof Blob ? file : new Blob([file as BlobPart], { type: mimeType });
        formData.append('file', blob, fname);
        formData.append('purpose', purpose);

        const response = await this._fetch(this.ragBaseURL, {
          method: 'POST',
          path: '/files',
          body: formData,
        });

        if (!response.ok) {
          const status = response.status;
          const headers = this.headersToRecord(response.headers);
          const { message, errorData } = await this.parseErrorResponse(response);
          throw makeStatusError(status, errorData, message, headers);
        }

        return await response.json() as FileObject;
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * List files.
     */
    list: async (params?: {
      purpose?: string;
      limit?: number;
      order?: 'asc' | 'desc';
      after?: string;
    }): Promise<FileListResponse> => {
      try {
        return await this.makeRequest<FileListResponse>(
          this.ragBaseURL,
          { method: 'GET', path: '/files', query: params as any },
          undefined,
          'files.list'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * Get file metadata.
     */
    retrieve: async (fileId: string): Promise<FileObject> => {
      try {
        return await this.makeRequest<FileObject>(
          this.ragBaseURL,
          { method: 'GET', path: `/files/${fileId}` },
          undefined,
          'files.retrieve'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * Delete a file.
     */
    delete: async (fileId: string): Promise<FileDeleted> => {
      try {
        return await this.makeRequest<FileDeleted>(
          this.ragBaseURL,
          { method: 'DELETE', path: `/files/${fileId}` },
          undefined,
          'files.delete'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },
  };

  /**
   * Vector Stores API
   */
  public vector_stores = {
    /**
     * Create a vector store.
     */
    create: async (params?: {
      name?: string;
      file_ids?: string[];
      metadata?: Record<string, string>;
      expires_after?: { anchor: string; days: number };
      chunking_strategy?: Record<string, unknown>;
    }): Promise<VectorStore> => {
      try {
        return await this.makeRequest<VectorStore>(
          this.ragBaseURL,
          { method: 'POST', path: '/vector_stores', body: params || {} },
          undefined,
          'vector_stores.create'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * List vector stores.
     */
    list: async (params?: {
      limit?: number;
      order?: 'asc' | 'desc';
      after?: string;
      before?: string;
    }): Promise<VectorStoreListResponse> => {
      try {
        return await this.makeRequest<VectorStoreListResponse>(
          this.ragBaseURL,
          { method: 'GET', path: '/vector_stores', query: params as any },
          undefined,
          'vector_stores.list'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * Get a vector store.
     */
    retrieve: async (vectorStoreId: string): Promise<VectorStore> => {
      try {
        return await this.makeRequest<VectorStore>(
          this.ragBaseURL,
          { method: 'GET', path: `/vector_stores/${vectorStoreId}` },
          undefined,
          'vector_stores.retrieve'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * Update a vector store.
     */
    update: async (
      vectorStoreId: string,
      params?: {
        name?: string;
        metadata?: Record<string, string>;
        expires_after?: { anchor: string; days: number };
      }
    ): Promise<VectorStore> => {
      try {
        return await this.makeRequest<VectorStore>(
          this.ragBaseURL,
          { method: 'POST', path: `/vector_stores/${vectorStoreId}`, body: params || {} },
          undefined,
          'vector_stores.update'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * Delete a vector store.
     */
    delete: async (vectorStoreId: string): Promise<VectorStoreDeleted> => {
      try {
        return await this.makeRequest<VectorStoreDeleted>(
          this.ragBaseURL,
          { method: 'DELETE', path: `/vector_stores/${vectorStoreId}` },
          undefined,
          'vector_stores.delete'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * Search a vector store.
     */
    search: async (
      vectorStoreId: string,
      params: {
        query: string | string[];
        filters?: Record<string, unknown>;
        max_num_results?: number;
        ranking_options?: Record<string, unknown>;
        rewrite_query?: boolean;
      }
    ): Promise<VectorStoreSearchResponse> => {
      try {
        return await this.makeRequest<VectorStoreSearchResponse>(
          this.ragBaseURL,
          { method: 'POST', path: `/vector_stores/${vectorStoreId}/search`, body: params },
          undefined,
          'vector_stores.search'
        );
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * Vector Store Files API
     */
    files: {
      /**
       * Add a file to a vector store.
       */
      create: async (
        vectorStoreId: string,
        params: {
          file_id: string;
          attributes?: Record<string, string | number | boolean>;
          chunking_strategy?: Record<string, unknown>;
        }
      ): Promise<VectorStoreFile> => {
        try {
          return await this.makeRequest<VectorStoreFile>(
            this.ragBaseURL,
            { method: 'POST', path: `/vector_stores/${vectorStoreId}/files`, body: params },
            undefined,
            'vector_stores.files.create'
          );
        } catch (error) {
          throw this.handleError(error);
        }
      },

      /**
       * List files in a vector store.
       */
      list: async (
        vectorStoreId: string,
        params?: {
          limit?: number;
          order?: 'asc' | 'desc';
          after?: string;
          before?: string;
          filter?: 'in_progress' | 'completed' | 'failed' | 'cancelled';
        }
      ): Promise<VectorStoreFileListResponse> => {
        try {
          return await this.makeRequest<VectorStoreFileListResponse>(
            this.ragBaseURL,
            { method: 'GET', path: `/vector_stores/${vectorStoreId}/files`, query: params as any },
            undefined,
            'vector_stores.files.list'
          );
        } catch (error) {
          throw this.handleError(error);
        }
      },

      /**
       * Get a vector store file.
       */
      retrieve: async (vectorStoreId: string, fileId: string): Promise<VectorStoreFile> => {
        try {
          return await this.makeRequest<VectorStoreFile>(
            this.ragBaseURL,
            { method: 'GET', path: `/vector_stores/${vectorStoreId}/files/${fileId}` },
            undefined,
            'vector_stores.files.retrieve'
          );
        } catch (error) {
          throw this.handleError(error);
        }
      },

      /**
       * Update file attributes in a vector store.
       */
      update: async (
        vectorStoreId: string,
        fileId: string,
        params: {
          attributes: Record<string, string | number | boolean>;
        }
      ): Promise<VectorStoreFile> => {
        try {
          return await this.makeRequest<VectorStoreFile>(
            this.ragBaseURL,
            { method: 'POST', path: `/vector_stores/${vectorStoreId}/files/${fileId}`, body: params },
            undefined,
            'vector_stores.files.update'
          );
        } catch (error) {
          throw this.handleError(error);
        }
      },

      /**
       * Remove a file from a vector store.
       */
      delete: async (vectorStoreId: string, fileId: string): Promise<VectorStoreFileDeleted> => {
        try {
          return await this.makeRequest<VectorStoreFileDeleted>(
            this.ragBaseURL,
            { method: 'DELETE', path: `/vector_stores/${vectorStoreId}/files/${fileId}` },
            undefined,
            'vector_stores.files.delete'
          );
        } catch (error) {
          throw this.handleError(error);
        }
      },
    },
  };

  private handleError(error: any): WrangleError {
    // If error is already a WrangleError, return it as-is
    if (error instanceof WrangleError) {
      return error;
    }

    // AbortError from user cancellation
    if (error.name === 'AbortError') {
      return new APIConnectionError('Request was aborted', { error });
    }

    // Network/connection errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return new APIConnectionError(error.message, { error });
    }

    // TypeError from fetch (e.g., network failures)
    if (error instanceof TypeError) {
      return new APIConnectionError(error.message || 'Network connection failed', { error });
    }

    // Unknown errors
    return new WrangleError(error.message || 'An unknown error occurred', { error });
  }
}

export default WrangleAI;