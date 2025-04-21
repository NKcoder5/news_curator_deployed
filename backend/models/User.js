const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, default: 'Distinguished Reader' },  // Added name field with default value
  interests: { type: [String], default: [] }  // For future personalization
});

module.exports = mongoose.model('User', userSchema);