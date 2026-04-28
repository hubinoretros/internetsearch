async function testDDG() {
  console.log('Testing DDG API via Node.js fetch...\n');
  
  const queries = ['Model Context Protocol', 'MCP server', 'anthropic mcp'];
  
  for (const query of queries) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
          signal: controller.signal
        }
      );
      
      clearTimeout(timeoutId);
      console.log(`Query: "${query}"`);
      console.log('Status:', response.status);
      console.log('Content-Type:', response.headers.get('content-type'));
      
      const text = await response.text();
      
      try {
        const data = JSON.parse(text);
        console.log('Abstract present:', !!data.Abstract);
        console.log('AbstractURL:', data.AbstractURL);
        console.log('RelatedTopics:', data.RelatedTopics?.length || 0);
        console.log('Results:', data.Results?.length || 0);
        if (data.Abstract) console.log('Abstract:', data.Abstract.substring(0, 100));
      } catch (e) {
        console.log('Not JSON:', text.substring(0, 200));
      }
      console.log('');
    } catch (err) {
      console.log(`Error for "${query}":`, err.message, '\n');
    }
  }
}

testDDG();
