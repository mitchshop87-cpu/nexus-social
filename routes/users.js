const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const db = require('../database');

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
    const result = await db.query(
      'SELECT id, name, email, avatar, cover, bio, location, website, followers, following, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, bio, location, website, avatar } = req.body;
    await db.query(
      'UPDATE users SET name=$1, bio=$2, location=$3, website=$4, avatar=$5 WHERE id=$6',
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
    const result = await db.query(
      'SELECT id, name, email, avatar, bio FROM users WHERE name ILIKE $1 OR email ILIKE $2 LIMIT 20',
      [`%${req.params.query}%`, `%${req.params.query}%`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send friend request
router.post('/:id/friend', auth, async (req, res) => {
  try {
    const existing = await db.query(
      'SELECT id FROM friends WHERE user_id=$1 AND friend_id=$2',
      [req.user.id, req.params.id]
    );
    if (existing.rows.length > 0)
      return res.status(400).json({ error: 'Request already sent' });

    await db.query(
      'INSERT INTO friends (id, user_id, friend_id) VALUES ($1, $2, $3)',
      [uuidv4(), req.user.id, req.params.id]
    );

    // Notify the user who received the friend request
    const sender = await db.query('SELECT name FROM users WHERE id=$1', [req.user.id]);
    await db.query(
      'INSERT INTO notifications (id, user_id, from_user_id, type, message) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), req.params.id, req.user.id, 'friend_request', `${sender.rows[0].name} sent you a friend request`]
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
      'UPDATE friends SET status=$1 WHERE user_id=$2 AND friend_id=$3',
      ['accepted', req.params.id, req.user.id]
    );
    await db.query('UPDATE users SET followers=followers+1 WHERE id=$1', [req.user.id]);
    await db.query('UPDATE users SET following=following+1 WHERE id=$1', [req.params.id]);

    // Notify sender that request was accepted
    const accepter = await db.query('SELECT name FROM users WHERE id=$1', [req.user.id]);
    await db.query(
      'INSERT INTO notifications (id, user_id, from_user_id, type, message) VALUES ($1,$2,$3,$4,$5)',
      [uuidv4(), req.params.id, req.user.id, 'friend_accept', `${accepter.rows[0].name} accepted your friend request`]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get friends list
router.get('/:id/friends', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.name, u.avatar, u.bio
      FROM friends f
      JOIN users u ON (
        CASE WHEN f.user_id = $1
        THEN f.friend_id = u.id
        ELSE f.user_id = u.id END
      )
      WHERE (f.user_id=$2 OR f.friend_id=$3)
      AND f.status='accepted'
    `, [req.params.id, req.params.id, req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get suggested users
router.get('/suggestions/all', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, name, avatar, bio FROM users
      WHERE id != $1
      AND id NOT IN (
        SELECT friend_id FROM friends WHERE user_id=$2
        UNION
        SELECT user_id FROM friends WHERE friend_id=$3
      )
      ORDER BY RANDOM()
      LIMIT 10
    `, [req.user.id, req.user.id, req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get notifications
router.get('/notifications/all', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT n.*, u.name as from_name, u.avatar as from_avatar
      FROM notifications n
      JOIN users u ON n.from_user_id = u.id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
      LIMIT 30
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark notifications as read
router.put('/notifications/read', auth, async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET read_status=true WHERE user_id=$1',
      [req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get unread notification count
router.get('/notifications/unread', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND read_status=false',
      [req.user.id]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
