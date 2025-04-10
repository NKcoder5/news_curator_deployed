const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  interests: { type: [String], default: [] }  // For future personalization
});

module.exports = mongoose.model('User', userSchema);