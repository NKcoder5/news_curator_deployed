const { callNimApi } = require('../utils/nvidiaNimApi');

const generateDetailedSummary = async (article) => {
  const prompt = `
You are a helpful assistant. Generate a detailed summary of the following news article in 100-150 words, focusing on key points, context, and important details:
---
${article}
---
Detailed Summary:
  `;

  return await callNimApi(prompt);
};

module.exports = generateDetailedSummary; 