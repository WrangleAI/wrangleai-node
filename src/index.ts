import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import FormData from 'form-data';
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
  constructor(private level: LogLevel) {}

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

export class WrangleAI {
  private client: AxiosInstance;
  private ragClient: AxiosInstance;
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

    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: this.timeout,
    });
    
    // Add error interceptor to convert axios errors to our custom errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          // Extract error message from response data
          const data = error.response.data;
          const message = data?.error?.message || data?.message || data?.error || error.message;
          
          // Convert axios error with response to our custom error
          throw makeStatusError(error.response.status, error, message, error.response.headers);
        }
        // Network error or other axios error
        throw error;
      }
    );
    
    // RAG client for files and vector stores (port 8085)
    this.ragClient = axios.create({
      baseURL: this.ragBaseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: this.timeout,
    });
    
    // Add error interceptor for RAG client too
    this.ragClient.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          const data = error.response.data;
          const message = data?.error?.message || data?.message || data?.error || error.message;
          throw makeStatusError(error.response.status, error, message, error.response.headers);
        }
        throw error;
      }
    );
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
   * Retry logic with exponential backoff
   */
  private async retryRequest<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    requestName: string
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff: 2^attempt * 100ms + jitter
          const baseDelay = Math.pow(2, attempt) * 100;
          const jitter = Math.random() * 100;
          const delay = baseDelay + jitter;
          
          this.logger.info(`Retrying ${requestName} (attempt ${attempt + 1}/${maxRetries + 1}) after ${delay.toFixed(0)}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        return await fn();
      } catch (error: any) {
        lastError = error;
        
        // Extract status code from error (works for both axios errors and our custom errors)
        const status = error.response?.status || error.status;
        
        // Don't retry on certain status codes:
        // - 4xx errors except 429 (rate limit) and 408 (timeout)
        // - Authentication, bad request, not found errors should not be retried
        const shouldNotRetry = 
          error instanceof AuthenticationError ||
          error instanceof BadRequestError ||
          error instanceof NotFoundError ||
          (status && status >= 400 && status < 500 && status !== 429 && status !== 408);
        
        if (shouldNotRetry || attempt === maxRetries) {
          this.logger.error(`Request ${requestName} failed after ${attempt + 1} attempts`, error);
          throw error;
        }
        
        this.logger.warn(`Request ${requestName} failed (attempt ${attempt + 1}), will retry`, {
          error: error.message,
          status: status
        });
      }
    }
    
    throw lastError;
  }

  /**
   * Make a request with retry and abort signal support
   */
  private async makeRequest<T>(
    client: AxiosInstance,
    config: AxiosRequestConfig,
    options?: RequestOptions,
    requestName?: string
  ): Promise<T> {
    const effectiveMaxRetries = options?.maxRetries ?? this.maxRetries;
    const effectiveTimeout = options?.timeout || this.timeout;
    
    // Add abort signal support
    if (options?.signal) {
      config.signal = options.signal as any;
    }
    
    // Override timeout if specified
    if (options?.timeout) {
      config.timeout = effectiveTimeout;
    }

    return this.retryRequest<T>(
      async () => {
        this.logger.debug(`Making request: ${config.method?.toUpperCase()} ${config.url}`);
        const response = await client.request<T>(config);
        return response.data;
      },
      effectiveMaxRetries,
      requestName || config.url || 'request'
    );
  }

  /**
   * Chat Completions API
   */
  public chat = {
    completions: {
      /**
       * Creates a completion for the chat message.
       */
      create: ((params: ChatCompletionCreateParams) => {
        return this.createChatRequest(params);
      }) as {
        (params: ChatCompletionCreateParams & { stream: true }): Promise<Stream<ChatCompletionChunk>>;
        (params: ChatCompletionCreateParams & { stream?: false }): Promise<ChatCompletion>;
        (params: ChatCompletionCreateParams): Promise<ChatCompletion | Stream<ChatCompletionChunk>>;
      },
    },
  };

  /**
   * Internal method to handle the branching logic for streaming vs standard
   */
  private async createChatRequest(
    params: ChatCompletionCreateParams
  ): Promise<ChatCompletion | Stream<ChatCompletionChunk>> {
    try {
      if (params.stream) {
        // Streaming Request
        const response = await this.client.post('/chat/completions', params, {
          responseType: 'stream', // Critical for Node.js axios
        });
        
        // Extract request ID from headers
        const requestId = response.headers['x-request-id'];
        
        // Pass the raw Node.js stream to our generator with request ID
        return StreamChatCompletion(response.data, requestId);

      } else {
        // Standard Request
        const response = await this.client.post<ChatCompletion>('/chat/completions', params);
        
        // Extract and attach request ID
        const requestId = response.headers['x-request-id'];
        if (requestId && response.data) {
          response.data._request_id = requestId;
        }
        
        return response.data;
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
          this.client,
          { method: 'GET', url: '/models' },
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
          this.client,
          { method: 'GET', url: '/usage', params },
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
          this.client,
          { method: 'GET', url: '/usage/model', params: { ...params, model } },
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
          this.client,
          { method: 'GET', url: '/cost', params },
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
          this.client,
          { method: 'GET', url: '/sustainability', params },
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
          this.client,
          { 
            method: 'GET', 
            url: '/keys/verify',
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
    create: async (file: Buffer, purpose: string = 'assistants', filename?: string): Promise<FileObject> => {
      try {
        const formData = new FormData();
        const fname = filename || 'upload';
        formData.append('file', file, { filename: fname });
        formData.append('purpose', purpose);

        const response = await this.ragClient.post<FileObject>('/files', formData, {
          headers: {
            ...formData.getHeaders()
          }
        });
        return response.data;
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
        const response = await this.ragClient.get<FileListResponse>('/files', { params });
        return response.data;
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * Get file metadata.
     */
    retrieve: async (fileId: string): Promise<FileObject> => {
      try {
        const response = await this.ragClient.get<FileObject>(`/files/${fileId}`);
        return response.data;
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * Delete a file.
     */
    delete: async (fileId: string): Promise<FileDeleted> => {
      try {
        const response = await this.ragClient.delete<FileDeleted>(`/files/${fileId}`);
        return response.data;
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
        const response = await this.ragClient.post<VectorStore>('/vector_stores', params || {});
        return response.data;
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
        const response = await this.ragClient.get<VectorStoreListResponse>('/vector_stores', { params });
        return response.data;
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * Get a vector store.
     */
    retrieve: async (vectorStoreId: string): Promise<VectorStore> => {
      try {
        const response = await this.ragClient.get<VectorStore>(`/vector_stores/${vectorStoreId}`);
        return response.data;
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
        const response = await this.ragClient.post<VectorStore>(
          `/vector_stores/${vectorStoreId}`,
          params || {}
        );
        return response.data;
      } catch (error) {
        throw this.handleError(error);
      }
    },

    /**
     * Delete a vector store.
     */
    delete: async (vectorStoreId: string): Promise<VectorStoreDeleted> => {
      try {
        const response = await this.ragClient.delete<VectorStoreDeleted>(`/vector_stores/${vectorStoreId}`);
        return response.data;
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
        const response = await this.ragClient.post<VectorStoreSearchResponse>(
          `/vector_stores/${vectorStoreId}/search`,
          params
        );
        return response.data;
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
          const response = await this.ragClient.post<VectorStoreFile>(
            `/vector_stores/${vectorStoreId}/files`,
            params
          );
          return response.data;
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
          const response = await this.ragClient.get<VectorStoreFileListResponse>(
            `/vector_stores/${vectorStoreId}/files`,
            { params }
          );
          return response.data;
        } catch (error) {
          throw this.handleError(error);
        }
      },

      /**
       * Get a vector store file.
       */
      retrieve: async (vectorStoreId: string, fileId: string): Promise<VectorStoreFile> => {
        try {
          const response = await this.ragClient.get<VectorStoreFile>(
            `/vector_stores/${vectorStoreId}/files/${fileId}`
          );
          return response.data;
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
          const response = await this.ragClient.post<VectorStoreFile>(
            `/vector_stores/${vectorStoreId}/files/${fileId}`,
            params
          );
          return response.data;
        } catch (error) {
          throw this.handleError(error);
        }
      },

      /**
       * Remove a file from a vector store.
       */
      delete: async (vectorStoreId: string, fileId: string): Promise<VectorStoreFileDeleted> => {
        try {
          const response = await this.ragClient.delete<VectorStoreFileDeleted>(
            `/vector_stores/${vectorStoreId}/files/${fileId}`
          );
          return response.data;
        } catch (error) {
          throw this.handleError(error);
        }
      },
    },
  };

  private handleError(error: any): WrangleError {
    // If error is already a WrangleError (from interceptor), return it as-is
    if (error instanceof WrangleError) {
      return error;
    }
    
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const headers = error.response?.headers as Record<string, string> | undefined;
      
      // Extract error message from response
      let errorMessage = error.message;
      let errorData = error.response?.data;

      // If responseType is stream, data might be a Buffer, try to parse it
      if (error.response?.data && !Buffer.isBuffer(error.response.data)) {
        const data = error.response.data as any;
        errorMessage = data?.error?.message || data?.message || data?.error || error.message;
        errorData = data;
      }

      // Use structured error mapping
      return makeStatusError(status, errorData, errorMessage, headers);
    }
    
    // Network/connection errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return new APIConnectionError(error.message, { error });
    }
    
    // Unknown errors
    return new WrangleError(error.message || 'An unknown error occurred', { error });
  }
}

export default WrangleAI;