#!/usr/bin/env node

/**
 * InternetSearch MCP Server
 * Enhanced web fetching with search engines, content extraction, and more
 * Based on mcp-server-fetch but with significant improvements
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import * as cheerio from "cheerio";

// User agents
const DEFAULT_USER_AGENT = "InternetSearch-MCP/1.0 (+https://github.com/hubinoretros/internetsearch)";

// Interfaces
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface PageContent {
  url: string;
  title: string;
  content: string;
  meta: {
    description?: string;
    author?: string;
    published?: string;
    image?: string;
  };
  links: string[];
  wordCount: number;
}

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

// Search engines
async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  
  try {
    // Use ddgr or duckduckgo-search Python package via subprocess
    const ddgr = spawn("ddgr", ["--json", "-n", maxResults.toString(), query]);
    
    let output = "";
    ddgr.stdout.on("data", (data) => { output += data; });
    
    await new Promise((resolve, reject) => {
      ddgr.on("close", (code) => {
        if (code === 0 || output.length > 0) resolve(null);
        else reject(new Error("ddgr failed"));
      });
      ddgr.on("error", reject);
      setTimeout(() => { ddgr.kill(); resolve(null); }, 10000);
    });
    
    if (output) {
      const lines = output.split("\n").filter(line => line.trim());
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          results.push({
            title: item.title,
            url: item.url,
            snippet: item.abstract,
            source: "DuckDuckGo"
          });
        } catch {}
      }
    }
  } catch {
    // Fallback: simulate search with brave search API if available
  }
  
  return results;
}

async function searchBrave(query: string, apiKey: string, maxResults: number): Promise<SearchResult[]> {
  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
      {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": apiKey,
          "User-Agent": DEFAULT_USER_AGENT,
        }
      }
    );
    
    if (!response.ok) throw new Error(`Brave API error: ${response.status}`);
    
    const data = await response.json();
    return data.web?.results?.map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      source: "Brave"
    })) || [];
  } catch (error) {
    return [];
  }
}

// Content extraction
async function fetchUrl(
  url: string, 
  options: {
    raw?: boolean;
    timeout?: number;
    extractLinks?: boolean;
  } = {}
): Promise<PageContent> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), (options.timeout || 30) * 1000);
  
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "DNT": "1",
        "Connection": "keep-alive",
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract metadata
    const title = $("title").text().trim() || $("h1").first().text().trim() || "Untitled";
    const description = $("meta[name='description']").attr("content") || 
                       $("meta[property='og:description']").attr("content");
    const author = $("meta[name='author']").attr("content") ||
                  $("meta[property='article:author']").attr("content");
    const published = $("meta[property='article:published_time']").attr("content") ||
                     $("time").first().attr("datetime");
    const image = $("meta[property='og:image']").attr("content");
    
    // Extract main content
    let content: string;
    
    if (options.raw) {
      content = html;
    } else {
      // Remove script, style, nav, footer, header elements
      $("script, style, nav, footer, header, aside, .ads, .advertisement").remove();
      
      // Try to find main content
      const mainContent = $("main, article, [role='main'], .content, #content, .post").first();
      
      if (mainContent.length > 0) {
        content = mainContent.text();
      } else {
        // Fallback to body
        content = $("body").text();
      }
      
      // Clean up whitespace
      content = content
        .replace(/\s+/g, " ")
        .replace(/\n\s*\n/g, "\n\n")
        .trim();
    }
    
    // Extract links if requested
    const links: string[] = [];
    if (options.extractLinks) {
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
          try {
            const absoluteUrl = new URL(href, url).href;
            links.push(absoluteUrl);
          } catch {}
        }
      });
    }
    
    const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
    
    return {
      url,
      title,
      content,
      meta: { description, author, published, image },
      links: [...new Set(links)].slice(0, 100),
      wordCount,
    };
    
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// RSS Feed parser
async function parseRSS(url: string): Promise<RSSItem[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": DEFAULT_USER_AGENT },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const xml = await response.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    
    const items: RSSItem[] = [];
    
    // Try RSS 2.0
    $("item").each((_, el) => {
      items.push({
        title: $(el).find("title").text().trim(),
        link: $(el).find("link").text().trim(),
        description: $(el).find("description").text().trim() || 
                    $(el).find("content\\:encoded").text().trim(),
        pubDate: $(el).find("pubDate").text().trim() ||
                $(el).find("dc\\:date").text().trim(),
      });
    });
    
    // Try Atom
    $("entry").each((_, el) => {
      const link = $(el).find("link").attr("href") || $(el).find("link").text().trim();
      items.push({
        title: $(el).find("title").text().trim(),
        link,
        description: $(el).find("summary").text().trim() ||
                    $(el).find("content").text().trim(),
        pubDate: $(el).find("updated").text().trim() ||
                $(el).find("published").text().trim(),
      });
    });
    
    return items;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// YouTube transcript extraction (simulated - requires yt-dlp or similar)
async function getYouTubeTranscript(videoId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn("yt-dlp", ["--skip-download", "--print", "transcript", `https://youtube.com/watch?v=${videoId}`]);
    
    let output = "";
    let error = "";
    
    ytdlp.stdout.on("data", (data) => { output += data; });
    ytdlp.stderr.on("data", (data) => { error += data; });
    
    ytdlp.on("close", (code) => {
      if (code === 0 && output) {
        resolve(output);
      } else {
        reject(new Error(error || "Failed to extract transcript"));
      }
    });
    
    ytdlp.on("error", () => {
      reject(new Error("yt-dlp not installed"));
    });
    
    setTimeout(() => {
      ytdlp.kill();
      reject(new Error("Timeout"));
    }, 30000);
  });
}

// Content summarization (simple implementation)
function summarizeContent(text: string, maxSentences: number = 3): string {
  // Split into sentences
  const sentences: string[] = text.match(/[^.!?]+[.!?]+/g) || [];
  
  // Score sentences by keyword frequency
  const wordFreq: Map<string, number> = new Map();
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  
  for (const word of words) {
    if (word.length > 3) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  }
  
  const scored = sentences.map((sentence, index) => {
    const sentenceWords = sentence.toLowerCase().match(/\b\w+\b/g) || [];
    const score = sentenceWords.reduce((sum, word) => sum + (wordFreq.get(word) || 0), 0);
    return { sentence: sentence.trim(), score, originalIndex: index };
  });
  
  scored.sort((a, b) => b.score - a.score);
  
  return scored
    .slice(0, maxSentences)
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map(s => s.sentence)
    .join(" ");
}

// MCP Server setup
const server = new Server(
  {
    name: "internetsearch",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const tools: Tool[] = [
  {
    name: "web_search",
    description: "Search the web using DuckDuckGo or Brave Search API",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results (default: 10)",
          default: 10,
        },
        engine: {
          type: "string",
          description: "Search engine: 'duckduckgo' (default) or 'brave'",
          enum: ["duckduckgo", "brave"],
          default: "duckduckgo",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_page",
    description: "Fetch and extract content from a web page",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch",
        },
        raw: {
          type: "boolean",
          description: "Return raw HTML instead of extracted text",
          default: false,
        },
        extract_links: {
          type: "boolean",
          description: "Extract all links from the page",
          default: false,
        },
        max_length: {
          type: "number",
          description: "Maximum characters to return (default: 5000)",
          default: 5000,
        },
        start_index: {
          type: "number",
          description: "Start from this character index for pagination",
          default: 0,
        },
      },
      required: ["url"],
    },
  },
  {
    name: "summarize_page",
    description: "Fetch a page and return a summary",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to summarize",
        },
        sentences: {
          type: "number",
          description: "Number of sentences in summary (default: 3)",
          default: 3,
        },
      },
      required: ["url"],
    },
  },
  {
    name: "fetch_multiple",
    description: "Fetch multiple URLs in parallel",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Array of URLs to fetch",
        },
        max_length: {
          type: "number",
          description: "Maximum characters per page (default: 3000)",
          default: 3000,
        },
      },
      required: ["urls"],
    },
  },
  {
    name: "read_rss",
    description: "Read and parse an RSS/Atom feed",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "RSS/Atom feed URL",
        },
        max_items: {
          type: "number",
          description: "Maximum items to return (default: 10)",
          default: 10,
        },
      },
      required: ["url"],
    },
  },
  {
    name: "youtube_transcript",
    description: "Extract transcript from a YouTube video (requires yt-dlp)",
    inputSchema: {
      type: "object",
      properties: {
        video_id: {
          type: "string",
          description: "YouTube video ID (e.g., 'dQw4w9WgXcQ')",
        },
        url: {
          type: "string",
          description: "Full YouTube URL (alternative to video_id)",
        },
      },
      oneOf: [{ required: ["video_id"] }, { required: ["url"] }],
    },
  },
  {
    name: "extract_metadata",
    description: "Extract OpenGraph metadata, title, description from a URL",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to extract metadata from",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "search_and_summarize",
    description: "Search the web and summarize the top result",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        engine: {
          type: "string",
          description: "Search engine (default: duckduckgo)",
          default: "duckduckgo",
        },
      },
      required: ["query"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const safeArgs = args || {};
  
  try {
    switch (name) {
      case "web_search": {
        const query = safeArgs.query as string;
        const maxResults = (safeArgs.max_results as number) || 10;
        const engine = (safeArgs.engine as string) || "duckduckgo";
        
        let results: SearchResult[] = [];
        
        if (engine === "brave" && process.env.BRAVE_API_KEY) {
          results = await searchBrave(query, process.env.BRAVE_API_KEY, maxResults);
        }
        
        if (results.length === 0) {
          results = await searchDuckDuckGo(query, maxResults);
        }
        
        if (results.length === 0) {
          return {
            content: [{ 
              type: "text", 
              text: `No results found for "${query}". Note: For better results, install ddgr or set BRAVE_API_KEY environment variable.` 
            }],
          };
        }
        
        const lines = [`Search results for "${query}" (${results.length} results):\n`];
        results.forEach((r, i) => {
          lines.push(`${i + 1}. ${r.title}`);
          lines.push(`   URL: ${r.url}`);
          lines.push(`   ${r.snippet}`);
          lines.push(`   Source: ${r.source}\n`);
        });
        
        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      }
      
      case "fetch_page": {
        const url = safeArgs.url as string;
        const raw = (safeArgs.raw as boolean) || false;
        const extractLinks = (safeArgs.extract_links as boolean) || false;
        const maxLength = (safeArgs.max_length as number) || 5000;
        const startIndex = (safeArgs.start_index as number) || 0;
        
        const page = await fetchUrl(url, { raw, extractLinks, timeout: 30 });
        
        let content = page.content.substring(startIndex, startIndex + maxLength);
        const remaining = page.content.length - (startIndex + maxLength);
        
        const lines = [
          `Title: ${page.title}`,
          `URL: ${page.url}`,
          `Word count: ${page.wordCount}`,
        ];
        
        if (page.meta.description) lines.push(`Description: ${page.meta.description}`);
        if (page.meta.author) lines.push(`Author: ${page.meta.author}`);
        if (page.meta.published) lines.push(`Published: ${page.meta.published}`);
        if (page.meta.image) lines.push(`Image: ${page.meta.image}`);
        
        lines.push("", "Content:", "---", content);
        
        if (remaining > 0) {
          lines.push("", `<info>Content truncated. ${remaining} characters remaining. Use start_index=${startIndex + maxLength} to continue.</info>`);
        }
        
        if (extractLinks && page.links.length > 0) {
          lines.push("", `Links found (${page.links.length}):`, ...page.links.slice(0, 20).map(l => `- ${l}`));
        }
        
        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      }
      
      case "summarize_page": {
        const url = safeArgs.url as string;
        const sentences = (safeArgs.sentences as number) || 3;
        
        const page = await fetchUrl(url, { timeout: 30 });
        const summary = summarizeContent(page.content, sentences);
        
        return {
          content: [{
            type: "text",
            text: [
              `Summary of: ${page.title}`,
              `URL: ${url}`,
              "",
              summary,
              "",
              `Original word count: ${page.wordCount}`,
              `Summary length: ${sentences} sentences`,
            ].join("\n"),
          }],
        };
      }
      
      case "fetch_multiple": {
        const urls = safeArgs.urls as string[];
        const maxLength = (safeArgs.max_length as number) || 3000;
        
        const results = await Promise.allSettled(
          urls.map(url => fetchUrl(url, { timeout: 30 }))
        );
        
        const lines = [`Fetched ${urls.length} URLs:\n`];
        
        results.forEach((result, i) => {
          lines.push(`\n--- Page ${i + 1}: ${urls[i]} ---`);
          
          if (result.status === "fulfilled") {
            const page = result.value;
            lines.push(`Title: ${page.title}`);
            lines.push(`Content: ${page.content.substring(0, maxLength)}${page.content.length > maxLength ? "..." : ""}`);
          } else {
            lines.push(`Error: ${result.reason.message}`);
          }
        });
        
        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      }
      
      case "read_rss": {
        const url = safeArgs.url as string;
        const maxItems = (safeArgs.max_items as number) || 10;
        
        const items = await parseRSS(url);
        const limited = items.slice(0, maxItems);
        
        if (limited.length === 0) {
          return {
            content: [{ type: "text", text: `No items found in feed: ${url}` }],
          };
        }
        
        const lines = [`RSS Feed: ${url}`, `${items.length} total items, showing ${limited.length}:\n`];
        
        limited.forEach((item, i) => {
          lines.push(`${i + 1}. ${item.title}`);
          lines.push(`   Link: ${item.link}`);
          if (item.pubDate) lines.push(`   Date: ${item.pubDate}`);
          if (item.description) {
            const desc = item.description.replace(/<[^>]+>/g, "").substring(0, 200);
            lines.push(`   ${desc}...`);
          }
          lines.push("");
        });
        
        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      }
      
      case "youtube_transcript": {
        let videoId = safeArgs.video_id as string | undefined;
        const url = safeArgs.url as string | undefined;
        
        if (!videoId && url) {
          const match = url.match(/(?:v=|\/)([\w-]{11})/);
          videoId = match?.[1];
        }
        
        if (!videoId) {
          return {
            content: [{ type: "text", text: "Error: Could not extract video ID from URL" }],
            isError: true,
          };
        }
        
        try {
          const transcript = await getYouTubeTranscript(videoId);
          return {
            content: [{
              type: "text",
              text: `YouTube Transcript (${videoId}):\n\n${transcript}`,
            }],
          };
        } catch (error) {
          return {
            content: [{ 
              type: "text", 
              text: `Error extracting transcript: ${error instanceof Error ? error.message : String(error)}. Note: Requires yt-dlp to be installed.` 
            }],
            isError: true,
          };
        }
      }
      
      case "extract_metadata": {
        const url = safeArgs.url as string;
        const page = await fetchUrl(url, { timeout: 15 });
        
        return {
          content: [{
            type: "text",
            text: [
              `Metadata for: ${url}`,
              "",
              `Title: ${page.title}`,
              `Description: ${page.meta.description || "N/A"}`,
              `Author: ${page.meta.author || "N/A"}`,
              `Published: ${page.meta.published || "N/A"}`,
              `Image: ${page.meta.image || "N/A"}`,
              `Word Count: ${page.wordCount}`,
            ].join("\n"),
          }],
        };
      }
      
      case "search_and_summarize": {
        const query = safeArgs.query as string;
        const engine = (safeArgs.engine as string) || "duckduckgo";
        
        // Search
        let results: SearchResult[] = [];
        if (engine === "brave" && process.env.BRAVE_API_KEY) {
          results = await searchBrave(query, process.env.BRAVE_API_KEY, 3);
        }
        if (results.length === 0) {
          results = await searchDuckDuckGo(query, 3);
        }
        
        if (results.length === 0) {
          return {
            content: [{ type: "text", text: `No results found for "${query}"` }],
          };
        }
        
        // Fetch and summarize top result
        const topResult = results[0];
        let summary = "";
        
        try {
          const page = await fetchUrl(topResult.url, { timeout: 20 });
          summary = summarizeContent(page.content, 3);
        } catch {
          summary = "Could not fetch page content for summary.";
        }
        
        return {
          content: [{
            type: "text",
            text: [
              `Search & Summarize: "${query}"`,
              "",
              `Top result: ${topResult.title}`,
              `URL: ${topResult.url}`,
              "",
              "Summary:",
              summary,
              "",
              "Other results:",
              ...results.slice(1).map((r, i) => `${i + 2}. ${r.title} - ${r.url}`),
            ].join("\n"),
          }],
        };
      }
      
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [{ 
        type: "text", 
        text: `Error: ${error instanceof Error ? error.message : String(error)}` 
      }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("InternetSearch MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
