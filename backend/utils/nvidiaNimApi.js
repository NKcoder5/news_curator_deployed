const axios = require('axios');

const NIM_API_KEY = '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';
const NIM_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

/**
 * Call the NVIDIA NIM API with a prompt
 * @param {string} prompt - The prompt to send to the API
 * @param {Object} options - Additional options for the API call
 * @returns {Promise<string>} - The response text from the API
 */
const callNimApi = async (prompt, options = {}) => {
  try {
    const headers = {
      "Authorization": `Bearer ${NIM_API_KEY}`,
      "Accept": "application/json"
    };

    const payload = {
      "model": "meta/llama-4-maverick-17b-128e-instruct",
      "messages": [
        {
          "role": "user",
          "content": prompt
        }
      ],
      "max_tokens": options.maxTokens || 512,
      "temperature": options.temperature || 1.00,
      "top_p": options.topP || 1.00,
      "stream": false
    };

    const response = await axios.post(NIM_API_URL, payload, { headers });
    
    // Extract the response text from the API response
    if (response.data && response.data.choices && response.data.choices.length > 0) {
      return response.data.choices[0].message.content.trim();
    } else {
      throw new Error('Invalid response format from NVIDIA NIM API');
    }
  } catch (error) {
    console.error('Error calling NVIDIA NIM API:', error.message);
    throw error;
  }
};

module.exports = { callNimApi }; 