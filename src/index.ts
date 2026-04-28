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
const DEFAULT_USER_AGENT_MANUAL = "InternetSearch-MCP/1.0 (User-Specified; +https://github.com/hubinoretros/internetsearch)";

// Configuration
interface Config {
  userAgent: string;
  userAgentManual: string;
  ignoreRobotsTxt: boolean;
  proxyUrl?: string;
  timeout: number;
}

const config: Config = {
  userAgent: process.env.USER_AGENT || DEFAULT_USER_AGENT,
  userAgentManual: process.env.USER_AGENT || DEFAULT_USER_AGENT_MANUAL,
  ignoreRobotsTxt: process.env.IGNORE_ROBOTS_TXT === "true",
  proxyUrl: process.env.PROXY_URL,
  timeout: parseInt(process.env.TIMEOUT || "30", 10),
};

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

// Robots.txt checker - respects website crawling policies
async function checkRobotsTxt(url: string, userAgent: string): Promise<{ allowed: boolean; message?: string }> {
  if (config.ignoreRobotsTxt) {
    return { allowed: true };
  }
  
  try {
    const parsed = new URL(url);
    const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(robotsUrl, {
      headers: { "User-Agent": userAgent },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.status === 404) {
      return { allowed: true }; // No robots.txt = allowed
    }
    
    if (!response.ok) {
      return { allowed: true, message: `Could not check robots.txt (HTTP ${response.status})` };
    }
    
    const robotsTxt = await response.text();
    const userAgentPattern = new RegExp(`User-agent:\s*([^\\n]+)\\n`, "gi");
    const disallowPattern = /Disallow:\s*(.+)/gi;
    
    let isAllowed = true;
    let currentUserAgent = "*";
    
    const lines = robotsTxt.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.toLowerCase().startsWith("user-agent:")) {
        currentUserAgent = trimmed.split(":")[1]?.trim() || "*";
      } else if (trimmed.toLowerCase().startsWith("disallow:")) {
        const path = trimmed.split(":")[1]?.trim();
        if (path && (currentUserAgent === "*" || userAgent.includes(currentUserAgent))) {
          const urlPath = parsed.pathname + parsed.search;
          if (urlPath.startsWith(path)) {
            isAllowed = false;
          }
        }
      }
    }
    
    if (!isAllowed) {
      return {
        allowed: false,
        message: `Fetching blocked by robots.txt. Path "${parsed.pathname}" is disallowed. Set IGNORE_ROBOTS_TXT=true to override (use responsibly).`
      };
    }
    
    return { allowed: true };
  } catch (error) {
    // If we can't check robots.txt, allow but warn
    return { allowed: true, message: `Could not verify robots.txt: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
}

// Search engines - improved with HTML scraping fallback
async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  
  // Try 1: Use ddgr if available
  try {
    const ddgr = spawn("ddgr", ["--json", "-n", maxResults.toString(), query]);
    
    let output = "";
    ddgr.stdout.on("data", (data) => { output += data; });
    
    await new Promise((resolve, reject) => {
      ddgr.on("close", (code) => {
        if (code === 0 || output.length > 0) resolve(null);
        else reject(new Error("ddgr failed"));
      });
      ddgr.on("error", () => reject(new Error("ddgr not installed")));
      setTimeout(() => { ddgr.kill(); reject(new Error("ddgr timeout")); }, 10000);
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
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
    
    if (results.length > 0) return results;
  } catch (ddgrError) {
    // ddgr not available or failed, try HTML scraping
  }
  
  // Try 2: HTML scraping from DuckDuckGo Lite (no JS required)
  try {
    const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Parse DuckDuckGo Lite results
    $("table.result").each((i, el) => {
      if (i >= maxResults) return false;
      
      const $el = $(el);
      const titleLink = $el.find("a.result-link").first();
      const title = titleLink.text().trim();
      const url = titleLink.attr("href");
      const snippet = $el.find("td.result-snippet").text().trim();
      
      if (title && url) {
        results.push({
          title,
          url: url.startsWith("http") ? url : `https:${url}`,
          snippet: snippet || "No description available",
          source: "DuckDuckGo Lite"
        });
      }
    });
    
    if (results.length > 0) return results;
  } catch (htmlError) {
    // HTML scraping failed
  }
  
  // If both methods failed, return empty with helpful message
  if (results.length === 0) {
    console.error("Note: For DuckDuckGo search, install ddgr (pip install ddgr) or use BRAVE_API_KEY");
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

// Content extraction with robots.txt respect and proxy support
async function fetchUrl(
  url: string, 
  options: {
    raw?: boolean;
    timeout?: number;
    extractLinks?: boolean;
    checkRobots?: boolean;
    isManualFetch?: boolean;
  } = {}
): Promise<PageContent> {
  // Check robots.txt unless disabled or it's a manual fetch
  if (options.checkRobots !== false && !options.isManualFetch) {
    const robotsCheck = await checkRobotsTxt(url, config.userAgent);
    if (!robotsCheck.allowed) {
      throw new Error(robotsCheck.message || "Fetching blocked by robots.txt");
    }
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), (options.timeout || config.timeout) * 1000);
  
  // Use appropriate user agent
  const userAgent = options.isManualFetch ? config.userAgentManual : config.userAgent;
  
  try {
    // Support proxy if configured
    const fetchOptions: RequestInit = {
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "DNT": "1",
        "Connection": "keep-alive",
      },
      signal: controller.signal,
    };
    
    // Note: Node.js 18+ native fetch doesn't support proxy directly
    // For proxy support, users should use global-agent or similar
    const response = await fetch(url, fetchOptions);
    
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

// YouTube transcript extraction using yt-dlp
async function getYouTubeTranscript(videoId: string): Promise<string> {
  // Check if yt-dlp is available first
  const checkYtdlp = spawn("which", ["yt-dlp"]);
  let ytdlpAvailable = false;
  
  await new Promise((resolve) => {
    checkYtdlp.on("close", (code) => {
      ytdlpAvailable = code === 0;
      resolve(null);
    });
    checkYtdlp.on("error", () => resolve(null));
    setTimeout(() => resolve(null), 2000);
  });
  
  if (!ytdlpAvailable) {
    throw new Error(
      "yt-dlp is not installed.\n\n" +
      "To extract YouTube transcripts, install yt-dlp:\n" +
      "  pip install yt-dlp\n\n" +
      "Or download from: https://github.com/yt-dlp/yt-dlp\n\n" +
      "Note: YouTube transcript extraction requires external tools due to YouTube's restrictions."
    );
  }
  
  return new Promise((resolve, reject) => {
    // Try multiple methods for transcript extraction
    const methods = [
      // Method 1: Get automatic captions
      ["yt-dlp", "--skip-download", "--write-auto-sub", "--sub-langs", "en", "--output", "-", `https://youtube.com/watch?v=${videoId}`],
      // Method 2: Get manual subtitles
      ["yt-dlp", "--skip-download", "--write-sub", "--sub-langs", "en", "--output", "-", `https://youtube.com/watch?v=${videoId}`],
    ];
    
    let methodIndex = 0;
    
    function tryNextMethod() {
      if (methodIndex >= methods.length) {
        reject(new Error(
          "Could not extract transcript. Possible reasons:\n" +
          "  - Video has no captions/subtitles\n" +
          "  - Video is age-restricted or private\n" +
          "  - yt-dlp version is outdated (try: pip install -U yt-dlp)\n\n" +
          "You can try manually fetching the video page with fetch_page tool."
        ));
        return;
      }
      
      const args = methods[methodIndex];
      methodIndex++;
      
      const ytdlp = spawn(args[0], args.slice(1));
      let output = "";
      let errorOutput = "";
      
      ytdlp.stdout.on("data", (data) => { output += data.toString(); });
      ytdlp.stderr.on("data", (data) => { errorOutput += data.toString(); });
      
      ytdlp.on("close", (code) => {
        if (code === 0 && output.length > 100) {
          // Clean up the output (remove timing info, format as plain text)
          const cleaned = output
            .replace(/\[.*?\]/g, "") // Remove [00:00:00.000] style timestamps
            .replace(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g, "") // Remove WEBVTT timestamps
            .replace(/WEBVTT/g, "")
            .replace(/NOTE.*\n/g, "")
            .replace(/\n\s*\n/g, "\n") // Remove empty lines
            .trim();
          resolve(cleaned);
        } else {
          tryNextMethod();
        }
      });
      
      ytdlp.on("error", () => tryNextMethod());
      
      setTimeout(() => {
        ytdlp.kill();
        tryNextMethod();
      }, 20000);
    }
    
    tryNextMethod();
  });
}

