const mongoose = require('mongoose');

const userInterestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    type: String,
    required: true
  },
  interestScore: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  sourcePreferences: [{
    source: String,
    score: Number
  }],
  keywords: [{
    keyword: String,
    score: Number
  }]
});

module.exports = mongoose.model('UserInterest', userInterestSchema); 