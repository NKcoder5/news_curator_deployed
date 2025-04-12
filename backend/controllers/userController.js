const User = require('../models/User');

// Get user profile
exports.getProfile = async (req, res) => {
  try {
    // The user is already attached to the request by the auth middleware
    const user = req.user;
    
    // Return user profile without sensitive information
    res.json({
      userId: user._id,
      email: user.email,
      interests: user.interests || []
    });
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ error: 'Error fetching user profile' });
  }
}; 