// Improved content summarization using TF-IDF-like scoring
function summarizeContent(text: string, maxSentences: number = 3): string {
  if (!text || text.length < 200) return text; // Too short to summarize
  
  // Split into sentences (improved regex to handle abbreviations better)
  const sentences: string[] = text
    .replace(/([.!?])\s+(?=[A-Z])/g, "$1\n")
    .split("\n")
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.length < 500); // Filter too short/long
  
  if (sentences.length <= maxSentences) return text;
  
  // Build word frequency (TF-like)
  const wordFreq: Map<string, number> = new Map();
  const stopWords = new Set(["the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "its", "may", "new", "now", "old", "see", "two", "who", "boy", "did", "she", "use", "her", "way", "many", "oil", "sit", "set", "run", "eat", "far", "sea", "eye", "ask", "own", "say", "too", "any", "try", "let", "put", "say", "she", "try", "way", "own", "say", "too", "old", "tell", "very", "when", "come", "there", "each", "which", "their", "time", "will", "about", "if", "up", "out", "many", "then", "them", "these", "so", "some", "what", "would", "make", "like", "into", "him", "has", "two", "more", "go", "no", "way", "could", "my", "than", "first", "been", "call", "who", "its", "now", "find", "long", "down", "day", "did", "get", "come", "made", "may", "part"]);
  
  // Calculate document frequency (how many sentences contain each word)
  const docFreq: Map<string, number> = new Map();
  
  sentences.forEach(sentence => {
    const words = sentence.toLowerCase().match(/\b[a-z]+\b/g) || [];
    const uniqueWords = new Set(words);
    uniqueWords.forEach(word => {
      if (!stopWords.has(word) && word.length > 3) {
        docFreq.set(word, (docFreq.get(word) || 0) + 1);
      }
    });
  });
  
  // Score sentences using TF-IDF-like weighting
  const scored = sentences.map((sentence, index) => {
    const words = sentence.toLowerCase().match(/\b[a-z]+\b/g) || [];
    const wordCount = new Map<string, number>();
    
    words.forEach(word => {
      if (!stopWords.has(word) && word.length > 3) {
        wordCount.set(word, (wordCount.get(word) || 0) + 1);
      }
    });
    
    // Calculate TF-IDF score
    let score = 0;
    let wordCountTotal = 0;
    
    wordCount.forEach((count, word) => {
      const tf = count / words.length;
      const idf = Math.log(sentences.length / (docFreq.get(word) || 1));
      score += tf * idf;
      wordCountTotal += count;
    });
    
    // Bonus for first and last sentences (often contain key info)
    if (index === 0) score *= 1.5;
    if (index === sentences.length - 1) score *= 1.3;
    
    return { 
      sentence: sentence.trim(), 
      score, 
      originalIndex: index,
      wordCount: wordCountTotal
    };
  });
  
  // Filter out sentences with too few content words
  const filtered = scored.filter(s => s.wordCount >= 3);
  if (filtered.length === 0) return text.substring(0, 500) + "...";
  
  // Sort by score and pick top N
  filtered.sort((a, b) => b.score - a.score);
  const topSentences = filtered.slice(0, maxSentences);
  
  // Sort back by original position for coherent reading
  topSentences.sort((a, b) => a.originalIndex - b.originalIndex);
  
  return topSentences.map(s => s.sentence).join(" ");
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
