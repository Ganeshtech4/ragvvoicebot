-- Create Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create Tenants Table
CREATE TABLE tenants (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) REFERENCES tenants(id) ON DELETE CASCADE,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Knowledge Base Documents Table
CREATE TABLE kb_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Chat Sessions Table
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(50) REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Chat Messages Table
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    sender VARCHAR(20) CHECK (sender IN ('user', 'assistant')),
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed Tenant A: TechSupport
INSERT INTO tenants (id, name) VALUES ('tenant-tech', 'TechSupport Corp');

-- Seed Tenant B: HealthAdvice
INSERT INTO tenants (id, name) VALUES ('tenant-health', 'HealthAdvice Inc');

-- Seed Users
-- For testing, we use standard simple usernames. Passwords will be authenticated simply (or hashed)
INSERT INTO users (id, tenant_id, username, password_hash, role) VALUES 
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'tenant-tech', 'techuser', 'password123', 'user'),
('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'tenant-health', 'healthuser', 'password123', 'user');

-- Seed KB Documents for TechSupport
INSERT INTO kb_documents (tenant_id, title, content) VALUES 
('tenant-tech', 'Reset Password Policy', 'To reset your password, navigate to the TechSupport Portal, click "Forgot Password", and follow the prompts sent to your registered email address. Passwords must be at least 12 characters, include a number and a special character.'),
('tenant-tech', 'VPN Configuration', 'Our company VPN requires the Cisco Secure Client. Download it from the internal tools directory, configure the connection server to vpn.techcorp.com, and authenticate using your corporate active directory credentials and Duo MFA.'),
('tenant-tech', 'Printer Issues Guide', 'If the printer is showing offline, restart the spooler on your Windows machine by running "net stop spooler" then "net start spooler" in an administrator command prompt, or check if IP address 192.168.1.150 is pingable.');

-- Seed KB Documents for HealthAdvice
INSERT INTO kb_documents (tenant_id, title, content) VALUES 
('tenant-health', 'General Flu Care', 'For simple influenza, get plenty of rest and drink fluids like water and clear broths. Over-the-counter pain relievers like acetaminophen or ibuprofen can help manage body aches and fever. Seek emergency care if you experience difficulty breathing.'),
('tenant-health', 'Appointment Cancellation Policy', 'Appointments at HealthAdvice Inc must be cancelled at least 24 hours in advance to avoid a $25 late cancellation fee. You can cancel online through the patient portal or by calling our hotline.'),
('tenant-health', 'Healthy Diet Guidelines', 'A balanced diet should emphasize whole grains, vegetables, fruits, lean proteins, and healthy fats. Limit intake of added sugars, saturated fats, and processed foods. Drink at least 8 glasses of water daily.');
