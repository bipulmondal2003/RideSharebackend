const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';
const SALT_ROUNDS = 10;

const signToken = (user) =>
  jwt.sign(
    { id: user._id, name: user.name, email: user.email, userType: user.userType },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

exports.register = async (req, res) => {
  try {
    const { name, email, password, userType } = req.body;
    if (!name || !email || !password || !userType)
      return res.status(400).json({ error: 'All fields are required' });

    if (!['driver', 'passenger'].includes(userType))
      return res.status(400).json({ error: 'Invalid user type' });

    if (await User.findOne({ email }))
      return res.status(400).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({ name, email, passwordHash, userType });
    const token = signToken(user);
    res.status(201).json({ token, user: { id: user._id, name, email, userType } });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.isBanned)
      return res.status(403).json({ error: `Account suspended: ${user.banReason || 'contact support'}` });

    if (!await bcrypt.compare(password, user.passwordHash))
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, userType: user.userType } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user' });
  }
};
