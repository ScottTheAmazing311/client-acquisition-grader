import * as cheerio from 'cheerio';
import { crawlSite, type CrawlResult } from './cloudflare-crawl';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════
export interface CheckResult {
  name: string;
  category: string;
  passed: boolean;
  score: number;
  maxPoints: number;
  detail: string;
  headline: string; // Short teaser-friendly finding
}

export interface CategoryScore {
  name: string;
  score: number;
  maxPoints: number;
  percentage: number;
  grade: string;
  checks: CheckResult[];
}

export interface ScanResult {
  url: string;
  domain: string;
  firmName: string;
  overallScore: number;
  grade: string;
  gradeLabel: string;
  categories: {
    digitalPresence: CategoryScore;
    reputation: CategoryScore;
    conversionReadiness: CategoryScore;
    speedToLead: CategoryScore;
  };
  totalChecks: number;
  passedChecks: number;
  scanDurationMs: number;
  headlineFindings: string[];
  errors: string[];
  crawlEnhanced: boolean;
  crawlPagesUsed: number;
}

interface FetchedResource {
  content: string | null;
  status: number | null;
  headers: Record<string, string>;
  error: string | null;
  loadTimeMs: number;
}

interface ParsedPage {
  url: string;
  html: string;
  $: cheerio.CheerioAPI;
  title: string;
  metaDescription: string;
  bodyText: string;
  headings: { tag: string; text: string }[];
  navLinks: { text: string; href: string }[];
  jsonLd: any[];
  hasViewport: boolean;
  htmlSize: number;
  forms: { action: string; aboveFold: boolean }[];
  phoneNumbers: string[];
  hasTelLink: boolean;
  chatWidgets: string[];
  hasSSL: boolean;
  hasHreflang: boolean;
  hasSpanishPath: boolean;
  contactPhone: string | null;
  contactAddress: string | null;
  hasCaseResults: boolean;
  hasAttorneyProfiles: boolean;
  reviewCount: number | null;
  reviewRating: number | null;
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_RESPONSE_BYTES = 1_500_000;

// ═══════════════════════════════════════════════════════════
// FETCH HELPERS
// ═══════════════════════════════════════════════════════════
async function fetchResource(url: string, timeoutMs = 10000): Promise<FetchedResource> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });

    const reader = response.body?.getReader();
    if (!reader) return { content: null, status: response.status, headers, error: 'No body', loadTimeMs: Date.now() - start };

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        chunks.push(value.slice(0, MAX_RESPONSE_BYTES - (totalBytes - value.byteLength)));
        reader.cancel();
        break;
      }
      chunks.push(value);
    }

    const decoder = new TextDecoder('utf-8', { fatal: false });
    return { content: decoder.decode(Buffer.concat(chunks)), status: response.status, headers, error: null, loadTimeMs: Date.now() - start };
  } catch (err: any) {
    return { content: null, status: null, headers: {}, error: err.message, loadTimeMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════
// PARSE PAGE
// ═══════════════════════════════════════════════════════════
function parsePage(html: string, url: string, isSSL: boolean): ParsedPage {
  const $ = cheerio.load(html);
  const htmlSize = html.length;
  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';

  const headings: { tag: string; text: string }[] = [];
  $('h1, h2, h3').each((i, el) => {
    if (headings.length >= 30) return false;
    const tag = (el as any).tagName?.toLowerCase() || '';
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text) headings.push({ tag, text });
  });

  // JSON-LD
  const jsonLd: any[] = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const raw = $(el).html();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) jsonLd.push(...parsed);
        else jsonLd.push(parsed);
      }
    } catch { /* skip */ }
  });

  // Nav links
  const navLinks: { text: string; href: string }[] = [];
  $('a[href]').each((i, el) => {
    if (navLinks.length >= 50) return false;
    const href = $(el).attr('href');
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (!href || !text) return;
    try {
      const resolved = new URL(href, url).toString();
      navLinks.push({ text, href: resolved });
    } catch { /* skip */ }
  });

  // Body text
  const $body = cheerio.load(html);
  $body('script, style, nav, footer, header, noscript, iframe, svg').remove();
  const bodyText = $body('body').text().replace(/\s+/g, ' ').trim();

  // Forms
  const forms: { action: string; aboveFold: boolean }[] = [];
  $('form').each((i, el) => {
    const action = $(el).attr('action') || '';
    // Heuristic: first form is likely above the fold
    forms.push({ action, aboveFold: i === 0 });
  });

  // Phone numbers
  const phoneRegex = /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const phoneMatches = html.match(phoneRegex) || [];
  const phoneNumbers = [...new Set(phoneMatches)];

  // tel: links
  const hasTelLink = $('a[href^="tel:"]').length > 0;

  // Chat widgets
  const chatWidgets: string[] = [];
  const chatPatterns: [RegExp, string][] = [
    [/ngage/i, 'Ngage'],
    [/smith\.ai/i, 'Smith.ai'],
    [/drift\.com|drift-frame/i, 'Drift'],
    [/intercom/i, 'Intercom'],
    [/livechat/i, 'LiveChat'],
    [/tawk\.to/i, 'Tawk.to'],
    [/zendesk/i, 'Zendesk Chat'],
    [/crisp\.chat/i, 'Crisp'],
    [/hubspot.*chat|HubSpotConversations/i, 'HubSpot Chat'],
    [/olark/i, 'Olark'],
    [/freshchat|freshdesk/i, 'Freshchat'],
    [/podium/i, 'Podium'],
    [/birdeye/i, 'Birdeye'],
    [/intaker/i, 'Intaker'],
    [/apexchat/i, 'ApexChat'],
    [/callrail/i, 'CallRail Chat'],
    [/leadferno/i, 'LeadFerno'],
    [/ruby\.com|ruby\s*receptionist/i, 'Ruby'],
    [/chat-widget|chatwidget|live-chat|livechat-widget/i, 'Chat Widget'],
  ];
  for (const [pattern, name] of chatPatterns) {
    if (pattern.test(html)) chatWidgets.push(name);
  }

  // Viewport
  const hasViewport = !!$('meta[name="viewport"][content*="width"]').attr('content');

  // SSL
  const hasSSL = isSSL;

  // Hreflang / Spanish
  const hasHreflang = $('link[hreflang]').length > 0;
  const hasSpanishPath = /\/es\/|\/espanol|hreflang="es"/i.test(html);

  // Contact info
  const contactPhone = phoneNumbers.length > 0 ? phoneNumbers[0] : null;
  const addressRegex = /\d+\s+[\w\s]+(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|court|ct|suite|ste|floor|fl)[\s.,]+[\w\s]+,?\s*[A-Z]{2}\s*\d{5}/i;
  const addressMatch = bodyText.match(addressRegex);
  const contactAddress = addressMatch ? addressMatch[0] : null;

  // Case results
  const caseResultPatterns = /(?:verdict|settlement|result|recover|won|million|billion)\s*(?:s|ed|ing)?/i;
  const dollarPattern = /\$[\d,]+(?:\.\d+)?\s*(?:million|billion|M|B)?/i;
  const hasCaseResults = caseResultPatterns.test(bodyText) && dollarPattern.test(bodyText);

  // Attorney profiles
  const hasAttorneyProfiles = navLinks.some(l =>
    /attorney|lawyer|team|about|people|staff|professionals/i.test(l.href + ' ' + l.text)
  );

  // Reviews from schema — search recursively for aggregateRating in any nested object
  let reviewCount: number | null = null;
  let reviewRating: number | null = null;
  function findAggregateRating(obj: any): any {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.aggregateRating || obj.AggregateRating) return obj.aggregateRating || obj.AggregateRating;
    for (const key of Object.keys(obj)) {
      const found = findAggregateRating(obj[key]);
      if (found) return found;
    }
    return null;
  }
  for (const item of jsonLd) {
    const rating = findAggregateRating(item);
    if (rating) {
      reviewCount = parseInt(rating.reviewCount || rating.ratingCount) || null;
      reviewRating = parseFloat(rating.ratingValue) || null;
      break;
    }
  }

  return {
    url, html, $, title, metaDescription, bodyText, headings, navLinks, jsonLd,
    hasViewport, htmlSize, forms, phoneNumbers, hasTelLink, chatWidgets,
    hasSSL, hasHreflang, hasSpanishPath, contactPhone, contactAddress,
    hasCaseResults, hasAttorneyProfiles, reviewCount, reviewRating,
  };
}

