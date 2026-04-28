#!/usr/bin/env node

import { spawn } from 'child_process';
import path from 'path';

const serverPath = path.join(process.cwd(), 'dist/index.js');

const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let requestId = 0;
let currentTest = 0;

const tests = [
  {
    name: "fetch_page - example.com",
    tool: "fetch_page",
    args: { url: "https://example.com", max_length: 500 }
  },
  {
    name: "extract_metadata - example.com",
    tool: "extract_metadata",
    args: { url: "https://example.com" }
  },
  {
    name: "read_rss - HN",
    tool: "read_rss",
    args: { url: "https://hnrss.org/frontpage", max_items: 3 }
  },
  {
    name: "web_search - DuckDuckGo",
    tool: "web_search",
    args: { query: "Model Context Protocol MCP", max_results: 3, engine: "duckduckgo" }
  },
  {
    name: "summarize_page - example.com",
    tool: "summarize_page",
    args: { url: "https://example.com", sentences: 2 }
  },
  {
    name: "fetch_multiple - parallel",
    tool: "fetch_multiple",
    args: { urls: ["https://example.com", "https://httpbin.org/get"], max_length: 200 }
  },
  {
    name: "search_and_summarize",
    tool: "search_and_summarize",
    args: { query: "MCP server protocol" }
  },
  {
    name: "youtube_transcript (no params - validation)",
    tool: "youtube_transcript",
    args: {},
    expectError: true
  },
];

function sendRequest(method, params) {
  requestId++;
  const request = { jsonrpc: '2.0', id: requestId, method, params };
  server.stdin.write(JSON.stringify(request) + '\n');
  return requestId;
}

server.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg.includes('error') || msg.includes('Error')) {
    console.error('  ⚠️  Server stderr:', msg);
  }
});

server.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    try {
      const response = JSON.parse(line);
      
      if (response.id === 1) {
        console.log('✅ Server initialized\n');
        runNextTest();
      } else if (response.id === 2) {
        const tools = response.result?.tools || [];
        console.log(`📋 ${tools.length} tools available: ${tools.map(t => t.name).join(', ')}\n`);
        console.log('━'.repeat(60));
        console.log('🧪 RUNNING TESTS');
        console.log('━'.repeat(60) + '\n');
        runNextTest();
      } else {
        handleTestResult(response);
      }
    } catch (err) {
      // Ignore parse errors
    }
  }
});

function runNextTest() {
  if (currentTest >= tests.length) {
    console.log('\n' + '━'.repeat(60));
    console.log('🏁 ALL TESTS COMPLETE');
    console.log('━'.repeat(60));
    server.kill();
    process.exit(0);
    return;
  }
  
  const test = tests[currentTest];
  console.log(`\n${currentTest + 1}/${tests.length} 🔍 ${test.name}`);
  console.log('─'.repeat(40));
  
  sendRequest('tools/call', {
    name: test.tool,
    arguments: test.args
  });
}

function handleTestResult(response) {
  const test = tests[currentTest];
  
  if (response.error) {
    console.log(`  ❌ JSON-RPC Error: ${response.error.message}`);
    currentTest++;
    setTimeout(runNextTest, 200);
    return;
  }
  
  const text = response.result?.content?.[0]?.text || '';
  const isError = response.result?.isError;
  const expectedError = test?.expectError;
  
  if (isError && expectedError) {
    console.log(`  ✅ Validation error (expected): ${text.substring(0, 100)}...`);
  } else if (isError) {
    console.log(`  ⚠️  Tool error: ${text.substring(0, 150)}`);
  } else {
    const preview = text.substring(0, 300).replace(/\n/g, ' ↵ ');
    console.log(`  ✅ Success (${text.length} chars)`);
    console.log(`  📄 ${preview}...`);
  }
  
  currentTest++;
  setTimeout(runNextTest, 300);
}

// Start
setTimeout(() => {
  console.log('🚀 InternetSearch MCP Test Suite\n');
  sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'TestSuite', version: '1.0.0' }
  });
  
  setTimeout(() => {
    sendRequest('tools/list', {});
  }, 200);
}, 200);

setTimeout(() => {
  console.log('\n⏰ Timeout - killing server');
  server.kill();
  process.exit(1);
}, 60000);
