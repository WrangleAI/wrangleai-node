
# Wrangle AI Node.js Library

The official Node.js library for the **WrangleAI**.

Wrangle AI provides a high-performance, drop-in replacement for the OpenAI SDK that adds **Smart Routing**, **Cost Tracking**, and **Enterprise Governance**. It enables you to route prompts to the most capable and cost-effective models (GPT-5, Gemini 2.5, Mistral etc.) automatically, without rewriting your application logic.

[![NPM version](https://img.shields.io/npm/v/wrangleai.svg)](https://npmjs.org/package/wrangleai)
[![License](https://img.shields.io/npm/l/wrangleai.svg)](https://npmjs.org/package/wrangleai)
[![TypeScript](https://img.shields.io/badge/types-included-blue)](https://www.typescriptlang.org/)

## Features

*   **Drop-in Compatibility:** Uses the same API signature as the official OpenAI SDK.
*   **Smart Routing (`model: "auto"`):** The Gateway analyzes your prompt complexity and routes it to the optimal model to save costs and tokens.
*   **Structured Exception Handling:** OpenAI-compatible error classes with detailed context (status, request_id, headers).
*   **Request ID Tracking:** Every response includes `_request_id` for debugging and support.
*   **Web Search / Grounding:** Built-in support for live web access with citations.
*   **Usage & Cost APIs:** Programmatic access to your token usage and spend.
*   **Streaming Support:** Full support for Server-Sent Events (SSE).
*   **TypeScript:** First-class typing included.

---

## Installation

```bash
npm install wrangleai
```

---

## Usage

### 1. Quick Start (Smart Routing)

The simplest way to use Wrangle AI is to set the model to `"auto"`. The Gateway will evaluate the prompt and select the best model (e.g., routing simple queries to `gpt-4o-mini` and complex coding tasks to `gpt-5` or `gemini-2.5-pro`).

```typescript
import WrangleAI from 'wrangleai';

const client = new WrangleAI({
  apiKey: process.env.WRANGLE_API_KEY, // Defaults to this env var if omitted
});

async function main() {
  const completion = await client.chat.completions.create({
    messages: [{ role: 'user', content: 'Explain quantum computing in one sentence.' }],
    model: 'auto', // <--- The Magic: Let the Gateway decide
  });

  console.log(completion.choices[0].message.content);
}

main();
```

### 2. Standard Models

You can still request specific models if you need deterministic behavior. Wrangle AI supports all major providers through a unified API.

```typescript
const completion = await client.chat.completions.create({
  messages: [{ role: 'user', content: 'Hello!' }],
  model: 'gpt-4o', // or 'gemini-2.5-pro', 'gpt-5-mini', etc.
});
```

### 3. Streaming Responses

Streaming works exactly like the OpenAI SDK.

```typescript
const stream = await client.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: 'Write a haiku about servers.' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

### 4. Web Search (Grounding)

Wrangle AI supports live web access. When using the `web_search` tool, the response comes in the **Responses API** format, which includes detailed citations.

```typescript
const completion = await client.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: 'What is the current stock price of Apple?' }],
  tools: [{
    type: 'web_search',
    web_search: { external_web_access: true }
  }]
});

// Accessing the response
if (completion.choices) {
  // Standard Response
  console.log(completion.choices[0].message.content);
} else if (completion.output) {
  // Grounded Response with Citations
  const message = completion.output.find(i => i.type === 'message');
  
  // Print Text
  console.log(message.content[0].text);
  
  // Print Citations
  message.content[0].annotations?.forEach(cite => {
    console.log(`Source: ${cite.title} (${cite.url})`);
  });
}
```

### 5. Function Calling

Define tools and let the model decide when to call them. Compatible with standard OpenAI tool definitions.

```typescript
const completion = await client.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
  tools: [{
    type: 'function',
    function: {
      name: 'get_weather',
      parameters: { /* JSON Schema */ }
    }
  }]
});
```



## 6. Efficiency-First Routing (SLM) [BETA]

Use the **Efficiency Tier** to route tasks to specialized Small Language Models (SLMs) for maximum speed and cost savings. This tier is ideal for high-volume tasks like coding snippets, summarization, and data extraction.

### Basic SLM Request

By setting `useSlm: true`, WrangleAI will automatically select the best cost-effective model (e.g., `mistral-nemo`, `llama-3.1-8b`) based on prompt complexity.

```typescript
const completion = await client.chat.completions.create({
  model: "auto",
  slm: {
    useSlm: true,
    useCase: "coding" // Optional: 'chat', 'reasoning', 'summarization', etc.
  },
  messages: [{ role: "user", content: "Write a JavaScript function to reverse a string." }]
});
```

### Auto-Scaling for Tools

The Efficiency Tier is tool-aware. If you enable `slm` and `tool_use` in `useCase` in your request, the WrangleAI router will **automatically pivot** to high-capability SLMs to ensure strict JSON schema adherence and reliable function calling.

This gives you the best of both worlds: low cost for standard text generation, and high reliability for agentic workflows.

```typescript
const completion = await client.chat.completions.create({
  model: "auto",
  slm: { useSlm: true, useCase: "tool_use"},
  messages: [{ role: "user", content: "Get the stock price for NVDA." }],
  tools: [{
    type: "function",
    function: {
      name: "get_stock_price",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string" } },
        required: ["symbol"]
      }
    }
  }]
});
```

### Supported Use Cases

Providing a `useCase` helps the router select a specialist model.

| Use Case | Description |
| :--- | :--- |
| `coding` | Optimized for Python, JS, SQL, and debugging. |
| `reasoning` | Tuned for math, logic puzzles, and multi-step deduction. |
| `chat` | Optimized for natural conversation flow and "human" vibes. |
| `summarization` | High-context window models for condensing text. |
| `classification` | Fast, low-latency models for tagging and labeling. |
| `creative_writing` | Tuned for storytelling and reduced refusal rates. |
| `tool_use` | High reliability function calling capabilities. |
| `other` | (Default) General-purpose instruction following. |

> **Pro Tip:** For complex tool-use scenarios with SLMs, we recommend adding a system prompt instructing the model to "Always use the provided tool if applicable" to overcome potential passivity in smaller models.
---

## Management API

The SDK provides specific endpoints to monitor your usage and costs programmatically.

### List Available Models

Get a list of all currently available models. Compatible with OpenAI's `client.models.list()`.

```typescript
const models = await client.models.list();

