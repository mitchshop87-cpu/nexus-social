const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        avatar VARCHAR(255) DEFAULT '',
        cover VARCHAR(255) DEFAULT '',
        bio TEXT DEFAULT '',
        location VARCHAR(100) DEFAULT '',
        website VARCHAR(100) DEFAULT '',
        followers INT DEFAULT 0,
        following INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Posts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        text TEXT,
        media VARCHAR(255) DEFAULT '',
        shares INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Comments table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id VARCHAR(36) PRIMARY KEY,
        post_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Likes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS likes (
        id VARCHAR(36) PRIMARY KEY,
        post_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Friends table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS friends (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        friend_id VARCHAR(36) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(36) PRIMARY KEY,
        sender_id VARCHAR(36) NOT NULL,
        receiver_id VARCHAR(36) NOT NULL,
        text TEXT NOT NULL,
        read_status BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Notifications table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        from_user_id VARCHAR(36) NOT NULL,
        type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        read_status BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log('✅ Database tables ready!');
  } catch (error) {
    console.error('Database init error:', error);
  }
}

initDB();

module.exports = pool;
