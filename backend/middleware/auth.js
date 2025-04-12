const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    // 1. Get token from header
    const authHeader = req.header('Authorization');
    console.log('Auth header:', authHeader ? 'Present' : 'Missing');
    
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      console.log('No token provided in request');
      return res.status(401).json({ error: 'Authentication required' });
    }

    // 2. Verify token
    console.log('Verifying token...');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Token verified, user ID:', decoded.userId);
    
    // 3. Find user
    console.log('Finding user in database...');
    const user = await User.findById(decoded.userId);

    if (!user) {
      console.log(`User with ID ${decoded.userId} not found`);
      return res.status(401).json({ error: 'User not found' });
    }

    console.log('User found:', user.email);
    
    // 4. Attach user to request
    req.user = user;
    next();
  } catch (err) {
    // Log the error for debugging but don't expose details to client
    console.error('Auth error:', err.message);
    if (err.name === 'JsonWebTokenError') {
      console.error('JWT verification failed:', err.message);
    } else if (err.name === 'TokenExpiredError') {
      console.error('Token expired:', err.message);
    } else {
      console.error('Unexpected auth error:', err);
      console.error('Error stack:', err.stack);
    }
    res.status(401).json({ error: 'Please authenticate' });
  }
};

module.exports = auth;