console.log('Available models:');
models.data.forEach(model => {
  console.log(`- ${model.id} (${model.owned_by})`);
});
```

### Get Usage Stats
```typescript
// Get stats for all models (optional date range)
const usage = await client.usage.retrieve({ 
  startDate: '2023-01-01', 
  endDate: '2023-12-31' 
});

console.log(`Total Requests: ${usage.total_requests}`);
console.log(`Optimized Requests: ${usage.optimized}`);
```

### Get Total Cost
```typescript
const cost = await client.cost.retrieve();
console.log(`Current Spend: $${cost.total_cost}`);
```

### Verify API Key
```typescript
const verify = await client.keys.verify();
if (verify.valid) {
  console.log(`Key Status: ${verify.keyStatus}`);
}
```

---

## RAG API (Files & Vector Stores)

WrangleAI provides a complete RAG (Retrieval-Augmented Generation) API for file management and vector search operations.

### Files API

Upload and manage files for use in vector stores:

```typescript
// Upload a file
const fileBuffer = fs.readFileSync('document.txt');
const file = await client.files.create(fileBuffer, 'assistants');
console.log(`Uploaded: ${file.id}`);

// List all files
const filesList = await client.files.list({ limit: 10 });
filesList.data.forEach(file => {
  console.log(`${file.filename} - ${file.bytes} bytes`);
});

// Retrieve file metadata
const fileObj = await client.files.retrieve('file-abc123');

