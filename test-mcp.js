#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';

const serverPath = path.join(process.cwd(), 'dist/index.js');

// Start the MCP server
const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let requestId = 0;

function sendRequest(method, params) {
  requestId++;
  const request = {
    jsonrpc: '2.0',
    id: requestId,
    method,
    params
  };
  server.stdin.write(JSON.stringify(request) + '\n');
  return requestId;
}

server.stderr.on('data', (data) => {
  console.error('Server:', data.toString().trim());
});

server.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    try {
      const response = JSON.parse(line);
      
      if (response.id === 1) {
        console.log('✅ Initialize OK');
        // List tools
        setTimeout(() => {
          console.log('\n📋 Listing tools...');
          sendRequest('tools/list', {});
        }, 100);
      } else if (response.id === 2) {
        console.log('✅ Tools list received');
        const tools = response.result?.tools || [];
        console.log(`   Found ${tools.length} tools:`);
        tools.forEach(t => console.log(`     - ${t.name}`));
        
        // Test youtube_transcript schema
        setTimeout(() => {
          console.log('\n🎬 Testing youtube_transcript (with video_id)...');
          sendRequest('tools/call', {
            name: 'youtube_transcript',
            arguments: { video_id: 'dQw4w9WgXcQ' }
          });
        }, 100);
      } else if (response.id === 3) {
        console.log('\n📺 youtube_transcript result:');
        if (response.error) {
          console.log('   ❌ Error:', response.error.message);
        } else {
          const text = response.result?.content?.[0]?.text;
          if (text) {
            console.log('   ✅ Success (first 200 chars):');
            console.log('   ', text.substring(0, 200).replace(/\n/g, ' '));
          }
        }
        
        // Test without params (should give clear error)
        setTimeout(() => {
          console.log('\n🧪 Testing youtube_transcript (no params - should error)...');
          sendRequest('tools/call', {
            name: 'youtube_transcript',
            arguments: {}
          });
        }, 100);
      } else if (response.id === 4) {
        console.log('\n📺 youtube_transcript (no params) result:');
        if (response.error) {
          console.log('   ❌ Error:', response.error.message);
        } else {
          const text = response.result?.content?.[0]?.text;
          if (text) {
            if (response.result?.isError) {
              console.log('   ✅ Validation error (as expected):');
              console.log('   ', text);
            } else {
              console.log('   ❌ Unexpected success');
            }
          }
        }
        
        // Exit
        console.log('\n🏁 Test complete');
        setTimeout(() => {
          server.kill();
          process.exit(0);
        }, 500);
      }
    } catch (err) {
      console.error('Parse error:', err, 'Line:', line.substring(0, 100));
    }
  }
});

// Start
setTimeout(() => {
  console.log('🚀 Testing InternetSearch MCP...\n');
  sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'Test', version: '1.0.0' }
  });
}, 100);

setTimeout(() => {
  console.log('Timeout');
  server.kill();
  process.exit(1);
}, 20000);
