const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const db = require('../database');

// Auth middleware
function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Get user profile
router.get('/:id', auth, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, name, email, avatar, cover, bio, location, website, followers, following, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    if (users.length === 0)
      return res.status(404).json({ error: 'User not found' });
    res.json(users[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, bio, location, website, avatar } = req.body;
    await db.query(
      'UPDATE users SET name=?, bio=?, location=?, website=?, avatar=? WHERE id=?',
      [name, bio, location, website, avatar, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search users
router.get('/search/:query', auth, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, name, email, avatar, bio FROM users WHERE name LIKE ? OR email LIKE ? LIMIT 20',
      [`%${req.params.query}%`, `%${req.params.query}%`]
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send friend request
router.post('/:id/friend', auth, async (req, res) => {
  try {
    const [existing] = await db.query(
      'SELECT id FROM friends WHERE user_id=? AND friend_id=?',
      [req.user.id, req.params.id]
    );
    if (existing.length > 0)
      return res.status(400).json({ error: 'Request already sent' });

    await db.query(
      'INSERT INTO friends (id, user_id, friend_id) VALUES (?, ?, ?)',
      [uuidv4(), req.user.id, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept friend request
router.put('/:id/friend/accept', auth, async (req, res) => {
  try {
    await db.query(
      'UPDATE friends SET status=? WHERE user_id=? AND friend_id=?',
      ['accepted', req.params.id, req.user.id]
    );

    // Update followers count
    await db.query(
      'UPDATE users SET followers=followers+1 WHERE id=?',
      [req.user.id]
    );
    await db.query(
      'UPDATE users SET following=following+1 WHERE id=?',
      [req.params.id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get friends list
router.get('/:id/friends', auth, async (req, res) => {
  try {
    const [friends] = await db.query(`
      SELECT u.id, u.name, u.avatar, u.bio
      FROM friends f
      JOIN users u ON (
        CASE WHEN f.user_id = ? THEN f.friend_id = u.id
        ELSE f.user_id = u.id END
      )
      WHERE (f.user_id=? OR f.friend_id=?)
      AND f.status='accepted'
    `, [req.params.id, req.params.id, req.params.id]);
    res.json(friends);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get suggested users
router.get('/suggestions/all', auth, async (req, res) => {
  try {
    const [users] = await db.query(`
      SELECT id, name, avatar, bio FROM users
      WHERE id != ?
      AND id NOT IN (
        SELECT friend_id FROM friends WHERE user_id=?
        UNION
        SELECT user_id FROM friends WHERE friend_id=?
      )
      ORDER BY RAND()
      LIMIT 10
    `, [req.user.id, req.user.id, req.user.id]);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
