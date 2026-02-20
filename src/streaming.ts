import { ChatCompletionChunk } from './types';

/**
 * Helper to convert a ReadableStream to an async iterable.
 * Required for Node < 22 where ReadableStream doesn't implement Symbol.asyncIterator.
 */
function readableStreamToAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterable<T> {
  // If the stream already supports async iteration (Node 22+, some browsers), use it directly
  if (Symbol.asyncIterator in stream) {
    return stream as any;
  }

  // Fallback: use the reader API
  const reader = stream.getReader();
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<T>> {
          try {
            const { done, value } = await reader.read();
            if (done) {
              reader.releaseLock();
              return { done: true, value: undefined };
            }
            return { done: false, value };
          } catch (e) {
            reader.releaseLock();
            throw e;
          }
        },
        async return(): Promise<IteratorResult<T>> {
          const cancelPromise = reader.cancel();
          reader.releaseLock();
          await cancelPromise;
          return { done: true, value: undefined };
        }
      };
    }
  };
}

/**
 * Parses a ReadableStream of Server-Sent Events (SSE) 
 * and yields typed ChatCompletionChunk objects.
 * 
 * @param responseStream - The ReadableStream<Uint8Array> from fetch response.body
 * @param requestId - Optional request ID from x-request-id header
 */
export async function* StreamChatCompletion(
  responseStream: ReadableStream<Uint8Array>,
  requestId?: string
): AsyncIterable<ChatCompletionChunk> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  for await (const chunk of readableStreamToAsyncIterable(responseStream)) {
    // Decode the current chunk and append to buffer
    buffer += decoder.decode(chunk, { stream: true });

    // Split by newlines
    const lines = buffer.split('\n');

    // Keep the last partial line in the buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for standard SSE prefix
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6); // Remove 'data: '

        // Check for stream termination
        if (data === '[DONE]') {
          return;
        }

        try {
          const parsed = JSON.parse(data) as ChatCompletionChunk;

          // Attach request ID to chunk if available
          if (requestId) {
            parsed.request_id = requestId;
          }

          yield parsed;
        } catch (e) {
          console.warn('WrangleSDK: Failed to parse SSE chunk', e);
        }
      }
    }
  }
}