#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';

const serverPath = path.join(process.cwd(), 'dist/index.js');
const server = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });

server.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  console.log('  📝 Server:', msg);
});

server.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  for (const line of lines) {
    try {
      const response = JSON.parse(line);
      if (response.id === 2) {
        console.log('\n📊 web_search result:');
        const text = response.result?.content?.[0]?.text;
        if (text) {
          console.log('Content length:', text.length);
          console.log('Preview:', text.substring(0, 500));
        } else {
          console.log('No content');
        }
        if (response.result?.isError) console.log('isError: true');
        server.kill();
        process.exit(0);
      }
    } catch {}
  }
});

setTimeout(() => {
  console.log('🚀 Testing web_search...');
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Test', version: '1.0' } }
  }) + '\n');
}, 200);

setTimeout(() => {
  server.stdin.write(JSON.stringify({
    jsonrpc: '2.0', id: 2,
    method: 'tools/call',
    params: {
      name: 'web_search',
      arguments: { query: 'MCP server protocol', max_results: 5, engine: 'duckduckgo' }
    }
  }) + '\n');
}, 500);

setTimeout(() => { server.kill(); process.exit(1); }, 25000);
