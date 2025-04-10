const { ChatOllama } = require('@langchain/community/chat_models/ollama');
const { HumanMessage } = require('@langchain/core/messages');
const { fetchContext } = require('../rag/ragPipeline');

const checkCredibility = async (title, content, source) => {
  const chat = new ChatOllama({ model: 'llama3' });

  const context = await fetchContext({ title, content, source });
  const contextText = context.map(c => `Snippet: ${c.snippet} (Source: ${c.link})`).join('\n');

  const prompt = `
You are a fact-checking assistant.
Analyze the credibility of the following news article based on its source, language, tone, and content details.
Use the external context from a local dataset to enhance your analysis if relevant, but provide a credibility score and reasoning even if the context doesn’t match closely.

Title: ${title}
Source: ${source || 'Unknown'}
Content: ${content}
External Context: 
${contextText}

Respond with:
- Credibility Score (0-10)
- Reasoning (2-3 sentences detailing your analysis, focusing on the article itself if context is irrelevant)
  `;

  const res = await chat.call([new HumanMessage(prompt)]);
  const text = res.content.trim();
  //console.log('LLaMA3 raw response:', text); // Debug output

  let score = 5; // Default fallback
  let reasoning = 'No reasoning provided.';

  // Robust score parsing
  const scoreMatch = text.match(/Credibility Score\D*(\d+)/i) || 
                    text.match(/Score\D*(\d+)/i) || 
                    text.match(/(\d+)\s*(?:\/10)?/i); // Catch "7" or "7/10"
  if (scoreMatch) {
    score = parseInt(scoreMatch[1]);
    if (score < 0 || score > 10) score = 5; // Clamp invalid scores
  }

  // Extract reasoning (anything not containing score)
  const reasoningMatch = text.split('\n').filter(line => !line.match(/score/i)).join(' ').trim();
  if (reasoningMatch) reasoning = reasoningMatch;

  return { score, reasoning };
};

module.exports = checkCredibility;