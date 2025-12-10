
# Wrangle AI Node.js Library

The official Node.js library for the **WrangleAI**.

Wrangle AI provides a high-performance, drop-in replacement for the OpenAI SDK that adds **Smart Routing**, **Cost Tracking**, and **Enterprise Governance**. It enables you to route prompts to the most capable and cost-effective models (GPT-5, Gemini 2.5, Mistral etc.) automatically, without rewriting your application logic.

[![NPM version](https://img.shields.io/npm/v/wrangleai.svg)](https://npmjs.org/package/wrangleai)
[![License](https://img.shields.io/npm/l/wrangleai.svg)](https://npmjs.org/package/wrangleai)
[![TypeScript](https://img.shields.io/badge/types-included-blue)](https://www.typescriptlang.org/)

## Features

*   **Drop-in Compatibility:** Uses the same API signature as the official OpenAI SDK.
*   **Smart Routing (`model: "auto"`):** The Gateway analyzes your prompt complexity and routes it to the optimal model to save costs and tokens.
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

---

## Management API

The SDK provides specific endpoints to monitor your usage and costs programmatically.

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

## Error Handling

Errors are thrown as standard JavaScript errors with status codes and messages populated from the Gateway.

```typescript
try {
  await client.chat.completions.create({ ... });
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message); // e.g. "WrangleAI Error [402]: Budget exceeded"
  }
}
```

## Requirements

*   Node.js 18+ (recommended) or Node.js 14+ with polyfills.
*   A Wrangle AI API Key.

## License

MIT
