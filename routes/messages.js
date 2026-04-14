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

// Get all conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT DISTINCT ON (u.id)
        u.id, u.name, u.avatar,
        m.text as last_message,
        m.created_at as last_time,
        COUNT(CASE WHEN m.read_status=false
          AND m.receiver_id=$1 THEN 1 END) as unread
      FROM messages m
      JOIN users u ON (
        CASE WHEN m.sender_id=$2
        THEN m.receiver_id=u.id
        ELSE m.sender_id=u.id END
      )
      WHERE m.sender_id=$3 OR m.receiver_id=$4
      GROUP BY u.id, u.name, u.avatar, m.text, m.created_at
      ORDER BY u.id, m.created_at DESC
    `, [req.user.id, req.user.id, req.user.id, req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get messages between two users
router.get('/:userId', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT m.*,
        u.name as sender_name,
        u.avatar as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE (m.sender_id=$1 AND m.receiver_id=$2)
      OR (m.sender_id=$3 AND m.receiver_id=$4)
      ORDER BY m.created_at ASC
      LIMIT 100
    `, [
      req.user.id, req.params.userId,
      req.params.userId, req.user.id
    ]);

    await db.query(
      'UPDATE messages SET read_status=true WHERE sender_id=$1 AND receiver_id=$2',
      [req.params.userId, req.user.id]
    );

    res.json(result.rows);
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
      'INSERT INTO messages (id, sender_id, receiver_id, text) VALUES ($1, $2, $3, $4)',
      [id, req.user.id, req.params.userId, text]
    );

    const result = await db.query(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id=u.id
      WHERE m.id=$1
    `, [id]);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete message
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM messages WHERE id=$1 AND sender_id=$2',
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
    const result = await db.query(
      'SELECT COUNT(*) as count FROM messages WHERE receiver_id=$1 AND read_status=false',
      [req.user.id]
    );
    res.json({ count: result.rows[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
