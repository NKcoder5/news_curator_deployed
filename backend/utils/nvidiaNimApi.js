const axios = require('axios');

const NIM_API_KEY = process.env.NIM_API_KEY;
const NIM_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL_NAME = process.env.NIM_MODEL_NAME || 'meta/llama-3.1-8b-instruct';

/**
 * Call the NVIDIA NIM API with a prompt
 * @param {string} prompt - The prompt to send to the API
 * @param {Object} options - Additional options for the API call
 * @returns {Promise<string>} - The response text from the API
 */
const callNimApi = async (prompt, options = {}) => {
  try {
    if (!NIM_API_KEY) {
      throw new Error('NIM_API_KEY is not set. Add it to your backend .env file.');
    }

    const headers = {
      "Authorization": `Bearer ${NIM_API_KEY}`,
      "Accept": "application/json"
    };

    const payload = {
      "model": MODEL_NAME,
      "messages": [
        {
          "role": "user",
          "content": prompt
        }
      ],
      "max_tokens": options.maxTokens || 512,
      "temperature": options.temperature !== undefined ? options.temperature : 0.7,
      "top_p": options.topP || 1.00,
      "stream": false
    };

    const response = await axios.post(NIM_API_URL, payload, { headers });

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      return response.data.choices[0].message.content.trim();
    } else {
      throw new Error('Invalid response format from NVIDIA NIM API');
    }
  } catch (error) {
    if (error.response) {
      console.error('NVIDIA NIM API Error:', error.response.status, error.response.data);
      if (error.response.status === 403 || error.response.status === 401) {
        throw new Error('NVIDIA NIM API Key is invalid or expired. Please update NIM_API_KEY in your .env file.');
      }
    } else {
      console.error('Error calling NVIDIA NIM API:', error.message);
    }
    throw error;
  }
};

/**
 * Extract the first JSON object or array embedded in a text response.
 * Handles code fences and leading/trailing prose around the JSON.
 * @param {string} text - Raw LLM output
 * @returns {Object|Array} - Parsed JSON
 */
const extractJson = (text) => {
  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  // Try direct parse first
  try {
    return JSON.parse(candidate.trim());
  } catch (_) { /* fall through */ }

  // Find the first balanced {...} or [...] block
  const start = candidate.search(/[{[]/);
  if (start === -1) throw new Error('No JSON found in LLM response');
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, i + 1));
      }
    }
  }
  throw new Error('Unbalanced JSON in LLM response');
};

/**
 * Call the NIM API expecting a structured JSON response.
 * Uses low temperature for deterministic output and retries once on parse failure.
 * @param {string} prompt - Prompt that instructs the model to answer in JSON
 * @param {Object} options - API options (maxTokens etc.)
 * @returns {Promise<Object|Array>} - Parsed JSON response
 */
const callNimApiJson = async (prompt, options = {}) => {
  const jsonOptions = { temperature: 0.2, ...options };
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callNimApi(prompt, jsonOptions);
    try {
      return extractJson(text);
    } catch (err) {
      lastError = err;
      console.warn(`JSON parse failed (attempt ${attempt + 1}):`, err.message);
    }
  }
  throw lastError;
};

module.exports = { callNimApi, callNimApiJson, extractJson };
