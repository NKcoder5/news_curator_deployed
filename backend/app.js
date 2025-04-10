const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

// Routes
const newsRoutes = require('./routes/newsRoutes');
const aiRoutes = require('./routes/aiRoutes');
const authRoutes = require('./routes/authRoutes'); // New

// DB Connection
const connectDB = require('./utils/db'); // New

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Database
connectDB(); // New

// Routes
app.use('/api/news', newsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/auth', authRoutes); // New

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
});