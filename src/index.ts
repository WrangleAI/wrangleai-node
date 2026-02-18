import axios, { AxiosInstance } from 'axios';
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
  VectorStoreSearchResponse
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

export class WrangleAI {
  private client: AxiosInstance;
  private ragClient: AxiosInstance;
  private apiKey: string;
  private ragBaseURL: string;

  constructor(options: ClientOptions) {
    if (!options.apiKey) {
      throw new Error("The WrangleAI client requires an apiKey argument");
    }

    this.apiKey = options.apiKey;
    const baseURL = options.baseURL || "https://gateway.wrangleai.com/v1";
    
    // Auto-detect RAG base URL (port 8085) if not provided
    this.ragBaseURL = options.ragBaseURL || baseURL.replace(':8080', ':8085');

    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: options.timeout || 60000,
    });
    
    // RAG client for files and vector stores (port 8085)
    this.ragClient = axios.create({
      baseURL: this.ragBaseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: options.timeout || 60000,
    });
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
     * Compatible with OpenAI's models.list() endpoint.
     */
    list: async () => {
      try {
        const response = await this.client.get<ModelsListResponse>('/models');
        return response.data;
      } catch (error) {
        throw this.handleError(error);
      }
    },
  };

  public usage = {
    retrieve: async (params?: { startDate?: string; endDate?: string }) => {
      try {
        const response = await this.client.get<UsageResponse>('/usage', { params });
        return response.data;
      } catch (error) {
        throw this.handleError(error);
      }
    },

    retrieveByModel: async (model: string, params?: { startDate?: string; endDate?: string }) => {
      try {
        const response = await this.client.get<UsageResponse>('/usage/model', { 
          params: { ...params, model } 
        });
        return response.data;
      } catch (error) {
        throw this.handleError(error);
      }
    },
  };

  public cost = {
    retrieve: async (params?: { startDate?: string; endDate?: string }) => {
      try {
        const response = await this.client.get<CostResponse>('/cost', { params });
        return response.data;
      } catch (error) {
        throw this.handleError(error);
      }
    },
  };

  public keys = {
    verify: async () => {
      try {
        const response = await this.client.get<KeyVerifyResponse>('/keys/verify', {
          headers: {
            'X-API-Key': this.apiKey
          }
        });
        return response.data;
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
    create: async (file: Buffer, purpose: string = 'assistants'): Promise<FileObject> => {
      try {
        const formData = new FormData();
        formData.append('file', file, { filename: 'upload' });
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