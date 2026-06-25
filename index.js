#!/usr/bin/env node
/**
 * AgentHub CLI Pairing Tool
 * 
 * Usage:
 *   node index.js --type hermes --name "My Agent"
 * 
 * No configuration needed — connects to AgentHub cloud automatically.
 */

const qrcode = require('qrcode-terminal');

// AgentHub Cloud — built-in, no config needed
const SUPABASE_URL = 'https://awvggmbixfvmlmkpivqr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3dmdnbWJpeGZ2bWxta3BpdnFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNTYxOTgsImV4cCI6MjA5NzkzMjE5OH0.NvnGtLZg9Sr1fmCAvojPpX5xrN7ZyaOZsjAx6Pg9Flo';

// HTTP helpers (no SDK dependency, Node 18+ native fetch)
async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${method} ${path}: ${res.status} ${err}`);
  }
  return res.json();
}

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) opts.type = args[++i];
    if (args[i] === '--name' && args[i + 1]) opts.name = args[++i];
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
AgentHub CLI — Pair your AI Agent

Usage:
  node index.js --type <type> [--name "Agent Name"]

Types: openclaw | hermes | claude-code

Examples:
  node index.js --type hermes
  node index.js --type openclaw --name "My Coder"
`);
      process.exit(0);
    }
  }
  return opts;
}

// Generate 8-char pairing code
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function main() {
  const opts = parseArgs();
  
  if (!opts.type) {
    console.error('Error: --type is required (openclaw | hermes | claude-code)');
    process.exit(1);
  }
  
  const validTypes = ['openclaw', 'hermes', 'claude-code'];
  if (!validTypes.includes(opts.type)) {
    console.error(`Invalid type "${opts.type}". Use: ${validTypes.join(', ')}`);
    process.exit(1);
  }

  const code = generateCode();
  const name = opts.name || opts.type.charAt(0).toUpperCase() + opts.type.slice(1);

  console.log('');
  console.log('  AgentHub Pairing');
  console.log('  ─────────────────────────');
  console.log(`  Agent: ${name}`);
  console.log(`  Type:  ${opts.type}`);
  console.log('');

  // Register agent
  try {
    await api('POST', '/agents', { code, type: opts.type, name });
  } catch (e) {
    console.error(`  Registration failed: ${e.message}`);
    process.exit(1);
  }

  console.log('  Agent registered');
  console.log('');

  // Display QR code
  const qrContent = `agenthub://pair?code=${code}`;
  
  console.log('  ┌───────────────────────────────────────────┐');
  console.log(`  │  Code: ${code}                               │`);
  console.log('  │                                             │');
  
  qrcode.generate(qrContent, { small: true }, (qr) => {
    const lines = qr.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        console.log(`  │  ${line.padEnd(41)}│`);
      }
    }
    console.log('  │                                             │');
    console.log('  │  Scan with AgentHub app                    │');
    console.log('  └───────────────────────────────────────────┘');
    console.log('');
    console.log('  Waiting for messages... (Ctrl+C to stop)');
    console.log('');
    
    startPolling(code);
  });
}

// Poll for messages
function startPolling(code) {
  let lastHeartbeat = Date.now();

  // Heartbeat every 30s
  setInterval(async () => {
    try {
      await api('PATCH', `/agents?code=eq.${code}`, {
        last_heartbeat: new Date().toISOString(),
        status: 'online'
      });
    } catch (e) { /* ignore */ }
  }, 30000);

  // Poll messages every 5s
  setInterval(async () => {
    try {
      const messages = await api('GET', 
        `/messages?agent_code=eq.${code}&status=eq.pending&order=created_at.asc`);
      
      for (const msg of messages) {
        console.log(`  [${new Date(msg.created_at).toLocaleTimeString()}] ${msg.content}`);
        
        // Send response
        const response = `Received: "${msg.content}"`;
        await api('POST', '/responses', {
          message_id: msg.id,
          agent_code: code,
          content: response,
        });
        
        // Mark done
        await api('PATCH', `/messages?id=eq.${msg.id}`, { status: 'done' });
        console.log(`  Replied`);
      }
    } catch (e) { /* ignore polling errors */ }
  }, 5000);

  // Cleanup on exit — set offline, don't delete
  process.on('SIGINT', async () => {
    console.log('\n  Setting agent offline...');
    try {
      await api('PATCH', `/agents?code=eq.${code}`, { status: 'offline' });
    } catch (e) { /* ignore */ }
    console.log('  Goodbye!\n');
    process.exit(0);
  });
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
