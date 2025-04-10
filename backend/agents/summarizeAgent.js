// agents/summarizeAgent.js
const { ChatOllama } = require('@langchain/community/chat_models/ollama');
const { HumanMessage } = require('@langchain/core/messages');

const summarizeArticle = async (article) => {
  const chat = new ChatOllama({
    model: 'llama3',
  });

  const prompt = `
You are a helpful assistant. Summarize the following news article in 2-3 sentences:
---
${article}
---
Summary:
  `;

  const res = await chat.call([new HumanMessage(prompt)]);
  return res.content;
};

module.exports = summarizeArticle;
