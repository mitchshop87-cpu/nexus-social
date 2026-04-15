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

// Get all posts
router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.*, u.name, u.avatar,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
      (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = $1) as liked
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
      LIMIT 50
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create post
router.post('/', auth, async (req, res) => {
  try {
    const { text, media } = req.body;
    if (!text && !media)
      return res.status(400).json({ error: 'Post cannot be empty' });

    const id = uuidv4();
    await db.query(
      'INSERT INTO posts (id, user_id, text, media) VALUES ($1, $2, $3, $4)',
      [id, req.user.id, text, media || '']
    );

    const result = await db.query(`
      SELECT p.*, u.name, u.avatar
      FROM posts p JOIN users u ON p.user_id = u.id
      WHERE p.id = $1
    `, [id]);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete post
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM posts WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Like / Unlike
router.post('/:id/like', auth, async (req, res) => {
  try {
    const existing = await db.query(
      'SELECT id FROM likes WHERE post_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (existing.rows.length > 0) {
      await db.query(
        'DELETE FROM likes WHERE post_id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
      res.json({ liked: false });
    } else {
      await db.query(
        'INSERT INTO likes (id, post_id, user_id) VALUES ($1, $2, $3)',
        [uuidv4(), req.params.id, req.user.id]
      );
      res.json({ liked: true });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get comments
router.get('/:id/comments', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.*, u.name, u.avatar
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add comment
router.post('/:id/comments', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text)
      return res.status(400).json({ error: 'Comment cannot be empty' });

    const id = uuidv4();
    await db.query(
      'INSERT INTO comments (id, post_id, user_id, text) VALUES ($1, $2, $3, $4)',
      [id, req.params.id, req.user.id, text]
    );

    const result = await db.query(`
      SELECT c.*, u.name, u.avatar
      FROM comments c JOIN users u ON c.user_id = u.id
      WHERE c.id = $1
    `, [id]);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
