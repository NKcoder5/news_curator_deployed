// agents/promptQuizAgent.js
const { callNimApi } = require('../utils/nvidiaNimApi');
const { fetchContext } = require('../rag/ragPipeline');

const generatePromptQuiz = async (userPrompt) => {
  try {
    // Fetch relevant context using RAG
    const context = await fetchContext({ 
      title: userPrompt, 
      content: userPrompt, 
      source: 'User Prompt' 
    });
    
    // Format context for the prompt
    const contextText = context
      .map(item => `- ${item.snippet} (Source: ${item.link})`)
      .join('\n');
    
    const prompt = `
You are a helpful educational assistant. Generate a quiz with 5 multiple-choice questions based on the following user prompt and context.
Each question should have 4 options (A, B, C, D) with only one correct answer.
Format the response as a JSON object with the following structure:
{
  "questions": [
    {
      "question": "Question text here",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 0 (index of the correct option, 0-3)
    },
    ...
  ]
}

User Prompt: ${userPrompt}

Relevant Context:
${contextText}
`;

    const response = await callNimApi(prompt);
    
    // Parse the response to ensure it's valid JSON
    try {
      // Extract JSON from the response if needed
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      const quizData = JSON.parse(jsonStr);
      
      // Validate the structure
      if (!quizData.questions || !Array.isArray(quizData.questions) || quizData.questions.length !== 5) {
        throw new Error('Invalid quiz format');
      }
      
      // Ensure each question has the required fields
      quizData.questions = quizData.questions.map((q, index) => {
        if (!q.question || !q.options || !Array.isArray(q.options) || q.options.length !== 4 || q.correctAnswer === undefined) {
          console.error(`Invalid question format at index ${index}:`, q);
          // Return a default question if the format is invalid
          return {
            question: `Question ${index + 1} about ${userPrompt}`,
            options: ["Option A", "Option B", "Option C", "Option D"],
            correctAnswer: 0
          };
        }
        return q;
      });
      
      return quizData;
    } catch (error) {
      console.error('Error parsing quiz data:', error);
      // Return a default quiz with 5 questions if parsing fails
      return {
        questions: [
          {
            question: "What is the main topic of the prompt?",
            options: ["Option A", "Option B", "Option C", "Option D"],
            correctAnswer: 0
          },
          {
            question: "According to the context, what is the most important point?",
            options: ["Option A", "Option B", "Option C", "Option D"],
            correctAnswer: 1
          },
          {
            question: "What conclusion can be drawn from the information?",
            options: ["Option A", "Option B", "Option C", "Option D"],
            correctAnswer: 2
          },
          {
            question: "What evidence is provided in the context?",
            options: ["Option A", "Option B", "Option C", "Option D"],
            correctAnswer: 3
          },
          {
            question: "What is the perspective on the topic in the context?",
            options: ["Option A", "Option B", "Option C", "Option D"],
            correctAnswer: 0
          }
        ]
      };
    }
  } catch (error) {
    console.error('Error generating prompt quiz:', error);
    throw error;
  }
};

module.exports = generatePromptQuiz; 