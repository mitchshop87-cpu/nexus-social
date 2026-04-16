# 🌐 Nexus Social — Full-Stack Social Media Platform

A complete, production-ready social media app with real-time messaging, WebRTC audio/video calls, friend system, notifications, and more.

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 18+ — https://nodejs.org
- NPM (comes with Node.js)

### 2. Setup
```bash
# Navigate to the nexus folder
cd nexus

# Install all dependencies
npm install

# Start the server
npm start
```

### 3. Open the app
Visit: **http://localhost:3000**

Register an account (or two accounts in different browser windows to test messaging & calls).

---

## 📁 File Structure

```
nexus/
├── server.js          ← Backend (Express + Socket.IO + SQLite)
├── package.json       ← Node.js dependencies
├── nexus.db           ← SQLite database (auto-created on first run)
├── uploads/           ← User-uploaded media (auto-created)
└── public/
    └── index.html     ← Complete frontend (all HTML/CSS/JS)
```

---

## ✅ Features Included

### Authentication
- [x] Register with name, email, password
- [x] Login / Logout
- [x] JWT tokens (30-day expiry)
- [x] Password hashing (bcrypt)
- [x] Profile edit (name, bio, location, website, avatar URL)

### Social Feed
- [x] Create text posts
- [x] Upload photo / video media
- [x] Delete your own posts
- [x] Like / Unlike posts (real-time count)
- [x] Comment on posts
- [x] Delete your own comments
- [x] Feed shows your posts + friends' posts
- [x] Real-time new post via Socket.IO

### Friend System
- [x] Send friend requests
- [x] Accept / Decline friend requests
- [x] Friend request badge (count on nav)
- [x] View all friends in Friends tab
- [x] Suggested people to follow
- [x] Inline accept/decline from notifications

### Real-time Messaging
- [x] Open chat windows from friend list / profile / messages tab
- [x] Real-time message delivery via Socket.IO
- [x] Typing indicators
- [x] Conversation list with last message + unread count
- [x] Message read receipts (✓ / ✓✓)
- [x] Minimizable chat windows
- [x] Up to 3 simultaneous chat windows

### WebRTC Calls
- [x] Audio calls (peer-to-peer via WebRTC)
- [x] Video calls (peer-to-peer via WebRTC)
- [x] Incoming call banner (non-blocking)
- [x] Mute / unmute microphone
- [x] Camera on / off toggle
- [x] Speaker on / off
- [x] Call timer
- [x] STUN server for NAT traversal

### Notifications
- [x] Like notifications
- [x] Comment notifications
- [x] Friend request notifications
- [x] Friend accept notifications
- [x] New post notifications to friends
- [x] Real-time badge count
- [x] Mark all as read
- [x] Accept/decline friend requests directly from notifications panel

### PWA (Progressive Web App)
- [x] Auto-install popup (2.8s after first visit)
- [x] Native install dialog on Android/Chrome
- [x] Step-by-step instructions for iOS/Safari
- [x] Dismisses for 3 days if skipped
- [x] Service Worker for offline support
- [x] Web App Manifest (home screen icon)

### Analytics & Ads
- [x] Google Analytics GA4 (G-LD0F80F04R)
- [x] Google AdSense (ca-pub-6830176057072253)
- [x] Ad units in feed, right sidebar, between posts

---

## 🔧 Environment Variables

Create a `.env` file (optional, defaults work for development):

```env
PORT=3000
JWT_SECRET=your_super_secret_key_change_this
```

---

## 🌍 Production Deployment

### Recommended: Render.com (Free tier)
1. Push code to GitHub
2. Create new Web Service on render.com
3. Set build command: `npm install`
4. Set start command: `node server.js`
5. Add environment variable: `JWT_SECRET=your_secret`

### VPS (Ubuntu)
```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 process manager
npm install -g pm2

# Start app
pm2 start server.js --name nexus
pm2 startup && pm2 save

# Optional: Nginx reverse proxy
sudo apt install nginx
# Configure nginx to proxy localhost:3000
```

### For HTTPS (required for WebRTC on production)
Use a reverse proxy (Nginx + Let's Encrypt) or a platform like Render/Railway that provides HTTPS automatically.

---

## 📱 WebRTC Notes

- WebRTC works on localhost without HTTPS
- On production, **HTTPS is required** for camera/mic access
- The app uses Google STUN servers for NAT traversal
- For calls across different networks, you may need a TURN server (coturn)

### Add TURN server (optional, for better call reliability):
In `public/index.html`, find the `ICE` config and add:
```js
const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'user',
      credential: 'password'
    }
  ]
};
```

---

## 🔒 Security Notes for Production

1. Change `JWT_SECRET` to a long random string
2. Add rate limiting: `npm install express-rate-limit`
3. Add helmet: `npm install helmet`
4. Validate and sanitize all inputs
5. Set up HTTPS
6. Consider moving to PostgreSQL for larger scale

---

Built with ❤️ — Nexus Social v2.0
 
