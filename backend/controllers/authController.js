const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// The signup page asks for a valid email and at least eight characters, but
// the server accepted anything: a missing password reached bcrypt and came
// back as a server error, and "User@x.com" could sign up and then fail to log
// in as "user@x.com". The server now holds the same rules as the page.
const MIN_PASSWORD_LENGTH = 8;
// bcrypt reads only the first 72 bytes; a longer "password" is mostly ignored
// and costs the hash its time for nothing.
const MAX_PASSWORD_LENGTH = 72;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normaliseEmail = (email) => String(email || '').trim().toLowerCase();

// Cost 12: about a quarter of a second per hash on a small server, which is
// nothing for a reader signing in and a great deal for anyone guessing.
// Hashes made at cost 10 still verify; bcrypt reads the cost from the hash.
const BCRYPT_COST = 12;
const TOKEN_LIFETIME = '24h';
const signToken = (user) => jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: TOKEN_LIFETIME, algorithm: 'HS256' });

// Compared against when the email has no account, so that "no such account"
// takes as long to answer as "wrong password" and the two cannot be told
// apart by timing. Made once, lazily.
let dummyHash = null;
const absentAccountHash = async () => (dummyHash ||= await bcrypt.hash('no account has this password', BCRYPT_COST));

// Signup
exports.signup = async (req, res) => {
  try {
    const email = normaliseEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Your password needs at least ${MIN_PASSWORD_LENGTH} characters.` });
    }
    if (Buffer.byteLength(password) > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Your password can be at most ${MAX_PASSWORD_LENGTH} characters.` });
    }

    // Saying an email has an account tells anyone who asks. Signup has to say
    // something, so it says it without confirming more than it must, and the
    // signup allowance (middleware/rateLimits.js) keeps anyone from asking
    // about many addresses.
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'An account cannot be created with that email. If it is yours, sign in instead.' });
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);
    const user = new User({ email, password: hashedPassword });
    await user.save();

    const token = signToken(user);

    res.status(201).json({
      message: 'User created successfully',
      token,
      userId: user._id
    });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Error creating user' });
  }
};

// Login
exports.login = async (req, res) => {
  try {
    const email = normaliseEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter your email and password.' });
    }

    // Accounts created before emails were normalised may be stored with capitals.
    const user = await User.findOne({ email })
      || await User.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    // One answer, and one amount of work, whether or not the account exists:
    // without the dummy comparison an unknown email answered at once and a
    // known one after a bcrypt round, which named every registered address.
    const isMatch = await bcrypt.compare(password.slice(0, 256), user ? user.password : await absentAccountHash());
    if (!user || !isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);

    res.json({
      token,
      userId: user._id,
      interests: user.interests || []
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Error during login' });
  }
};

// Verify token
exports.verify = async (req, res) => {
  try {
    // The user is already attached to the request by the auth middleware
    const user = req.user;

    res.json({
      userId: user._id,
      email: user.email,
      interests: user.interests || []
    });
  } catch (err) {
    console.error('Token verification error:', err.message);
    res.status(500).json({ error: 'Error verifying token' });
  }
};
