const { ChatOllama } = require('@langchain/community/chat_models/ollama');
const { HumanMessage } = require('@langchain/core/messages');
const { fetchContext } = require('../rag/ragPipeline');

const processFeedback = async (article, userFeedback) => {
  const chat = new ChatOllama({ model: 'llama3' });

  const articleObj = typeof article === 'string'
    ? { title: article.slice(0, 50), content: article, source: '' }
    : article;

  const context = await fetchContext(articleObj);
  const contextText = context.map(c => `Snippet: ${c.snippet} (Source: ${c.link})`).join('\n');

  const prompt = `
You are an assistant improving a credibility system.
A user provided feedback on the following article (if "None," provide general AI feedback on its credibility).
Analyze the article’s content, source, and tone to suggest credibility insights, using the external context to enhance your analysis if relevant.
You MUST provide a suggestion even if the context doesn’t match closely.
Format your response EXACTLY as:
Suggestion: [2-3 sentences]

Article: ${articleObj.title} - ${articleObj.content}
User Feedback: ${userFeedback}
External Context: 
${contextText}
  `;

  const res = await chat.call([new HumanMessage(prompt)]);
  const text = res.content.trim();
  console.log('LLaMA3 feedback raw response:', text); // Debug output

  // Extract suggestion
  const suggestionMatch = text.match(/Suggestion:(.+)/is);
  const suggestion = suggestionMatch ? suggestionMatch[1].trim() : 'No feedback provided due to parsing failure.';

  return suggestion;
};

module.exports = processFeedback;