const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const socketModule = require('./socket');

const app = express();
const httpServer = http.createServer(app);

// ✅ Init Socket.io
socketModule.init(httpServer);

// ✅ Environment variables
const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI;

// ✅ Middleware
app.use(cors({
  origin: [
    "https://ride-sharefrontend.vercel.app", // your frontend
    "http://localhost:3000" // for local testing
  ],
  credentials: true
}));

app.use(express.json());

// ✅ API Routes
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

// ✅ Root route (for testing)
app.get('/', (req, res) => {
  res.json({
    status: "success",
    message: "RideShare API is running 🚀"
  });
});

// ❌ DO NOT serve frontend here (handled by Vercel)

// ✅ Connect MongoDB and start server
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');

    httpServer.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });


// const http = require('http');
// const express = require('express');
// const mongoose = require('mongoose');
// const cors = require('cors');
// const path = require('path');
// require('dotenv').config();

// const apiRoutes = require('./routes/api');
// const authRoutes = require('./routes/auth');
// const socketModule = require('./socket');

// const app = express();
// const httpServer = http.createServer(app);

// // Init Socket.io
// socketModule.init(httpServer);

// const PORT = process.env.PORT || 4000;
// const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/carpooling';

// app.use(cors());
// app.use(express.json());
// app.use(express.static(path.join(__dirname, '../frontend/src')));
// app.use('/pages', express.static(path.join(__dirname, '../frontend/pages')));

// app.use('/api/auth', authRoutes);
// app.use('/api', apiRoutes);

// app.get('/', (req, res) => {
//   res.sendFile(path.join(__dirname, '../frontend/src', 'index.html'));
// });

// mongoose.connect(MONGODB_URI)
//   .then(() => {
//     console.log('✅ Connected to MongoDB');
//     httpServer.listen(PORT, () => {
//       console.log(`🚀 Server running on http://localhost:${PORT}`);
//     });
//   })
//   .catch((err) => {
//     console.error('❌ MongoDB connection error:', err.message);
//     process.exit(1);
//   });
