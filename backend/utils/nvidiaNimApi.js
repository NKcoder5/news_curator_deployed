const axios = require('axios');

const NIM_API_KEY = process.env.NIM_API_KEY || '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';
const NIM_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL_NAME = process.env.NIM_MODEL_NAME || 'meta/llama-3.1-8b-instruct'; // Default to a more standard model

/**
 * Call the NVIDIA NIM API with a prompt
 * @param {string} prompt - The prompt to send to the API
 * @param {Object} options - Additional options for the API call
 * @returns {Promise<string>} - The response text from the API
 */
const callNimApi = async (prompt, options = {}) => {
  try {
    if (!NIM_API_KEY || (NIM_API_KEY.startsWith('nvapi-') && NIM_API_KEY === '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')) {
      console.warn('Warning: NIM_API_KEY is missing or using an expired hardcoded key.');
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
      "temperature": options.temperature || 0.7,
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
      if (error.response.status === 403) {
        throw new Error('NVIDIA NIM API Key is invalid or expired. Please update NIM_API_KEY in your .env file.');
      }
    } else {
      console.error('Error calling NVIDIA NIM API:', error.message);
    }
    throw error;
  }
};

module.exports = { callNimApi }; 