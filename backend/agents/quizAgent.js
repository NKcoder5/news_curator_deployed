// agents/quizAgent.js
const { callNimApi } = require('../utils/nvidiaNimApi');

const generateQuiz = async (detailedSummary) => {
  const prompt = `
You are a helpful assistant. Generate a quiz with 5 multiple-choice questions based on the following detailed summary. 
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

Detailed Summary:
${detailedSummary}
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
    
    return quizData;
  } catch (error) {
    console.error('Error parsing quiz data:', error);
    // Return a default quiz if parsing fails
    return {
      questions: [
        {
          question: "What is the main topic of the article?",
          options: ["Option A", "Option B", "Option C", "Option D"],
          correctAnswer: 0
        },
        {
          question: "According to the article, what is the most important point?",
          options: ["Option A", "Option B", "Option C", "Option D"],
          correctAnswer: 1
        },
        {
          question: "What conclusion does the article draw?",
          options: ["Option A", "Option B", "Option C", "Option D"],
          correctAnswer: 2
        },
        {
          question: "What evidence does the article provide?",
          options: ["Option A", "Option B", "Option C", "Option D"],
          correctAnswer: 3
        },
        {
          question: "What is the author's perspective on the topic?",
          options: ["Option A", "Option B", "Option C", "Option D"],
          correctAnswer: 0
        }
      ]
    };
  }
};

module.exports = generateQuiz; 