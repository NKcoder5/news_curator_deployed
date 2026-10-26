const UserInterest = require('../models/UserInterest');

// Get user profile
exports.getProfile = async (req, res) => {
  try {
    // The user is already attached to the request by the auth middleware
    const user = req.user;

    // Get top 3 user interests from UserInterest model
    const userInterests = await UserInterest.find({ userId: user._id })
      .sort({ interestScore: -1 })
      .limit(3)
      .select('category interestScore');

    // Extract categories from top 3 user interests
    const interests = userInterests.map(interest => interest.category);

    // Return user profile without sensitive information
    res.json({
      userId: user._id,
      email: user.email,
      name: user.name,
      interests: interests
    });
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).json({ error: 'Error fetching user profile' });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    // An empty or missing name used to be saved as-is, which erased it and left
    // the dashboard greeting nobody.
    const name = String(req.body.name || '').trim();
    if (!name || name.length > 60) {
      return res.status(400).json({ error: 'Please enter a name between 1 and 60 characters.' });
    }
    const user = req.user;

    user.name = name;
    await user.save();

    // Get top 3 updated user interests
    const userInterests = await UserInterest.find({ userId: user._id })
      .sort({ interestScore: -1 })
      .limit(3)
      .select('category interestScore');

    // Extract categories from top 3 user interests
    const interests = userInterests.map(interest => interest.category);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        userId: user._id,
        email: user.email,
        name: user.name,
        interests: interests
      }
    });
  } catch (err) {
    console.error('Error updating user profile:', err);
    res.status(500).json({ error: 'Error updating user profile' });
  }
};
