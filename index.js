#!/usr/bin/env node
/**
 * AgentHub CLI Pairing Tool
 * 
 * Usage:
 *   npx agenthub-pair --type openclaw --name "My Agent"
 * 
 * Flow:
 *   1. Generate 8-char pairing code
 *   2. Register agent in Supabase
 *   3. Display QR code in terminal
 *   4. Poll for messages from iOS App
 *   5. Handle responses
 */

const { createClient } = require('@supabase/supabase-js');
const qrcode = require('qrcode-terminal');
const crypto = require('crypto');

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && args[i + 1]) opts.type = args[++i];
    if (args[i] === '--name' && args[i + 1]) opts.name = args[++i];
    if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
AgentHub CLI - Pair your AI Agent with iOS App

Usage:
  npx agenthub-pair --type <type> [--name "Agent Name"]

Options:
  --type    Agent type: openclaw | hermes | claude-code | codex (required)
  --name    Agent name (default: "Unknown Agent")
  --help    Show this help

Examples:
  npx agenthub-pair --type openclaw --name "My OpenClaw"
  npx agenthub-pair --type hermes
`);
      process.exit(0);
    }
  }
  return opts;
}

// Generate 8-char pairing code (uppercase letters + digits)
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Remove I,O,0,1 for clarity
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Load Supabase config from .env
function loadConfig() {
  const fs = require('fs');
  const path = require('path');
  
  // Try multiple locations
  const envPaths = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '../.env'),
    path.join(require('os').homedir(), '.agenthub/.env'),
    path.join(require('os').homedir(), '.hermes/skills/hermes-pair/.env'),
  ];
  
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const url = content.match(/SUPABASE_URL=(.+)/)?.[1]?.trim();
      const key = content.match(/SUPABASE_SERVICE_KEY=(.+)/)?.[1]?.trim() 
                 || content.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim();
      if (url && key) return { url, key };
    }
  }
  
  // Try environment variables
  if (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    return {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
  }
  
  return null;
}

// Main
async function main() {
  const opts = parseArgs();
  
  if (!opts.type) {
    console.error('❌ Error: --type is required');
    console.error('   Use --help for usage');
    process.exit(1);
  }
  
  const validTypes = ['openclaw', 'hermes', 'claude-code', 'codex'];
  if (!validTypes.includes(opts.type)) {
    console.error(`❌ Error: Invalid type "${opts.type}"`);
    console.error(`   Valid types: ${validTypes.join(', ')}`);
    process.exit(1);
  }
  
  const config = loadConfig();
  if (!config) {
    console.error('❌ Error: Could not find Supabase config');
    console.error('   Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env or environment');
    process.exit(1);
  }
  
  const supabase = createClient(config.url, config.key);
  const code = generateCode();
  const name = opts.name || 'Unknown Agent';
  
  console.log('\n🔗 AgentHub Pairing Tool\n');
  
  // Register agent
  console.log(`📝 Registering agent: ${name} (${opts.type})`);
  const { data, error } = await supabase
    .from('agents')
    .insert({ code, type: opts.type, name })
    .select()
    .single();
  
  if (error) {
    if (error.code === '23505') { // Unique violation
      console.error(`❌ Error: Code "${code}" already exists. Try again.`);
    } else {
      console.error('❌ Error registering agent:', error.message);
    }
    process.exit(1);
  }
  
  console.log('✅ Agent registered\n');
  
  // Display pairing code
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│  AgentHub Pairing                            │');
  console.log('├─────────────────────────────────────────────┤');
  console.log(`│  Code: ${code}                                  │`);
  console.log('│                                               │');
  
  // Generate QR code
  const qrContent = `agenthub://pair?code=${code}`;
  qrcode.generate(qrContent, { small: true }, (qr) => {
    const qrLines = qr.split('\n');
    for (const line of qrLines) {
      console.log(`│  ${line.padEnd(43)}│`);
    }
    console.log('│                                               │');
    console.log('│  📱 Scan QR or enter code in iOS App         │');
    console.log('│  Waiting for connection...                    │');
    console.log('└─────────────────────────────────────────────┘');
    console.log('\nPress Ctrl+C to exit\n');
    
    // Start polling
    startPolling(supabase, code);
  });
}

// Poll for messages
async function startPolling(supabase, code) {
  let lastHeartbeat = Date.now();
  
  // Heartbeat every 30 seconds
  const heartbeatInterval = setInterval(async () => {
    if (Date.now() - lastHeartbeat > 30000) {
      await supabase
        .from('agents')
        .update({ last_heartbeat: new Date().toISOString() })
        .eq('code', code);
      lastHeartbeat = Date.now();
    }
  }, 30000);
  
  // Poll for messages every 5 seconds
  const pollInterval = setInterval(async () => {
    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .eq('agent_code', code)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      
      if (error || !messages || messages.length === 0) return;
      
      for (const msg of messages) {
        console.log(`\n📩 New message from iOS App:`);
        console.log(`   "${msg.content}"`);
        
        // Here you would process the message
        // For now, return a mock response
        const response = `[Agent] Received: "${msg.content}"`;
        
        // Post response
        await supabase.from('responses').insert({
          message_id: msg.id,
          agent_code: code,
          content: response,
        });
        
        // Mark message as done
        await supabase
          .from('messages')
          .update({ status: 'done' })
          .eq('id', msg.id);
        
        console.log(`   ✅ Response sent`);
      }
    } catch (e) {
      // Ignore polling errors
    }
  }, 5000);
  
  // Cleanup on exit
  process.on('SIGINT', async () => {
    clearInterval(heartbeatInterval);
    clearInterval(pollInterval);
    
    console.log('\n\n👋 Unregistering agent...');
    await supabase.from('agents').delete().eq('code', code);
    console.log('✅ Done. Goodbye!\n');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
