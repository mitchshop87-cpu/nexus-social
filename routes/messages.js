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

// Get all conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const [convos] = await db.query(`
      SELECT 
        u.id, u.name, u.avatar,
        m.text as last_message,
        m.created_at as last_time,
        SUM(CASE WHEN m.read_status=0 
          AND m.receiver_id=? THEN 1 ELSE 0 END) as unread
      FROM messages m
      JOIN users u ON (
        CASE WHEN m.sender_id=? 
        THEN m.receiver_id=u.id
        ELSE m.sender_id=u.id END
      )
      WHERE m.sender_id=? OR m.receiver_id=?
      GROUP BY u.id, u.name, u.avatar, m.text, m.created_at
      ORDER BY m.created_at DESC
    `, [req.user.id, req.user.id, req.user.id, req.user.id]);
    res.json(convos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get messages between two users
router.get('/:userId', auth, async (req, res) => {
  try {
    const [messages] = await db.query(`
      SELECT m.*, 
        u.name as sender_name, 
        u.avatar as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE (m.sender_id=? AND m.receiver_id=?)
      OR (m.sender_id=? AND m.receiver_id=?)
      ORDER BY m.created_at ASC
      LIMIT 100
    `, [
      req.user.id, req.params.userId,
      req.params.userId, req.user.id
    ]);

    // Mark messages as read
    await db.query(
      'UPDATE messages SET read_status=1 WHERE sender_id=? AND receiver_id=?',
      [req.params.userId, req.user.id]
    );

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send message
router.post('/:userId', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text)
      return res.status(400).json({ error: 'Message cannot be empty' });

    const id = uuidv4();
    await db.query(
      'INSERT INTO messages (id, sender_id, receiver_id, text) VALUES (?, ?, ?, ?)',
      [id, req.user.id, req.params.userId, text]
    );

    const [messages] = await db.query(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id=u.id
      WHERE m.id=?
    `, [id]);

    res.json(messages[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete message
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM messages WHERE id=? AND sender_id=?',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get unread count
router.get('/unread/count', auth, async (req, res) => {
  try {
    const [result] = await db.query(
      'SELECT COUNT(*) as count FROM messages WHERE receiver_id=? AND read_status=0',
      [req.user.id]
    );
    res.json({ count: result[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
