/**
 * NEXUS SOCIAL — Complete Backend Server
 * Node.js + Express + Socket.IO + SQLite (better-sqlite3)
 * 
 * Install: npm install express socket.io better-sqlite3 bcryptjs jsonwebtoken cors multer uuid
 * Run:     node server.js
 * Port:    3000 (set PORT env var to override)
 */

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const Database   = require('better-sqlite3');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const multer     = require('multer');
const path       = require('path');
const { v4: uuidv4 } = require('uuid');
const fs         = require('fs');

// ─────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nexus_super_secret_change_in_prod_2024';
const UPLOADS    = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

// ─────────────────────────────────────────────────
//  DATABASE SETUP
// ─────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'nexus.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    bio         TEXT DEFAULT '',
    location    TEXT DEFAULT '',
    website     TEXT DEFAULT '',
    avatar      TEXT DEFAULT '',
    cover       TEXT DEFAULT '',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id          TEXT PRIMARY KEY,
    requester   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      TEXT CHECK(status IN ('pending','accepted','blocked')) DEFAULT 'pending',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(requester, addressee)
  );

  CREATE TABLE IF NOT EXISTS posts (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text        TEXT DEFAULT '',
    media       TEXT DEFAULT '',
    media_type  TEXT DEFAULT '',
    visibility  TEXT DEFAULT 'public',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS likes (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, post_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    text        TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    sender_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text        TEXT NOT NULL,
    read_at     DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    message     TEXT NOT NULL,
    ref_id      TEXT DEFAULT '',
    read        INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS stories (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media       TEXT NOT NULL,
    media_type  TEXT DEFAULT 'image',
    expires_at  DATETIME NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_posts_user      ON posts(user_id);
  CREATE INDEX IF NOT EXISTS idx_comments_post   ON comments(post_id);
  CREATE INDEX IF NOT EXISTS idx_likes_post      ON likes(post_id);
  CREATE INDEX IF NOT EXISTS idx_messages_convo  ON messages(sender_id, receiver_id);
  CREATE INDEX IF NOT EXISTS idx_notifs_user     ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_friends_req     ON friendships(requester);
  CREATE INDEX IF NOT EXISTS idx_friends_addr    ON friendships(addressee);
`);

// ─────────────────────────────────────────────────
//  APP & MIDDLEWARE
// ─────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(UPLOADS));
app.use(express.static(path.join(__dirname, 'public')));

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|mp4|webm|webp/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  }
});

// ─────────────────────────────────────────────────
//  AUTH MIDDLEWARE
// ─────────────────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Helper to create a notification
function notify(userId, fromId, type, message, refId = '') {
  if (userId === fromId) return;
  const id = uuidv4();
  db.prepare(`INSERT INTO notifications (id,user_id,from_id,type,message,ref_id)
              VALUES (?,?,?,?,?,?)`).run(id, userId, fromId, type, message, refId);
  // Push via socket
  const socketId = onlineUsers[userId];
  if (socketId) io.to(socketId).emit('newNotification');
}

// ─────────────────────────────────────────────────
//  AUTH ROUTES
// ─────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(400).json({ error: 'Email already registered' });

  const id   = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6c63ff&color=fff&size=200&bold=true`;

  db.prepare(`INSERT INTO users (id,name,email,password,avatar) VALUES (?,?,?,?,?)`)
    .run(id, name, email, hash, avatar);

  const token = jwt.sign({ id, email }, JWT_SECRET, { expiresIn: '30d' });
  const user  = db.prepare('SELECT id,name,email,bio,location,avatar,website,cover FROM users WHERE id=?').get(id);
  res.json({ token, user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'All fields required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(400).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: '30d' });
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id,name,email,bio,location,avatar,website,cover FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ─────────────────────────────────────────────────
//  USER ROUTES
// ─────────────────────────────────────────────────
app.put('/api/users/profile', auth, (req, res) => {
  const { name, bio, location, avatar, website, cover } = req.body;
  db.prepare(`UPDATE users SET name=?,bio=?,location=?,avatar=?,website=?,cover=? WHERE id=?`)
    .run(name || '', bio || '', location || '', avatar || '', website || '', cover || '', req.user.id);
  res.json({ success: true });
});

app.post('/api/users/avatar', auth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(url, req.user.id);
  res.json({ url });
});

app.get('/api/users/search/:query', auth, (req, res) => {
  const q = `%${req.params.query}%`;
  const users = db.prepare(`SELECT id,name,bio,avatar FROM users WHERE (name LIKE ? OR email LIKE ?) AND id != ? LIMIT 20`)
    .all(q, q, req.user.id);
  res.json(users);
});

app.get('/api/users/suggestions/all', auth, (req, res) => {
  // Users who are not already friends
  const users = db.prepare(`
    SELECT u.id, u.name, u.bio, u.avatar FROM users u
    WHERE u.id != ?
    AND u.id NOT IN (
      SELECT CASE WHEN requester=? THEN addressee ELSE requester END
      FROM friendships WHERE (requester=? OR addressee=?) AND status='accepted'
    )
    AND u.id NOT IN (
      SELECT addressee FROM friendships WHERE requester=? AND status='pending'
    )
    ORDER BY RANDOM() LIMIT 20
  `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
  res.json(users);
});

app.get('/api/users/:id', auth, (req, res) => {
  const user = db.prepare('SELECT id,name,bio,location,avatar,website,cover,created_at FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const friendStatus = db.prepare(`
    SELECT status, requester FROM friendships
    WHERE (requester=? AND addressee=?) OR (requester=? AND addressee=?)
  `).get(req.user.id, req.params.id, req.params.id, req.user.id);

  const postCount     = db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id=?').get(req.params.id).c;
  const friendCount   = db.prepare(`SELECT COUNT(*) as c FROM friendships WHERE (requester=? OR addressee=?) AND status='accepted'`).get(req.params.id, req.params.id).c;

  res.json({ ...user, friendStatus, postCount, friendCount });
});

// ─────────────────────────────────────────────────
//  FRIEND ROUTES
// ─────────────────────────────────────────────────
app.post('/api/users/:id/friend', auth, (req, res) => {
  const toId = req.params.id;
  if (toId === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });

  const existing = db.prepare(`
    SELECT * FROM friendships WHERE (requester=? AND addressee=?) OR (requester=? AND addressee=?)
  `).get(req.user.id, toId, toId, req.user.id);

  if (existing) {
    if (existing.status === 'accepted') return res.json({ status: 'already_friends' });
    if (existing.status === 'pending' && existing.requester === req.user.id)
      return res.json({ status: 'pending' });
    // Incoming request — auto-accept
    if (existing.status === 'pending' && existing.requester === toId) {
      db.prepare("UPDATE friendships SET status='accepted' WHERE id=?").run(existing.id);
      const me = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
      notify(toId, req.user.id, 'friend_accept', `${me.name} accepted your friend request`);
      return res.json({ status: 'accepted' });
    }
  }

  const id = uuidv4();
  db.prepare(`INSERT INTO friendships (id,requester,addressee,status) VALUES (?,?,?,'pending')`).run(id, req.user.id, toId);
  const me = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
  notify(toId, req.user.id, 'friend_request', `${me.name} sent you a friend request`);
  res.json({ status: 'pending' });
});

app.post('/api/friends/:id/accept', auth, (req, res) => {
  const fr = db.prepare(`SELECT * FROM friendships WHERE requester=? AND addressee=? AND status='pending'`)
    .get(req.params.id, req.user.id);
  if (!fr) return res.status(404).json({ error: 'Request not found' });

  db.prepare("UPDATE friendships SET status='accepted' WHERE id=?").run(fr.id);
  const me = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
  notify(req.params.id, req.user.id, 'friend_accept', `${me.name} accepted your friend request`);
  res.json({ success: true });
});

app.post('/api/friends/:id/decline', auth, (req, res) => {
  db.prepare(`DELETE FROM friendships WHERE requester=? AND addressee=? AND status='pending'`)
    .run(req.params.id, req.user.id);
  res.json({ success: true });
});

app.delete('/api/friends/:id', auth, (req, res) => {
  db.prepare(`DELETE FROM friendships WHERE (requester=? AND addressee=?) OR (requester=? AND addressee=?)`)
    .run(req.user.id, req.params.id, req.params.id, req.user.id);
  res.json({ success: true });
});

app.get('/api/friends', auth, (req, res) => {
  const friends = db.prepare(`
    SELECT u.id, u.name, u.bio, u.avatar,
           f.created_at as friends_since
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester=? THEN f.addressee ELSE f.requester END
    WHERE (f.requester=? OR f.addressee=?) AND f.status='accepted'
    ORDER BY f.created_at DESC
  `).all(req.user.id, req.user.id, req.user.id);
  res.json(friends);
});

app.get('/api/friends/requests', auth, (req, res) => {
  const requests = db.prepare(`
    SELECT u.id, u.name, u.bio, u.avatar, f.created_at
    FROM friendships f
    JOIN users u ON u.id = f.requester
    WHERE f.addressee=? AND f.status='pending'
    ORDER BY f.created_at DESC
  `).all(req.user.id);
  res.json(requests);
});

// ─────────────────────────────────────────────────
//  POST ROUTES
// ─────────────────────────────────────────────────
app.get('/api/posts', auth, (req, res) => {
  const posts = db.prepare(`
    SELECT p.*, u.name, u.avatar,
      (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS likes,
      (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS comment_count,
      (SELECT COUNT(*) FROM likes WHERE post_id=p.id AND user_id=?) AS liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    WHERE p.visibility='public'
       OR p.user_id = ?
       OR p.user_id IN (
         SELECT CASE WHEN requester=? THEN addressee ELSE requester END
         FROM friendships WHERE (requester=? OR addressee=?) AND status='accepted'
       )
    ORDER BY p.created_at DESC LIMIT 50
  `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
  res.json(posts.map(p => ({ ...p, liked: !!p.liked })));
});

app.post('/api/posts', auth, upload.single('media'), (req, res) => {
  const { text, visibility = 'public' } = req.body;
  if (!text && !req.file) return res.status(400).json({ error: 'Post needs text or media' });

  const id        = uuidv4();
  const media     = req.file ? `/uploads/${req.file.filename}` : '';
  const mediaType = req.file ? req.file.mimetype.split('/')[0] : '';

  db.prepare(`INSERT INTO posts (id,user_id,text,media,media_type,visibility) VALUES (?,?,?,?,?,?)`)
    .run(id, req.user.id, text || '', media, mediaType, visibility);

  const post = db.prepare(`
    SELECT p.*, u.name, u.avatar,
      0 AS likes, 0 AS comment_count, 0 AS liked
    FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?
  `).get(id);

  // Notify friends
  const friends = db.prepare(`
    SELECT CASE WHEN requester=? THEN addressee ELSE requester END as fid
    FROM friendships WHERE (requester=? OR addressee=?) AND status='accepted'
  `).all(req.user.id, req.user.id, req.user.id);

  const me = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
  friends.forEach(f => {
    notify(f.fid, req.user.id, 'post', `${me.name} shared a new post`);
  });

  io.emit('newPost', post);
  res.json(post);
});

app.delete('/api/posts/:id', auth, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!post) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────────────
//  LIKES
// ─────────────────────────────────────────────────
app.post('/api/posts/:id/like', auth, (req, res) => {
  const existing = db.prepare('SELECT * FROM likes WHERE user_id=? AND post_id=?').get(req.user.id, req.params.id);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE user_id=? AND post_id=?').run(req.user.id, req.params.id);
    res.json({ liked: false });
  } else {
    db.prepare(`INSERT INTO likes (id,user_id,post_id) VALUES (?,?,?)`).run(uuidv4(), req.user.id, req.params.id);
    const post = db.prepare('SELECT user_id FROM posts WHERE id=?').get(req.params.id);
    const me   = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
    if (post) notify(post.user_id, req.user.id, 'like', `${me.name} liked your post`, req.params.id);
    res.json({ liked: true });
  }
});

// ─────────────────────────────────────────────────
//  COMMENTS
// ─────────────────────────────────────────────────
app.get('/api/posts/:id/comments', auth, (req, res) => {
  const comments = db.prepare(`
    SELECT c.*, u.name, u.avatar FROM comments c
    JOIN users u ON u.id=c.user_id
    WHERE c.post_id=? ORDER BY c.created_at ASC
  `).all(req.params.id);
  res.json(comments);
});

app.post('/api/posts/:id/comments', auth, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Comment text required' });

  const id  = uuidv4();
  db.prepare(`INSERT INTO comments (id,user_id,post_id,text) VALUES (?,?,?,?)`)
    .run(id, req.user.id, req.params.id, text);

  const comment = db.prepare(`
    SELECT c.*, u.name, u.avatar FROM comments c
    JOIN users u ON u.id=c.user_id WHERE c.id=?
  `).get(id);

  const post = db.prepare('SELECT user_id FROM posts WHERE id=?').get(req.params.id);
  const me   = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
  if (post) notify(post.user_id, req.user.id, 'comment', `${me.name} commented on your post`, req.params.id);

  // Notify post author's socket for real-time
  const socketId = onlineUsers[post?.user_id];
  if (socketId) io.to(socketId).emit('newComment', { postId: req.params.id, comment });

  res.json(comment);
});

app.delete('/api/comments/:id', auth, (req, res) => {
  db.prepare('DELETE FROM comments WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────────────
//  MESSAGES
// ─────────────────────────────────────────────────
app.get('/api/messages/conversations', auth, (req, res) => {
  const convos = db.prepare(`
    SELECT u.id, u.name, u.avatar,
      (SELECT text FROM messages
       WHERE (sender_id=u.id AND receiver_id=?) OR (sender_id=? AND receiver_id=u.id)
       ORDER BY created_at DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages
       WHERE (sender_id=u.id AND receiver_id=?) OR (sender_id=? AND receiver_id=u.id)
       ORDER BY created_at DESC LIMIT 1) AS last_time,
      (SELECT COUNT(*) FROM messages WHERE sender_id=u.id AND receiver_id=? AND read_at IS NULL) AS unread
    FROM users u
    WHERE u.id IN (
      SELECT DISTINCT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END
      FROM messages WHERE sender_id=? OR receiver_id=?
    )
    ORDER BY last_time DESC NULLS LAST
  `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
  res.json(convos);
});

app.get('/api/messages/:userId', auth, (req, res) => {
  const msgs = db.prepare(`
    SELECT m.*, 
      s.name AS sender_name, s.avatar AS sender_avatar
    FROM messages m
    JOIN users s ON s.id = m.sender_id
    WHERE (m.sender_id=? AND m.receiver_id=?) OR (m.sender_id=? AND m.receiver_id=?)
    ORDER BY m.created_at ASC LIMIT 100
  `).all(req.user.id, req.params.userId, req.params.userId, req.user.id);

  // Mark as read
  db.prepare(`UPDATE messages SET read_at=CURRENT_TIMESTAMP WHERE sender_id=? AND receiver_id=? AND read_at IS NULL`)
    .run(req.params.userId, req.user.id);

  res.json(msgs);
});

app.post('/api/messages/:userId', auth, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Message text required' });

  const id = uuidv4();
  db.prepare(`INSERT INTO messages (id,sender_id,receiver_id,text) VALUES (?,?,?,?)`)
    .run(id, req.user.id, req.params.userId, text);

  const msg = db.prepare(`
    SELECT m.*, s.name AS sender_name, s.avatar AS sender_avatar
    FROM messages m JOIN users s ON s.id=m.sender_id WHERE m.id=?
  `).get(id);

  // Notify receiver
  const socketId = onlineUsers[req.params.userId];
  if (socketId) {
    io.to(socketId).emit('receiveMessage', {
      ...msg,
      senderName: msg.sender_name,
      senderId:   req.user.id,
      senderAvatar: msg.sender_avatar
    });
  }

  res.json(msg);
});

app.delete('/api/messages/:id', auth, (req, res) => {
  db.prepare('DELETE FROM messages WHERE id=? AND sender_id=?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────────────
//  NOTIFICATIONS
// ─────────────────────────────────────────────────
app.get('/api/users/notifications/all', auth, (req, res) => {
  const notifs = db.prepare(`
    SELECT n.*, u.name AS from_name, u.avatar AS from_avatar
    FROM notifications n
    LEFT JOIN users u ON u.id = n.from_id
    WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 50
  `).all(req.user.id);
  res.json(notifs);
});

app.get('/api/users/notifications/unread', auth, (req, res) => {
  const row = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND read=0').get(req.user.id);
  res.json({ count: row.count });
});

app.put('/api/users/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────────────
//  STORIES
// ─────────────────────────────────────────────────
app.get('/api/stories', auth, (req, res) => {
  const stories = db.prepare(`
    SELECT s.*, u.name, u.avatar FROM stories s
    JOIN users u ON u.id=s.user_id
    WHERE s.expires_at > CURRENT_TIMESTAMP
    AND (s.user_id=? OR s.user_id IN (
      SELECT CASE WHEN requester=? THEN addressee ELSE requester END
      FROM friendships WHERE (requester=? OR addressee=?) AND status='accepted'
    ))
    ORDER BY s.created_at DESC
  `).all(req.user.id, req.user.id, req.user.id, req.user.id);
  res.json(stories);
});

app.post('/api/stories', auth, upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Media required for story' });
  const id        = uuidv4();
  const media     = `/uploads/${req.file.filename}`;
  const mediaType = req.file.mimetype.split('/')[0];
  // Stories expire in 24 hours
  db.prepare(`INSERT INTO stories (id,user_id,media,media_type,expires_at) VALUES (?,?,?,?, datetime('now','+24 hours'))`)
    .run(id, req.user.id, media, mediaType);
  res.json({ id, media, mediaType });
});

// ─────────────────────────────────────────────────
//  SOCKET.IO — Real-time events
// ─────────────────────────────────────────────────
const onlineUsers = {};   // userId → socketId
const socketUsers = {};   // socketId → userId

io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    onlineUsers[userId] = socket.id;
    socketUsers[socket.id] = userId;
    io.emit('userOnline', userId);
    socket.broadcast.emit('onlineUsers', Object.keys(onlineUsers));
  });

  socket.on('getOnlineUsers', () => {
    socket.emit('onlineUsers', Object.keys(onlineUsers));
  });

  // ── Typing indicators ──
  socket.on('typing', ({ receiverId, senderId, senderName }) => {
    const recvSocket = onlineUsers[receiverId];
    if (recvSocket) io.to(recvSocket).emit('userTyping', { senderId, senderName });
  });

  socket.on('stopTyping', ({ receiverId, senderId }) => {
    const recvSocket = onlineUsers[receiverId];
    if (recvSocket) io.to(recvSocket).emit('userStopTyping', { senderId });
  });

  // ── Message (direct relay, REST also saves) ──
  socket.on('sendMessage', (data) => {
    const recvSocket = onlineUsers[data.receiverId];
    if (recvSocket) io.to(recvSocket).emit('receiveMessage', data);
  });

  // ── WebRTC Calls ──
  socket.on('callUser', (data) => {
    const recvSocket = onlineUsers[data.receiverId];
    if (recvSocket) io.to(recvSocket).emit('incomingCall', data);
  });

  socket.on('acceptCall', (data) => {
    const callerSocket = onlineUsers[data.callerId];
    if (callerSocket) io.to(callerSocket).emit('callAccepted', data);
  });

  socket.on('declineCall', (data) => {
    const callerSocket = onlineUsers[data.callerId];
    if (callerSocket) io.to(callerSocket).emit('callDeclined', data);
  });

  socket.on('endCall', (data) => {
    const recvSocket = onlineUsers[data.receiverId];
    if (recvSocket) io.to(recvSocket).emit('callEnded');
  });

  // ── WebRTC Signaling relay ──
  socket.on('webrtc-offer', (data) => {
    const recvSocket = onlineUsers[data.to];
    if (recvSocket) io.to(recvSocket).emit('webrtc-offer', { ...data, from: socketUsers[socket.id] });
  });

  socket.on('webrtc-answer', (data) => {
    const recvSocket = onlineUsers[data.to];
    if (recvSocket) io.to(recvSocket).emit('webrtc-answer', { ...data, from: socketUsers[socket.id] });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    const recvSocket = onlineUsers[data.to];
    if (recvSocket) io.to(recvSocket).emit('webrtc-ice-candidate', { ...data, from: socketUsers[socket.id] });
  });

  socket.on('disconnect', () => {
    const userId = socketUsers[socket.id];
    if (userId) {
      delete onlineUsers[userId];
      delete socketUsers[socket.id];
      io.emit('userOffline', userId);
    }
  });
});

// ─────────────────────────────────────────────────
//  SERVE FRONTEND
// ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend not found. Place index.html in /public/');
  }
});

// ─────────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🚀 Nexus Social running at http://localhost:${PORT}`);
  console.log(`   DB: ${path.join(__dirname, 'nexus.db')}`);
  console.log(`   Uploads: ${UPLOADS}\n`);
});
