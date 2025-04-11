// agents/summarizeAgent.js
const { callNimApi } = require('../utils/nvidiaNimApi');

const summarizeArticle = async (article) => {
  const prompt = `
You are a helpful assistant. Summarize the following news article in 5-10 sentences:
---
${article}
---
Summary:
  `;

  return await callNimApi(prompt);
};

module.exports = summarizeArticle;
