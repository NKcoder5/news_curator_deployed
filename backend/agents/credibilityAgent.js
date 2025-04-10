// agents/credibilityAgent.js
const { ChatOllama } = require('@langchain/community/chat_models/ollama');
const { HumanMessage } = require('@langchain/core/messages');

const checkCredibility = async (title, content, source) => {
  const chat = new ChatOllama({
    model: 'llama3',
  });

  const prompt = `
You are a fact-checking assistant.
Analyze the credibility of the following news article. 
Consider the source, language, bias, and sensationalism.

Title: ${title}
Source: ${source}
Content: ${content}

Respond with:
- Credibility Score (0-10)
- Reasoning (2-3 sentences)
  `;

  const res = await chat.call([new HumanMessage(prompt)]);
  return res.content;
};

module.exports = checkCredibility;
