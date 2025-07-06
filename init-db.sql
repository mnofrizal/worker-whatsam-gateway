-- WhatsApp Gateway Worker Database Schema
-- This script initializes the PostgreSQL database for the worker

-- Create database (run this manually if needed)
-- CREATE DATABASE whatsapp_worker;

-- Connect to the database
\c whatsapp_worker;

-- Create worker_sessions table
CREATE TABLE IF NOT EXISTS worker_sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    session_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'disconnected',
    phone_number VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_activity TIMESTAMP DEFAULT NOW()
);

-- Create worker_messages table
CREATE TABLE IF NOT EXISTS worker_messages (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(255) UNIQUE NOT NULL,
    session_id VARCHAR(255) NOT NULL,
    from_number VARCHAR(50),
    to_number VARCHAR(50),
    message_type VARCHAR(50) DEFAULT 'text',
    content TEXT,
    media_url TEXT,
    status VARCHAR(50) DEFAULT 'sent',
    timestamp TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (session_id) REFERENCES worker_sessions(session_id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_worker_sessions_user_id ON worker_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_worker_sessions_status ON worker_sessions(status);
CREATE INDEX IF NOT EXISTS idx_worker_sessions_updated_at ON worker_sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_worker_messages_session_id ON worker_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_worker_messages_timestamp ON worker_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_worker_messages_status ON worker_messages(status);
CREATE INDEX IF NOT EXISTS idx_worker_messages_message_id ON worker_messages(message_id);

-- Insert sample data for testing (optional)
INSERT INTO worker_sessions (session_id, user_id, session_name, status) 
VALUES 
    ('test-session-1', 'user123', 'Test Session 1', 'disconnected'),
    ('test-session-2', 'user456', 'Test Session 2', 'disconnected')
ON CONFLICT (session_id) DO NOTHING;

-- Create a view for session statistics
CREATE OR REPLACE VIEW session_stats AS
SELECT 
    s.session_id,
    s.user_id,
    s.session_name,
    s.status,
    s.phone_number,
    s.created_at,
    s.last_activity,
    COUNT(m.id) as message_count,
    MAX(m.timestamp) as last_message_at
FROM worker_sessions s
LEFT JOIN worker_messages m ON s.session_id = m.session_id
GROUP BY s.session_id, s.user_id, s.session_name, s.status, s.phone_number, s.created_at, s.last_activity;

-- Grant permissions (adjust as needed)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;

-- Display table information
\dt
\d worker_sessions
\d worker_messages

-- Show sample data
SELECT 'Sample Sessions:' as info;
SELECT * FROM worker_sessions LIMIT 5;

SELECT 'Sample Messages:' as info;
SELECT * FROM worker_messages LIMIT 5;

SELECT 'Session Statistics:' as info;
SELECT * FROM session_stats LIMIT 5;

-- Success message
SELECT 'Database schema initialized successfully!' as status;