// Delete a file
await client.files.delete('file-abc123');
```

### Vector Stores API

Create and manage vector stores for semantic search:

```typescript
// Create a vector store
const vectorStore = await client.vector_stores.create({
  name: 'Knowledge Base',
  file_ids: ['file-abc123'], // Optional: add files immediately
  metadata: { category: 'documentation' }
});

// List vector stores
const stores = await client.vector_stores.list({ limit: 5, order: 'desc' });

// Retrieve a vector store
const store = await client.vector_stores.retrieve('vs_abc123');

// Update vector store
const updated = await client.vector_stores.update('vs_abc123', {
  name: 'Updated Knowledge Base'
});

// Search within a vector store
const results = await client.vector_stores.search('vs_abc123', {
  query: 'How do I authenticate?',
  max_num_results: 5
});

results.data.forEach(result => {
  console.log(`Score: ${result.score}`);
  console.log(`Content: ${result.content[0].text}`);
  console.log(`File: ${result.filename}`);
});

// Delete vector store
await client.vector_stores.delete('vs_abc123');
```

### Vector Store Files

Manage files within vector stores:

```typescript
// Add file to vector store
const vsFile = await client.vector_stores.files.create('vs_abc123', {
  file_id: 'file-abc123',
  attributes: { source: 'documentation' }
});

// List files in vector store
const files = await client.vector_stores.files.list('vs_abc123', {
  filter: 'completed' // or 'in_progress', 'failed', 'cancelled'
});

// Get file from vector store
const file = await client.vector_stores.files.retrieve('vs_abc123', 'file-abc123');

// Update file attributes
const updatedFile = await client.vector_stores.files.update('vs_abc123', 'file-abc123', {
  attributes: { updated: 'true' }
});

// Remove file from vector store
await client.vector_stores.files.delete('vs_abc123', 'file-abc123');
```

---

## Error Handling

The SDK provides structured exception classes matching the OpenAI SDK pattern. All errors include status codes, request IDs, and detailed context for debugging.

### Exception Types

```typescript
import WrangleAI from 'wrangleai';

try {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }]
  });
} catch (error) {
  if (error instanceof WrangleAI.AuthenticationError) {
    // 401: Invalid or missing API key
    console.error('Auth failed:', error.status, error.request_id);
  } else if (error instanceof WrangleAI.RateLimitError) {
    // 429: Rate limit exceeded
    console.error('Rate limited:', error.headers?.['retry-after']);
  } else if (error instanceof WrangleAI.BadRequestError) {
    // 400: Malformed request
    console.error('Bad request:', error.error);
  } else if (error instanceof WrangleAI.NotFoundError) {
    // 404: Resource not found
    console.error('Not found:', error.message);
  } else if (error instanceof WrangleAI.APIError) {
    // 500+: Server error
    console.error('API error:', error.status);
  } else if (error instanceof WrangleAI.APIConnectionError) {
    // Network/timeout errors
    console.error('Connection failed:', error.message);
  } else if (error instanceof WrangleAI.WrangleError) {
    // Base class for all SDK errors
    console.error('SDK error:', error.message);
  }
}
```

### Error Properties

All error classes provide:

| Property | Type | Description |
|----------|------|-------------|
| `message` | `string` | Human-readable error message |
| `status` | `number?` | HTTP status code (if applicable) |
| `request_id` | `string?` | Request ID for debugging with support |
| `headers` | `Record<string, string>?` | Response headers |
| `error` | `any?` | Raw error object from API |

### Request ID Tracking

Every response includes a `_request_id` property for debugging:

```typescript
const completion = await client.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: 'Test' }]
});

// Log request ID for support tickets
console.log('Request ID:', completion._request_id);

// Available in streaming too
const stream = await client.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: 'Test' }],
  stream: true
});

for await (const chunk of stream) {
  console.log('Chunk Request ID:', chunk._request_id);
}
```

## Requirements

*   Node.js 18+ (recommended) or Node.js 14+ with polyfills.
*   A Wrangle AI API Key.

## License

MIT
