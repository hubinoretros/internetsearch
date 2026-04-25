# InternetSearch MCP

Enhanced web search and content extraction MCP server. Search the web, fetch pages, extract metadata, read RSS feeds, get YouTube transcripts, and more.

An evolution of mcp-server-fetch with significantly more capabilities.

## Features

- **Web Search** — DuckDuckGo (default) and Brave Search API support
- **Page Fetching** — Extract clean text from any web page with pagination support
- **Content Summarization** — Auto-summarize pages using extractive summarization
- **Parallel Fetching** — Fetch multiple URLs at once
- **RSS/Atom Feeds** — Read and parse news feeds
- **YouTube Transcripts** — Extract video transcripts (requires yt-dlp)
- **Metadata Extraction** — OpenGraph, title, description, author, published date
- **Link Extraction** — Get all links from a page
- **Search & Summarize** — Search and get a summary of the top result in one call

## Installation

```bash
npm install -g @nachoretro/internetsearch
```

Or use npx (no install):
```bash
npx @nachoretro/internetsearch
```

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "internetsearch": {
      "command": "npx",
      "args": ["-y", "@nachoretro/internetsearch"],
      "env": {
        "BRAVE_API_KEY": "optional-brave-api-key-for-better-search"
      }
    }
  }
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `BRAVE_API_KEY` | Brave Search API key for higher-quality search results |

## Tools

### `web_search`

Search the web using DuckDuckGo or Brave Search.

```json
{
  "query": "latest AI developments 2025",
  "max_results": 10,
  "engine": "duckduckgo"
}
```

### `fetch_page`

Fetch and extract content from a web page.

```json
{
  "url": "https://example.com/article",
  "max_length": 5000,
  "start_index": 0,
  "extract_links": true,
  "raw": false
}
```

### `summarize_page`

Fetch and summarize a page in one call.

```json
{
  "url": "https://example.com/long-article",
  "sentences": 3
}
```

### `fetch_multiple`

Fetch multiple URLs in parallel.

```json
{
  "urls": [
    "https://example.com/page1",
    "https://example.com/page2",
    "https://example.com/page3"
  ],
  "max_length": 3000
}
```

### `read_rss`

Read an RSS or Atom feed.

```json
{
  "url": "https://news.ycombinator.com/rss",
  "max_items": 10
}
```

### `youtube_transcript`

Extract transcript from a YouTube video (requires [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed).

```json
{
  "video_id": "dQw4w9WgXcQ"
}
```

Or with full URL:
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

### `extract_metadata`

Extract metadata from a URL.

```json
{
  "url": "https://example.com/article"
}
```

Returns: title, description, author, published date, OpenGraph image, word count.

### `search_and_summarize`

Search and summarize the top result in one call.

```json
{
  "query": "climate change latest research",
  "engine": "duckduckgo"
}
```

## Comparison with mcp-server-fetch

| Feature | mcp-server-fetch | internetsearch |
|---------|------------------|----------------|
| Basic page fetch | ✅ | ✅ |
| Content extraction | ✅ | ✅ (improved) |
| Pagination | ✅ | ✅ |
| **Web search** | ❌ | ✅ DuckDuckGo + Brave |
| **Summarization** | ❌ | ✅ Auto-summarize |
| **Parallel fetch** | ❌ | ✅ Multiple URLs |
| **RSS feeds** | ❌ | ✅ RSS + Atom |
| **YouTube transcripts** | ❌ | ✅ Requires yt-dlp |
| **Metadata extraction** | ❌ | ✅ OpenGraph, etc. |
| **Search & summarize** | ❌ | ✅ Combined operation |
| **Link extraction** | ❌ | ✅ All page links |
| **HTML parsing** | readabilipy | cheerio (lighter) |

## Prerequisites

### Optional (for enhanced features)

1. **ddgr** — For DuckDuckGo search via command line:
   ```bash
   pip install ddgr
   ```

2. **yt-dlp** — For YouTube transcript extraction:
   ```bash
   pip install yt-dlp
   ```

3. **Brave Search API Key** — For higher quality search results:
   - Get API key at [brave.com/search/api](https://brave.com/search/api)
   - Set `BRAVE_API_KEY` environment variable

## Usage Examples

### Research Workflow

```
User: "What's the latest on quantum computing?"

→ web_search: "quantum computing breakthroughs 2025"
→ fetch_page: top result URL
→ summarize_page: for quick overview
```

### Content Monitoring

```
User: "Check the latest from Hacker News"

→ read_rss: "https://news.ycombinator.com/rss"
→ fetch_multiple: top 5 story URLs
```

### Video Analysis

```
User: "Summarize this YouTube video"

→ youtube_transcript: video_id
→ (Claude summarizes the transcript)
```

## Development

```bash
git clone https://github.com/hubinoretros/internetsearch.git
cd internetsearch
npm install
npm run build
npm start
```

## License

MIT
