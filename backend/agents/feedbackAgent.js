// agents/feedbackAgent.js
const { ChatOllama } = require('@langchain/community/chat_models/ollama');
const { HumanMessage } = require('@langchain/core/messages');

const processFeedback = async (article, userFeedback) => {
  const chat = new ChatOllama({
    model: 'llama3',
  });

  const prompt = `
You are an assistant improving a credibility system.
A user provided feedback on the following article.

Article: ${article}
Feedback: ${userFeedback}

Suggest an update or a reason to reconsider the credibility score.
  `;

  const res = await chat.call([new HumanMessage(prompt)]);
  return res.content;
};

module.exports = processFeedback;
