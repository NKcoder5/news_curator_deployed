const mongoose = require('mongoose');

const promptQuizSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },
  prompt: {
    type: String,
    required: [true, 'Prompt is required'],
    trim: true
  },
  questions: {
    type: [{
      question: {
        type: String,
        required: [true, 'Question text is required']
      },
      options: {
        type: [String],
        required: [true, 'Options are required'],
        validate: {
          validator: function(v) {
            return v.length === 4;
          },
          message: 'Each question must have exactly 4 options'
        }
      },
      correctAnswer: {
        type: Number,
        required: [true, 'Correct answer is required'],
        min: [0, 'Correct answer must be a non-negative number'],
        max: [3, 'Correct answer must be less than 4']
      },
      selectedAnswer: {
        type: Number,
        min: [0, 'Selected answer must be a non-negative number'],
        max: [3, 'Selected answer must be less than 4']
      },
      isCorrect: {
        type: Boolean
      }
    }],
    validate: {
      validator: function(v) {
        return v.length === 5;
      },
      message: 'Quiz must have exactly 5 questions'
    }
  },
  score: {
    type: Number,
    required: [true, 'Score is required'],
    min: [0, 'Score cannot be negative'],
    max: [5, 'Score cannot exceed 5']
  },
  totalQuestions: {
    type: Number,
    required: [true, 'Total questions is required'],
    validate: {
      validator: function(v) {
        return v === 5;
      },
      message: 'Total questions must be exactly 5'
    }
  },
  feedback: {
    type: String,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create index for userId and createdAt for efficient querying
promptQuizSchema.index({ userId: 1, createdAt: -1 });

// Add a pre-save middleware to validate the data
promptQuizSchema.pre('save', function(next) {
  console.log('Validating PromptQuiz before save');
  console.log(`Questions array length: ${this.questions.length}, totalQuestions: ${this.totalQuestions}`);
  
  // Validate that score is not greater than totalQuestions
  if (this.score > this.totalQuestions) {
    console.error('Validation error: Score cannot be greater than total questions');
    next(new Error('Score cannot be greater than total questions'));
    return;
  }
  
  // Validate that questions array length matches totalQuestions
  if (this.questions.length !== 5 || this.totalQuestions !== 5) {
    console.error(`Validation error: Quiz must have exactly 5 questions (got ${this.questions.length})`);
    next(new Error('Quiz must have exactly 5 questions'));
    return;
  }
  
  // Validate each question has the required fields
  for (let i = 0; i < this.questions.length; i++) {
    const question = this.questions[i];
    if (!question.question || !question.options || question.options.length !== 4) {
      console.error(`Validation error: Question ${i} is missing required fields or has incorrect number of options`);
      next(new Error(`Question ${i} is invalid`));
      return;
    }
  }
  
  console.log('PromptQuiz validation passed');
  next();
});

module.exports = mongoose.model('PromptQuiz', promptQuizSchema); 