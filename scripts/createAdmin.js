/**
 * One-time admin seeder. Run with: npm run seed:admin
 * Edit the credentials below before running.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const bcrypt   = require('bcrypt');
const User     = require('../models/User');

const ADMIN = {
  name:     'Bipul Mondal',
  email:    'rajmondal3503@gmail.com',
  password: 'Raaz@2003',   // ← Change this!
};

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/carpooling');
  console.log('Connected to MongoDB');

  const existing = await User.findOne({ email: ADMIN.email });
  if (existing) {
    console.log('Admin already exists:', existing.email);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(ADMIN.password, 10);
  const admin = await User.create({ name: ADMIN.name, email: ADMIN.email, passwordHash, userType: 'admin' });
  console.log('✅ Admin created:', admin.email);
  console.log('   Password:', ADMIN.password);
  process.exit(0);
}

seed().catch(err => { console.error('Error:', err.message); process.exit(1); });
