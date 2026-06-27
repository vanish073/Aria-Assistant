#!/usr/bin/env node
'use strict';

/**
 * ARIA — Database Setup Script
 * Run once after installing PostgreSQL natively:
 *   node scripts/setup-db.js
 */

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function setup() {
  console.log('\n🔧 ARIA Database Setup\n');

  // Step 1: Connect as superuser to create DB and user
  const adminClient = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    // Connect to default 'postgres' DB first
    database: 'postgres',
    // Use OS user (works for fresh native installs on Mac/Linux)
    // On Windows or if this fails, set POSTGRES_ADMIN_USER / POSTGRES_ADMIN_PASSWORD in .env
    user: process.env.POSTGRES_ADMIN_USER || process.env.USER || 'postgres',
    password: process.env.POSTGRES_ADMIN_PASSWORD || undefined
  });

  try {
    await adminClient.connect();
    console.log('✓ Connected to PostgreSQL as admin');

    const dbUser = process.env.POSTGRES_USER || 'aria';
    const dbPassword = process.env.POSTGRES_PASSWORD || 'ariapassword';
    const dbName = process.env.POSTGRES_DB || 'aria_db';

    // Create user if not exists
    await adminClient.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${dbUser}') THEN
           CREATE USER ${dbUser} WITH PASSWORD '${dbPassword}';
         END IF;
       END $$;`
    );
    console.log(`✓ User '${dbUser}' ready`);

    // Create database if not exists
    const dbExists = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`
    );
    if (!dbExists.rows.length) {
      await adminClient.query(`CREATE DATABASE ${dbName} OWNER ${dbUser}`);
      console.log(`✓ Database '${dbName}' created`);
    } else {
      console.log(`✓ Database '${dbName}' already exists`);
    }

    // Grant privileges
    await adminClient.query(`GRANT ALL PRIVILEGES ON DATABASE ${dbName} TO ${dbUser}`);
    console.log(`✓ Privileges granted to '${dbUser}'`);

  } catch (err) {
    console.error('\n❌ Admin connection failed:', err.message);
    console.error('\nTry adding these to your .env:');
    console.error('  POSTGRES_ADMIN_USER=postgres');
    console.error('  POSTGRES_ADMIN_PASSWORD=your_postgres_admin_password\n');
    process.exit(1);
  } finally {
    await adminClient.end();
  }

  // Step 2: Connect as aria user to run schema
  const ariaClient = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'aria_db',
    user: process.env.POSTGRES_USER || 'aria',
    password: process.env.POSTGRES_PASSWORD || 'ariapassword'
  });

  try {
    await ariaClient.connect();
    console.log(`✓ Connected as '${process.env.POSTGRES_USER || 'aria'}'`);

    const sql = fs.readFileSync(path.join(__dirname, '..', 'config', 'init.sql'), 'utf8');
    await ariaClient.query(sql);
    console.log('✓ Schema created (all tables, indexes, seed data)');

  } catch (err) {
    console.error('\n❌ Schema setup failed:', err.message);
    process.exit(1);
  } finally {
    await ariaClient.end();
  }

  console.log('\n✅ Database setup complete! You can now run: npm run dev\n');
}

setup();