// ═══════════════════════════════════════════════════════════
// SUBPAGE DISCOVERY
// ═══════════════════════════════════════════════════════════
function discoverSubpages(homepage: ParsedPage, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const candidates: { url: string; priority: number }[] = [];
  const seen = new Set<string>();
  const keywords = ['about', 'team', 'attorney', 'lawyer', 'practice', 'result', 'verdict', 'review', 'testimonial', 'contact'];

  for (const link of homepage.navLinks) {
    try {
      const linkUrl = new URL(link.href);
      if (linkUrl.hostname !== base.hostname) continue;
      if (linkUrl.pathname === '/' || linkUrl.pathname === '') continue;
      if (linkUrl.pathname.match(/\.(pdf|jpg|png|gif|svg|css|js|zip)$/i)) continue;

      const normalized = linkUrl.origin + linkUrl.pathname.replace(/\/$/, '');
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const pathAndText = (linkUrl.pathname + ' ' + link.text).toLowerCase();
      let priority = 0;
      for (const k of keywords) {
        if (pathAndText.includes(k)) priority++;
      }
      if (priority > 0) candidates.push({ url: normalized, priority });
    } catch { /* skip */ }
  }

  // Also add common subpage paths as fallbacks
  const fallbackPaths = ['/about', '/about-us', '/results', '/case-results', '/testimonials', '/reviews', '/attorneys', '/team', '/our-team', '/contact'];
  for (const path of fallbackPaths) {
    const fallbackUrl = base.origin + path;
    if (!seen.has(fallbackUrl)) {
      candidates.push({ url: fallbackUrl, priority: 0 });
      seen.add(fallbackUrl);
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.slice(0, 5).map(c => c.url);
}

// ═══════════════════════════════════════════════════════════
// DIRECTORY CHECKS
// ═══════════════════════════════════════════════════════════
async function checkDirectories(domain: string): Promise<{ found: string[]; total: number }> {
  const directories = [
    { name: 'Avvo', urlPattern: `https://www.avvo.com/search?q=${encodeURIComponent(domain)}` },
    { name: 'Justia', urlPattern: `https://www.justia.com/search?q=${encodeURIComponent(domain)}` },
    { name: 'FindLaw', urlPattern: `https://www.findlaw.com/search?q=${encodeURIComponent(domain)}` },
    { name: 'Lawyers.com', urlPattern: `https://www.lawyers.com/search?q=${encodeURIComponent(domain)}` },
    { name: 'Super Lawyers', urlPattern: `https://www.superlawyers.com/search?q=${encodeURIComponent(domain)}` },
    { name: 'Martindale', urlPattern: `https://www.martindale.com/search?q=${encodeURIComponent(domain)}` },
  ];

  // We can't actually search these directories without proper APIs,
  // so we'll check if the firm has links TO these directories from their site
  return { found: [], total: directories.length };
}

function checkDirectoryLinks(pages: ParsedPage[]): { found: string[]; total: number } {
  const dirPatterns: [RegExp, string][] = [
    [/avvo\.com/i, 'Avvo'],
    [/justia\.com/i, 'Justia'],
    [/findlaw\.com/i, 'FindLaw'],
    [/lawyers\.com/i, 'Lawyers.com'],
    [/superlawyers\.com/i, 'Super Lawyers'],
    [/martindale\.com/i, 'Martindale-Hubbell'],
    [/bestlawyers\.com/i, 'Best Lawyers'],
    [/nolo\.com/i, 'Nolo'],
    [/yelp\.com/i, 'Yelp'],
    [/bbb\.org/i, 'BBB'],
    [/national trial lawyers|thenationaltriallawyers\.org/i, 'National Trial Lawyers'],
  ];

  const found: string[] = [];
  const allLinks = pages.flatMap(p => p.navLinks.map(l => l.href));
  const allHtml = pages.map(p => p.html).join(' ');

  for (const [pattern, name] of dirPatterns) {
    if (allLinks.some(l => pattern.test(l)) || pattern.test(allHtml)) {
      found.push(name);
    }
  }

  return { found, total: dirPatterns.length };
}

// ═══════════════════════════════════════════════════════════
// GRADE HELPERS
// ═══════════════════════════════════════════════════════════
function gradeFromScore(score: number): { grade: string; label: string } {
  if (score >= 85) return { grade: 'A+', label: 'Elite Acquisition Machine' };
  if (score >= 75) return { grade: 'A', label: 'Strong Pipeline' };
  if (score >= 65) return { grade: 'B+', label: 'Above Average' };
  if (score >= 55) return { grade: 'B', label: 'Room to Grow' };
  if (score >= 45) return { grade: 'C+', label: 'Needs Improvement' };
  if (score >= 35) return { grade: 'C', label: 'Significant Gaps' };
  return { grade: 'D', label: 'Leaking Cases' };
}

function categoryGrade(pct: number): string {
  if (pct >= 80) return 'A';
  if (pct >= 65) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 35) return 'D';
  return 'F';
}

function extractFirmName(page: ParsedPage): string {
  // Try JSON-LD
  for (const item of page.jsonLd) {
    if (item?.name && typeof item.name === 'string') return item.name;
  }
  // Try title tag — strip common suffixes
  if (page.title) {
    return page.title
      .replace(/\s*[-|–—]\s*(home|welcome|attorney|lawyer|law\s*firm|personal\s*injury).*/i, '')
      .replace(/\s*[-|–—]\s*.*$/i, '')
      .trim() || page.title;
  }
  return new URL(page.url).hostname;
}

// ═══════════════════════════════════════════════════════════
// CHECK FUNCTIONS — CATEGORY A: DIGITAL PRESENCE (35 pts)
// ═══════════════════════════════════════════════════════════

function checkWebsiteLoads(res: FetchedResource): CheckResult {
  const maxPoints = 5;
  if (res.status === 200 && res.content) {
    const fast = res.loadTimeMs < 3000;
    return {
      name: 'Website Loads', category: 'digitalPresence', passed: true,
      score: fast ? maxPoints : maxPoints - 1, maxPoints,
      detail: `Site loads in ${(res.loadTimeMs / 1000).toFixed(1)}s${fast ? '' : ' — consider optimizing for faster load times'}.`,
      headline: `Site loads in ${(res.loadTimeMs / 1000).toFixed(1)}s`
    };
  }
  return {
    name: 'Website Loads', category: 'digitalPresence', passed: false,
    score: 0, maxPoints,
    detail: 'Website failed to load. Potential clients — and AI systems — can\'t reach you.',
    headline: 'Website is unreachable'
  };
}

function checkGBPSignals(pages: ParsedPage[]): CheckResult {
  const maxPoints = 8;
  const allJsonLd = pages.flatMap(p => p.jsonLd);
  const hasLocalBusiness = allJsonLd.some(item => {
    const type = item?.['@type'];
    return ['LocalBusiness', 'LegalService', 'Attorney', 'LawFirm', 'ProfessionalService'].includes(type);
  });

  const allText = pages.map(p => p.bodyText + ' ' + p.html).join(' ');
  const hasGoogleLink = /google\.com\/maps|goo\.gl\/maps|g\.page/i.test(allText);
  const hasAddress = pages.some(p => p.contactAddress);

  const signals = [hasLocalBusiness, hasGoogleLink, hasAddress].filter(Boolean).length;

  if (signals >= 2) {
    return {
      name: 'Google Business Signals', category: 'digitalPresence', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Strong local business signals found — Google Maps link, structured data, and/or address present.',
      headline: 'Local business signals detected'
    };
  }
  if (signals === 1) {
    return {
      name: 'Google Business Signals', category: 'digitalPresence', passed: false,
      score: 4, maxPoints,
      detail: 'Some local business signals found but incomplete. A fully optimized Google Business Profile is critical for local search.',
      headline: 'Partial local business signals'
    };
  }
  return {
    name: 'Google Business Signals', category: 'digitalPresence', passed: false,
    score: 0, maxPoints,
    detail: 'No Google Business Profile signals found on your site. This is the #1 way potential clients find local law firms.',
    headline: 'No Google Business signals detected'
  };
}

function checkSEOBasics(page: ParsedPage, robotsRes: FetchedResource, sitemapRes: FetchedResource): CheckResult {
  const maxPoints = 8;
  let score = 0;

  const hasMeta = page.metaDescription.length > 50;
  const hasH1 = page.headings.some(h => h.tag === 'h1');
  const hasTitle = page.title.length > 10;
  const hasSitemap = sitemapRes.status === 200 && sitemapRes.content?.includes('<url>');
  const hasRobots = robotsRes.status === 200;

  if (hasMeta) score += 2;
  if (hasH1) score += 2;
  if (hasTitle) score += 1;
  if (hasSitemap) score += 2;
  if (hasRobots) score += 1;

  const passed = score >= 6;
  const missing = [!hasMeta && 'meta description', !hasH1 && 'h1 tag', !hasSitemap && 'sitemap', !hasRobots && 'robots.txt'].filter(Boolean);

  return {
    name: 'SEO Foundations', category: 'digitalPresence', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? 'Core SEO elements are in place — title, meta description, heading structure, and sitemap.'
      : `Missing key SEO elements: ${missing.join(', ')}. This limits how well search engines rank your site.`,
    headline: passed ? 'SEO foundations solid' : `Missing: ${missing.join(', ')}`
  };
}

function checkAIReadiness(page: ParsedPage, robotsRes: FetchedResource, llmsRes: FetchedResource): CheckResult {
  const maxPoints = 7;
  let score = 0;

  // Check robots.txt for AI blocks
  let aiBlocked = false;
  if (robotsRes.content) {
    const content = robotsRes.content.toLowerCase();
    const aiAgents = ['gptbot', 'claudebot', 'perplexitybot'];
    for (const agent of aiAgents) {
      const section = content.match(new RegExp(`user-agent:\\s*${agent}[\\s\\S]*?(?=user-agent:|$)`, 'i'));
      if (section && section[0].includes('disallow: /')) aiBlocked = true;
    }
  }
  if (!aiBlocked) score += 2;

  // Schema
  const hasLegalSchema = page.jsonLd.some(item => {
    const type = item?.['@type'];
    return ['Attorney', 'LegalService', 'LocalBusiness', 'LawFirm'].includes(type);
  });
  if (hasLegalSchema) score += 2;

  // llms.txt
  const hasLlms = llmsRes.status === 200 && llmsRes.content && llmsRes.content.trim().length > 10;
  if (hasLlms) score += 2;

  // Meta description for AI
  if (page.metaDescription.length > 50) score += 1;

  const passed = score >= 5;

  return {
    name: 'AI Visibility', category: 'digitalPresence', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `AI readiness score: ${score}/${maxPoints}. AI systems can find and understand your firm.`
      : `AI readiness score: ${score}/${maxPoints}. ${aiBlocked ? 'AI crawlers are blocked. ' : ''}${!hasLegalSchema ? 'No legal schema found. ' : ''}${!hasLlms ? 'No llms.txt. ' : ''}AI may not recommend your firm.`,
    headline: `AI Readiness: ${Math.round((score / maxPoints) * 100)}/100`
  };
}

function checkDirectoryPresence(pages: ParsedPage[]): CheckResult {
  const maxPoints = 7;
  const dirs = checkDirectoryLinks(pages);

  if (dirs.found.length >= 3) {
    return {
      name: 'Directory Presence', category: 'digitalPresence', passed: true,
      score: maxPoints, maxPoints,
      detail: `Found on ${dirs.found.length} of ${dirs.total} major legal directories: ${dirs.found.join(', ')}.`,
      headline: `Found on ${dirs.found.length}/${dirs.total} directories`
    };
  }
  if (dirs.found.length >= 2) {
    return {
      name: 'Directory Presence', category: 'digitalPresence', passed: false,
      score: 4, maxPoints,
      detail: `Found on ${dirs.found.length} of ${dirs.total} major directories: ${dirs.found.join(', ')}. Expand your presence for more referral traffic.`,
      headline: `Found on ${dirs.found.length}/${dirs.total} directories`
    };
  }
  if (dirs.found.length === 1) {
    return {
      name: 'Directory Presence', category: 'digitalPresence', passed: false,
      score: 2, maxPoints,
      detail: `Only found on ${dirs.found[0]}. Most top PI firms are listed on 4+ legal directories.`,
      headline: `Only on ${dirs.found.length} directory`
    };
  }
  return {
    name: 'Directory Presence', category: 'digitalPresence', passed: false,
    score: 2, maxPoints,
    detail: 'No links to major legal directories found on your site. Most established firms are listed on Avvo, Justia, FindLaw, and Super Lawyers — linking to them builds credibility.',
    headline: 'No directory links on site'
  };
}

// ═══════════════════════════════════════════════════════════
// CATEGORY B: REPUTATION & TRUST (30 pts)
// ═══════════════════════════════════════════════════════════

function checkReviewSignals(pages: ParsedPage[]): CheckResult {
  const maxPoints = 12;
  let reviewCount: number | null = null;
  let reviewRating: number | null = null;

  for (const page of pages) {
    if (page.reviewCount) reviewCount = page.reviewCount;
    if (page.reviewRating) reviewRating = page.reviewRating;
  }

  // Also check body text for review mentions
  const allText = pages.map(p => p.bodyText).join(' ');
  const reviewMention = allText.match(/(\d+)\+?\s*(?:reviews?|testimonials?|client\s*reviews?|satisfied\s*clients?)/i);
  if (!reviewCount && reviewMention) {
    reviewCount = parseInt(reviewMention[1]);
  }

  const ratingMention = allText.match(/(\d+\.?\d*)\s*(?:star|rating|out\s*of\s*5)/i);
  if (!reviewRating && ratingMention) {
    reviewRating = parseFloat(ratingMention[1]);
  }

  // Additional trust signal patterns
  const starRatedPattern = /(?:5|five)\s*-?\s*star\s*rated/i;
  const satisfiedPattern = /(\d[\d,]*)\+?\s*satisfied\s*clients?/i;
  const winRatePattern = /\d{2,3}\s*%\s*(?:win|success|recovery)\s*rate/i;
  if (!reviewRating && starRatedPattern.test(allText)) {
    reviewRating = 5.0;
  }
  if (!reviewCount && satisfiedPattern.test(allText)) {
    const match = allText.match(satisfiedPattern);
    if (match) reviewCount = parseInt(match[1].replace(/,/g, ''));
  }
  // Win/success rate counts as a trust signal — treat as partial review evidence
  if (!reviewCount && !reviewRating && winRatePattern.test(allText)) {
    reviewCount = 1; // Minimum signal so the check doesn't score 0
  }

  if (reviewCount && reviewCount >= 100 && reviewRating && reviewRating >= 4.5) {
    return {
      name: 'Review Signals', category: 'reputation', passed: true,
      score: maxPoints, maxPoints,
      detail: `${reviewCount} reviews at ${reviewRating} stars — strong social proof. Top PI firms average 180+ reviews.`,
      headline: `${reviewCount} reviews at ${reviewRating} stars`
    };
  }
  if (reviewCount && reviewCount >= 20) {
    const score = reviewRating && reviewRating >= 4.0 ? 7 : 5;
    return {
      name: 'Review Signals', category: 'reputation', passed: false,
      score, maxPoints,
      detail: `${reviewCount} reviews found${reviewRating ? ` at ${reviewRating} stars` : ''}. Good start, but top PI firms in your market likely have 100+.`,
      headline: `${reviewCount} reviews${reviewRating ? ` at ${reviewRating}★` : ''}`
    };
  }
  if (reviewCount) {
    return {
      name: 'Review Signals', category: 'reputation', passed: false,
      score: 3, maxPoints,
      detail: `Only ${reviewCount} reviews found. A review generation campaign should be a top priority.`,
      headline: `Only ${reviewCount} reviews`
    };
  }
  return {
    name: 'Review Signals', category: 'reputation', passed: false,
    score: 0, maxPoints,
    detail: 'No review data detected on your site. Reviews are the #1 trust signal for potential clients choosing a law firm.',
    headline: 'No review signals found'
  };
}

function checkCaseResultsPage(pages: ParsedPage[]): CheckResult {
  const maxPoints = 8;
  const hasCaseResults = pages.some(p => p.hasCaseResults);
  const hasCaseResultsPage = pages.some(p =>
    /result|verdict|settlement|recover/i.test(p.url)
  );

  if (hasCaseResults && hasCaseResultsPage) {
    return {
      name: 'Case Results', category: 'reputation', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Case results page with dollar amounts found. This is powerful social proof that builds confidence.',
      headline: 'Case results page found'
    };
  }
  if (hasCaseResults) {
    return {
      name: 'Case Results', category: 'reputation', passed: true,
      score: maxPoints - 2, maxPoints,
      detail: 'Case results mentioned on the site. Consider creating a dedicated results page for maximum impact.',
      headline: 'Case results mentioned'
    };
  }
  return {
    name: 'Case Results', category: 'reputation', passed: false,
    score: 0, maxPoints,
    detail: 'No case results found. Verdicts and settlements are some of the most persuasive content you can show potential clients.',
    headline: 'No case results displayed'
  };
}

function checkAttorneyProfilesRep(pages: ParsedPage[]): CheckResult {
  const maxPoints = 7;
  const hasProfiles = pages.some(p => p.hasAttorneyProfiles);
  const allText = pages.map(p => p.bodyText).join(' ');
  const hasCredentials = /(?:j\.d\.|esq|board\s*certified|super\s*lawyer|million\s*dollar\s*advocate|avvo\s*rating)/i.test(allText);

  if (hasProfiles && hasCredentials) {
    return {
      name: 'Attorney Profiles', category: 'reputation', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Attorney pages with credentials and accolades found. Clients want to know who will handle their case.',
      headline: 'Attorney profiles with credentials'
    };
  }
  if (hasProfiles) {
    return {
      name: 'Attorney Profiles', category: 'reputation', passed: false,
      score: 4, maxPoints,
      detail: 'Attorney page detected but lacking prominent credentials. Add awards, certifications, and case experience.',
      headline: 'Attorney page found, needs credentials'
    };
  }
  return {
    name: 'Attorney Profiles', category: 'reputation', passed: false,
    score: 0, maxPoints,
    detail: 'No attorney profile pages found. Clients won\'t hire a firm when they can\'t learn about the lawyers.',
    headline: 'No attorney profiles found'
  };
}

function checkTestimonialContent(pages: ParsedPage[]): CheckResult {
  const maxPoints = 5;
  const allText = pages.map(p => p.bodyText).join(' ');
  const hasTestimonials = /(?:testimonial|client\s*said|client\s*review|what\s*(?:our|my)\s*clients|(?:he|she|they)\s*(?:helped|saved|fought|won))/i.test(allText);
  const hasVideoTestimonial = /(?:video\s*testimonial|watch\s*(?:our|my)\s*client|youtube\.com|vimeo\.com)/i.test(pages.map(p => p.html).join(' '));

  if (hasTestimonials && hasVideoTestimonial) {
    return {
      name: 'Testimonial Content', category: 'reputation', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Client testimonials and video content found. Video testimonials convert 2x better than text alone.',
      headline: 'Video testimonials detected'
    };
  }
  if (hasTestimonials) {
    return {
      name: 'Testimonial Content', category: 'reputation', passed: true,
      score: maxPoints - 1, maxPoints,
      detail: 'Client testimonials found. Consider adding video testimonials for stronger impact.',
      headline: 'Client testimonials found'
    };
  }
  return {
    name: 'Testimonial Content', category: 'reputation', passed: false,
    score: 0, maxPoints,
    detail: 'No testimonial content found on your site. Real client stories are the most effective conversion tool in legal marketing.',
    headline: 'No testimonials found'
  };
}

// ═══════════════════════════════════════════════════════════
// CATEGORY C: CONVERSION READINESS (25 pts)
// ═══════════════════════════════════════════════════════════

function checkLeadForm(page: ParsedPage): CheckResult {
  const maxPoints = 5;
  if (page.forms.length > 0) {
    return {
      name: 'Lead Form', category: 'conversionReadiness', passed: true,
      score: maxPoints, maxPoints,
      detail: `Lead form found on homepage. ${page.forms.length} form(s) detected — potential clients can reach you directly.`,
      headline: 'Lead form present'
    };
  }
  return {
    name: 'Lead Form', category: 'conversionReadiness', passed: false,
    score: 0, maxPoints,
    detail: 'No lead form found on homepage. Every second a potential client spends looking for how to contact you is a second they might leave.',
    headline: 'No lead form on homepage'
  };
}

function checkPhoneVisibility(page: ParsedPage): CheckResult {
  const maxPoints = 4;
  if (page.phoneNumbers.length > 0 && page.hasTelLink) {
    return {
      name: 'Phone Number', category: 'conversionReadiness', passed: true,
      score: maxPoints, maxPoints,
      detail: `Phone number visible with click-to-call link. Phone: ${page.phoneNumbers[0]}`,
      headline: 'Phone with click-to-call'
    };
  }
  if (page.phoneNumbers.length > 0) {
    return {
      name: 'Phone Number', category: 'conversionReadiness', passed: false,
      score: 3, maxPoints,
      detail: `Phone number visible (${page.phoneNumbers[0]}) but no click-to-call link for mobile users.`,
      headline: 'Phone visible, no click-to-call'
    };
  }
  return {
    name: 'Phone Number', category: 'conversionReadiness', passed: false,
    score: 0, maxPoints,
    detail: 'No phone number found in page HTML. Many PI clients prefer to call — make your number impossible to miss.',
    headline: 'No phone number found'
  };
}

function checkLiveChat(page: ParsedPage): CheckResult {
  const maxPoints = 3;
  if (page.chatWidgets.length > 0) {
    return {
      name: 'Live Chat', category: 'conversionReadiness', passed: true,
      score: maxPoints, maxPoints,
      detail: `Live chat detected: ${page.chatWidgets.join(', ')}. Chat converts 3-5x more visitors than forms alone.`,
      headline: `${page.chatWidgets[0]} chat detected`
    };
  }
  return {
    name: 'Live Chat', category: 'conversionReadiness', passed: false,
    score: 0, maxPoints,
    detail: 'No live chat widget found. Firms with chat typically see 3-5x more conversions from website visitors.',
    headline: 'No live chat detected'
  };
}

function checkMobileReady(page: ParsedPage): CheckResult {
  const maxPoints = 3;
  if (page.hasViewport) {
    return {
      name: 'Mobile Responsive', category: 'conversionReadiness', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Mobile viewport configured. 60%+ of legal searches happen on mobile devices.',
      headline: 'Mobile responsive'
    };
  }
  return {
    name: 'Mobile Responsive', category: 'conversionReadiness', passed: false,
    score: 0, maxPoints,
    detail: 'No mobile viewport set. Your site likely looks broken on phones — where most clients will find you.',
    headline: 'Not mobile responsive'
  };
}

function checkSSL(page: ParsedPage): CheckResult {
  const maxPoints = 3;
  if (page.hasSSL) {
    return {
      name: 'SSL Certificate', category: 'conversionReadiness', passed: true,
      score: maxPoints, maxPoints,
      detail: 'HTTPS enabled. Your site is secure and won\'t trigger browser warnings.',
      headline: 'HTTPS enabled'
    };
  }
  return {
    name: 'SSL Certificate', category: 'conversionReadiness', passed: false,
    score: 0, maxPoints,
    detail: 'No HTTPS. Browsers will show "Not Secure" warnings — destroying trust before visitors read a word.',
    headline: 'No SSL — shows "Not Secure"'
  };
}

function checkPageSpeed(res: FetchedResource): CheckResult {
  const maxPoints = 3;
  const loadTime = res.loadTimeMs;

  if (loadTime < 2000) {
    return {
      name: 'Page Speed', category: 'conversionReadiness', passed: true,
      score: maxPoints, maxPoints,
      detail: `Page loaded in ${(loadTime / 1000).toFixed(1)}s. Fast load times reduce bounce rates significantly.`,
      headline: `${(loadTime / 1000).toFixed(1)}s load time`
    };
  }
  if (loadTime < 4000) {
    return {
      name: 'Page Speed', category: 'conversionReadiness', passed: false,
      score: 2, maxPoints,
      detail: `Page loaded in ${(loadTime / 1000).toFixed(1)}s. Acceptable, but every second costs conversions.`,
      headline: `${(loadTime / 1000).toFixed(1)}s — could be faster`
    };
  }
  return {
    name: 'Page Speed', category: 'conversionReadiness', passed: false,
    score: 0, maxPoints,
    detail: `Page loaded in ${(loadTime / 1000).toFixed(1)}s. 53% of mobile visitors leave if a page takes over 3 seconds.`,
    headline: `${(loadTime / 1000).toFixed(1)}s — too slow`
  };
}

function checkMultilingual(page: ParsedPage): CheckResult {
  const maxPoints = 2;
  const html = page.html;

  // Existing checks
  const hasBasic = page.hasHreflang || page.hasSpanishPath;

  // Google Translate widget / Weglot
  const hasTranslateWidget = /gtranslate|google.*translate|googletrans/i.test(html) || /weglot/i.test(html);

  // lang="es" or xml:lang="es" attributes
  const hasLangAttr = /lang=["']es["']|xml:lang=["']es["']/i.test(html);

  // Other languages in body content
  const hasOtherLang = /chinese|mandarin|cantonese|日本語|中文|한국어/i.test(html);

  if (hasBasic || hasTranslateWidget || hasLangAttr || hasOtherLang) {
    return {
      name: 'Multilingual', category: 'conversionReadiness', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Spanish or multilingual content detected. You\'re reaching a larger pool of potential clients.',
      headline: 'Multilingual content found'
    };
  }
  return {
    name: 'Multilingual', category: 'conversionReadiness', passed: false,
    score: 0, maxPoints,
    detail: 'No multilingual content detected. If you serve Spanish-speaking clients, a translated site can dramatically expand your reach.',
    headline: 'English only'
  };
}

// ═══════════════════════════════════════════════════════════
// CATEGORY D: SPEED TO LEAD (10 pts)
// ═══════════════════════════════════════════════════════════

function checkAutoResponse(page: ParsedPage): CheckResult {
  const maxPoints = 5;
  const allHtml = page.html.toLowerCase();

  // Check for common auto-response / CRM integration signals
  const crmPatterns = /lawmatics|lead\s*docket|law\s*ruler|clio|casepeer|filevine|litify|salesforce|hubspot|activecampaign|mailchimp|zapier|intaker|ringba|callrail|gravity\s*forms|wpforms|ninja\s*forms|contact\s*form\s*7|formidable|jotform|typeform|wufoo|cognito\s*forms|123formbuilder|formstack|smartsheet/i;
  let hasCRM = crmPatterns.test(allHtml);

  // Check for form thank-you / redirect signals
  const hasFormAction = page.forms.some(f => f.action && f.action.length > 1);

  // Detect forms posting to third-party domains (CRM signal)
  if (!hasCRM) {
    try {
      const siteHostname = new URL(page.url).hostname.replace(/^www\./, '');
      for (const form of page.forms) {
        if (form.action && /^https?:\/\//i.test(form.action)) {
          try {
            const formHost = new URL(form.action).hostname.replace(/^www\./, '');
            if (formHost !== siteHostname) {
              hasCRM = true;
              break;
            }
          } catch { /* skip malformed URLs */ }
        }
      }
    } catch { /* skip */ }
  }

  if (hasCRM && hasFormAction) {
    return {
      name: 'Lead Capture Integration', category: 'speedToLead', passed: true,
      score: maxPoints, maxPoints,
      detail: 'CRM or marketing automation integration detected. Leads are likely being routed and responded to automatically.',
      headline: 'CRM integration detected'
    };
  }
  if (hasCRM || hasFormAction) {
    return {
      name: 'Lead Capture Integration', category: 'speedToLead', passed: false,
      score: 3, maxPoints,
      detail: hasCRM
        ? 'CRM detected but form integration unclear. Verify leads from your site are routing into your system.'
        : 'Form submits to an endpoint but no CRM signals detected. Are leads being followed up on quickly?',
      headline: hasCRM ? 'CRM found, verify routing' : 'Form present, no CRM detected'
    };
  }
  return {
    name: 'Lead Capture Integration', category: 'speedToLead', passed: false,
    score: 0, maxPoints,
    detail: 'No CRM or lead automation detected. Without automated routing, leads sit unanswered — and 78% of clients sign with the first firm to respond.',
    headline: 'No lead automation detected'
  };
}

function checkAfterHoursChat(page: ParsedPage): CheckResult {
  const maxPoints = 5;
  const hasChat = page.chatWidgets.length > 0;
  const allHtml = page.html.toLowerCase();
  const hasAnsweringService = /answering\s*service|smith\.ai|ruby\s*receptionist|lex\s*reception|nexa|abby\s*connect|patlive|gabbyville/i.test(allHtml);
  const has247 = /24\s*\/?\s*7|24\s*hours|always\s*available|around\s*the\s*clock|after\s*hours/i.test(allHtml);

  if ((hasChat || hasAnsweringService) && has247) {
    return {
      name: 'After-Hours Availability', category: 'speedToLead', passed: true,
      score: maxPoints, maxPoints,
      detail: '24/7 availability signals found. You\'re capturing leads when competitors are sleeping.',
      headline: '24/7 availability detected'
    };
  }
  if (hasChat || hasAnsweringService || has247) {
    return {
      name: 'After-Hours Availability', category: 'speedToLead', passed: false,
      score: 3, maxPoints,
      detail: `${hasChat ? 'Chat widget found' : has247 ? '24/7 claims found' : 'Answering service detected'} — but complete after-hours coverage is unclear.`,
      headline: 'Partial after-hours coverage'
    };
  }
  return {
    name: 'After-Hours Availability', category: 'speedToLead', passed: false,
    score: 0, maxPoints,
    detail: 'No after-hours availability detected. 35% of legal inquiries happen outside business hours — those leads are going to competitors.',
    headline: 'No after-hours coverage'
  };
}

// ═══════════════════════════════════════════════════════════
// MAIN SCAN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════
export async function scanWebsite(inputUrl: string): Promise<ScanResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  let url = inputUrl;
  if (!url.startsWith('http')) url = 'https://' + url;
  const origin = new URL(url).origin;
  const domain = new URL(url).hostname;
  const isSSL = url.startsWith('https');

  // Parallel fetch: standard resources + Cloudflare crawl
  const [homepageRes, robotsRes, sitemapRes, llmsRes, crawlOutcome] = await Promise.all([
    fetchResource(url),
    fetchResource(origin + '/robots.txt', 5000),
    fetchResource(origin + '/sitemap.xml', 5000),
    fetchResource(origin + '/llms.txt', 5000),
    crawlSite({ url, limit: 75, maxDepth: 3, formats: ['html'], maxAge: 3600 }).catch(() => null),
  ]);

  const crawlResult: CrawlResult | null = crawlOutcome ?? null;
  let usedCrawl = false;

  // Process ALL crawl pages first (they use real browser rendering)
  const allPages: ParsedPage[] = [];
  const seenUrls = new Set<string>();

  if (crawlResult) {
    for (const crawlPage of crawlResult.pages) {
      if (crawlPage.status !== 'completed' || !crawlPage.html) continue;
      try {
        const pageUrl = new URL(crawlPage.url);
        if (pageUrl.hostname.replace(/^www\./, '') !== domain.replace(/^www\./, '')) continue;
        const normalized = pageUrl.origin + pageUrl.pathname.replace(/\/$/, '');
        if (seenUrls.has(normalized)) continue;
        seenUrls.add(normalized);
        seenUrls.add(crawlPage.url);
        const parsed = parsePage(crawlPage.html, crawlPage.url, isSSL);
        allPages.push(parsed);
        usedCrawl = true;
      } catch { /* skip invalid URLs */ }
    }
  }

  // Get homepage — prefer crawl version, fall back to direct fetch
  let homepage = allPages.find(p => {
    try { const path = new URL(p.url).pathname; return path === '/' || path === ''; } catch { return false; }
  }) ?? null;

  if (!homepage && homepageRes.content) {
    homepage = parsePage(homepageRes.content, url, isSSL);
    const normalized = new URL(url).origin + new URL(url).pathname.replace(/\/$/, '');
    if (!seenUrls.has(normalized) && !seenUrls.has(url)) {
      allPages.unshift(homepage);
      seenUrls.add(normalized);
      seenUrls.add(url);
    }
  }

  if (!homepage) {
    errors.push('Could not fetch homepage');
  }

  // Only supplement with direct fetches if crawl had few pages
  if (homepage && allPages.length < 10) {
    const subUrls = discoverSubpages(homepage, url)
      .filter(u => !seenUrls.has(u) && !seenUrls.has(u.replace(/\/$/, '')))
      .slice(0, 5);
    const subResults = await Promise.allSettled(
      subUrls.map(async (subUrl) => {
        const res = await fetchResource(subUrl, 6000);
        if (res.content && res.status === 200) {
          return parsePage(res.content, subUrl, isSSL);
        }
        return null;
      })
    );
    for (const r of subResults) {
      if (r.status === 'fulfilled' && r.value) {
        const normalized = new URL(r.value.url).origin + new URL(r.value.url).pathname.replace(/\/$/, '');
        if (!seenUrls.has(normalized)) {
          allPages.push(r.value);
          seenUrls.add(normalized);
          seenUrls.add(r.value.url);
        }
      }
    }
  }

  // Run checks
  const checks: CheckResult[] = [];

  if (homepage) {
    // A: Digital Presence (35 pts)
    checks.push(checkWebsiteLoads(homepageRes));
    checks.push(checkGBPSignals(allPages));
    checks.push(checkSEOBasics(homepage, robotsRes, sitemapRes));
    checks.push(checkAIReadiness(homepage, robotsRes, llmsRes));
    checks.push(checkDirectoryPresence(allPages));

    // B: Reputation (30 pts)
    checks.push(checkReviewSignals(allPages));
    checks.push(checkCaseResultsPage(allPages));
    checks.push(checkAttorneyProfilesRep(allPages));
    checks.push(checkTestimonialContent(allPages));

    // C: Conversion Readiness (25 pts)
    checks.push(checkLeadForm(homepage));
    checks.push(checkPhoneVisibility(homepage));
    checks.push(checkLiveChat(homepage));
    checks.push(checkMobileReady(homepage));
    checks.push(checkSSL(homepage));
    checks.push(checkPageSpeed(homepageRes));
    checks.push(checkMultilingual(homepage));

    // D: Speed to Lead (10 pts)
    checks.push(checkAutoResponse(homepage));
    checks.push(checkAfterHoursChat(homepage));
  }

  // Aggregate
  const categoryMap: Record<string, CheckResult[]> = {
    digitalPresence: [], reputation: [], conversionReadiness: [], speedToLead: [],
  };
  for (const check of checks) {
    categoryMap[check.category]?.push(check);
  }

  function buildCategory(key: string, name: string): CategoryScore {
    const catChecks = categoryMap[key] || [];
    const score = catChecks.reduce((sum, c) => sum + c.score, 0);
    const maxPoints = catChecks.reduce((sum, c) => sum + c.maxPoints, 0);
    const percentage = maxPoints > 0 ? Math.round((score / maxPoints) * 100) : 0;
    return { name, score, maxPoints, percentage, grade: categoryGrade(percentage), checks: catChecks };
  }

  const categories = {
    digitalPresence: buildCategory('digitalPresence', 'Digital Presence & Findability'),
    reputation: buildCategory('reputation', 'Reputation & Trust Signals'),
    conversionReadiness: buildCategory('conversionReadiness', 'Conversion Readiness'),
    speedToLead: buildCategory('speedToLead', 'Speed to Lead'),
  };

  const totalScore = checks.reduce((sum, c) => sum + c.score, 0);
  const totalMax = checks.reduce((sum, c) => sum + c.maxPoints, 0);
  const overallScore = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
  const { grade, label: gradeLabel } = gradeFromScore(overallScore);

  // Build headline findings (top 2 most impactful)
  const headlines: string[] = [];
  const sortedByImpact = [...checks].sort((a, b) => b.maxPoints - a.maxPoints);
  const topFailing = sortedByImpact.find(c => !c.passed);
  const topPassing = sortedByImpact.find(c => c.passed);
  if (topPassing) headlines.push(topPassing.headline);
  if (topFailing) headlines.push(topFailing.headline);

  const firmName = homepage ? extractFirmName(homepage) : domain;

  return {
    url, domain, firmName, overallScore, grade, gradeLabel,
    categories, totalChecks: checks.length, passedChecks: checks.filter(c => c.passed).length,
    scanDurationMs: Date.now() - startTime, headlineFindings: headlines, errors,
    crawlEnhanced: usedCrawl,
    crawlPagesUsed: usedCrawl ? allPages.length : 0,
  };
}
