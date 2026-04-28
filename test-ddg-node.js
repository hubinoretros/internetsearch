async function testDDG() {
  console.log('Testing DDG API via Node.js fetch...');
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(
      'https://api.duckduckgo.com/?q=MCP+server&format=json&no_html=1',
      { signal: controller.signal }
    );
    
    console.log('Response status:', response.status);
    const text = await response.text();
    console.log('Response length:', text.length);
    
    try {
      const data = JSON.parse(text);
      console.log('Abstract present:', !!data.Abstract);
      console.log('AbstractURL:', data.AbstractURL);
      console.log('RelatedTopics count:', data.RelatedTopics?.length || 0);
    } catch (e) {
      console.log('Could not parse JSON:', text.substring(0, 200));
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testDDG();
