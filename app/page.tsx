'use client';

import { useState, useEffect } from 'react';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════
interface CheckResult {
  name: string;
  category: string;
  passed: boolean;
  score: number;
  maxPoints: number;
  detail: string;
  headline: string;
}

interface CategoryScore {
  name: string;
  score: number;
  maxPoints: number;
  percentage: number;
  grade: string;
  checks: CheckResult[];
}

interface ScanResult {
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
}

type ViewState = 'input' | 'loading' | 'results';

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function getScoreClass(score: number): string {
  if (score >= 81) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 60) return 'average';
  if (score >= 50) return 'below';
  return 'poor';
}

function getCheckStatus(check: CheckResult): string {
  if (check.passed) return 'pass';
  if (check.score > 0) return 'partial';
  return 'fail';
}

function getCheckStatusLabel(check: CheckResult): string {
  if (check.passed) return 'Pass';
  if (check.score > 0) return 'Partial';
  return 'Fail';
}

function gradeColor(grade: string): string {
  if (grade === 'A' || grade === 'A+') return 'var(--green)';
  if (grade === 'B' || grade === 'B+') return 'var(--blue)';
  if (grade === 'C' || grade === 'C+') return 'var(--orange)';
  return 'var(--red)';
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export default function Home() {
  const [currentView, setCurrentView] = useState<ViewState>('input');
  const [urlInput, setUrlInput] = useState('');
  const [loadingUrl, setLoadingUrl] = useState('');
  const [error, setError] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [loadingSteps, setLoadingSteps] = useState<number[]>([]);

  useEffect(() => {
    if (currentView === 'loading') {
      const delays = [0, 600, 1300, 2100, 2900, 3700];
      const timers = delays.map((delay, index) =>
        setTimeout(() => setLoadingSteps(prev => [...prev, index]), delay)
      );
      return () => { timers.forEach(t => clearTimeout(t)); };
    } else {
      setLoadingSteps([]);
    }
  }, [currentView]);

  const startScan = async () => {
    const input = urlInput.trim();
    if (!input) { setError('Please enter a website URL to audit.'); return; }

    let url = input;
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
    try { new URL(url); } catch { setError('Please enter a valid URL (e.g. https://yourfirm.com)'); return; }

    setError('');
    setLoadingUrl(url);
    setCurrentView('loading');

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API error: ${response.status}`);
      }
      const result = await response.json();
      setTimeout(() => { setScanResult(result); setCurrentView('results'); }, 500);
    } catch (err: any) {
      console.error('Scan error:', err);
      setCurrentView('input');
      setError('Unable to scan this site. Please check the URL and try again.');
    }
  };

  const resetScanner = () => {
    setCurrentView('input');
    setScanResult(null);
    setUrlInput('');
    setError('');
    setLoadingUrl('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => { if (e.key === 'Enter') startScan(); };

  return (
    <>
      <div className="deco-orbs">
        <div className="deco-orb"></div>
        <div className="deco-orb"></div>
        <div className="deco-orb"></div>
      </div>

      <header>
        <a className="logo" href="https://lawfirmaudits.com" style={{textDecoration:'none',color:'inherit'}}>
          <div className="logo-mark"></div>
          <div className="logo-text">Client Acquisition Audit</div>
        </a>
        <a href="https://lawfirmaudits.com" className="header-tag" style={{textDecoration:'none',color:'inherit'}}>LawFirmAudits.com</a>
      </header>

      {/* INPUT VIEW */}
      {currentView === 'input' && (
        <div id="inputSection">
          <div className="hero">
            <div className="hero-eyebrow">Client Acquisition for Law Firms</div>
            <h1>How many cases is<br />your firm <em>losing</em>?</h1>
            <p className="hero-sub">We scan your digital presence, reputation signals, conversion readiness, and speed to lead — then score how well your firm turns potential clients into signed cases.</p>
          </div>

          <div className="input-card">
            <div className="input-row">
              <div className="url-input-wrap">
                <label className="url-label" htmlFor="urlInput">Law Firm Website URL</label>
                <input
                  type="url" id="urlInput" className="url-input"
                  placeholder="https://yourfirm.com" autoComplete="off"
                  value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
              </div>
              <button className="scan-btn" onClick={startScan}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
                Audit My Firm
              </button>
            </div>
            {error && <div className="error-msg visible">{error}</div>}
          </div>

          <div className="section-line delay-1" style={{ marginTop: '80px' }}></div>

          <div className="why-section">
            <div className="why-header">
              <h2 className="why-title">Leads are expensive. Losing them is inexcusable.</h2>
              <p className="why-sub">Most firms spend thousands on marketing, then lose half their leads to slow response times, missing trust signals, and broken conversion paths. This audit shows you exactly where.</p>
            </div>

            <div className="why-stats">
              <div className="why-stat">
                <div className="why-stat-num">78%</div>
                <div className="why-stat-label">of clients sign with the first firm to respond to their inquiry</div>
              </div>
              <div className="why-stat">
                <div className="why-stat-num">35%</div>
                <div className="why-stat-label">of legal inquiries happen outside business hours — are you capturing them?</div>
              </div>
              <div className="why-stat">
                <div className="why-stat-num">3-5x</div>
                <div className="why-stat-label">more conversions from website visitors at firms with live chat vs. forms alone</div>
              </div>
            </div>

            <div className="why-cta">
              <div className="why-cta-title">See where your leads are going.</div>
              <p className="why-cta-text">Free audit. No login required. Results in 60 seconds &uarr;</p>
            </div>
          </div>
        </div>
      )}

      {/* LOADING VIEW */}
      {currentView === 'loading' && (
        <div className="loading-state active">
          <div className="loading-ring"></div>
          <div className="loading-title">Auditing Your Firm</div>
          <div className="loading-sub">{loadingUrl}</div>
          <div className="loading-steps">
            {[
              'Scanning digital presence & search signals',
              'Checking reputation & review signals',
              'Evaluating conversion readiness',
              'Analyzing lead capture & CRM signals',
              'Checking after-hours availability',
              'Calculating your Firm Growth Score'
            ].map((step, index) => (
              <div key={index} className={`loading-step ${loadingSteps.includes(index) ? 'visible' : ''} ${loadingSteps.includes(index + 1) ? 'done' : ''}`}>
                <div className="step-dot"></div>
                {step}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RESULTS VIEW */}
      {currentView === 'results' && scanResult && (
        <ResultsSection result={scanResult} onReset={resetScanner} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// RESULTS COMPONENT
// ═══════════════════════════════════════════════════════════
function ResultsSection({ result, onReset }: { result: ScanResult; onReset: () => void }) {
  const overall = result.overallScore;
  const scoreClass = getScoreClass(overall);

  const categoryOrder: (keyof typeof result.categories)[] = [
    'digitalPresence', 'reputation', 'conversionReadiness', 'speedToLead'
  ];

  const allChecks = categoryOrder.flatMap(key => result.categories[key].checks);
  const failedChecks = allChecks.filter(c => !c.passed).sort((a, b) => b.maxPoints - a.maxPoints);
  const topStrength = allChecks.filter(c => c.passed).sort((a, b) => b.maxPoints - a.maxPoints)[0] || null;
  const criticalGap = failedChecks[0] || null;

  let verdict = '';
  if (overall >= 75) {
    verdict = `${result.firmName} has a strong client acquisition pipeline. ${result.passedChecks} of ${result.totalChecks} checks passed. Fine-tune the remaining gaps to reach elite status.`;
  } else if (overall >= 50) {
    verdict = `${result.firmName} has a foundation but significant gaps are costing you cases. ${result.totalChecks - result.passedChecks} checks need attention — every unfixed gap is a potential client going to a competitor.`;
  } else {
    verdict = `${result.firmName} is losing a significant number of potential clients. ${result.totalChecks - result.passedChecks} of ${result.totalChecks} checks failed — your marketing spend is being wasted by conversion and trust gaps.`;
  }

  useEffect(() => {
    requestAnimationFrame(() => {
      const ringFill = document.getElementById('ringFill');
      if (ringFill) {
        const circ = 2 * Math.PI * 90;
        ringFill.style.strokeDashoffset = (circ - (overall / 100) * circ).toString();
      }
      document.querySelectorAll<HTMLElement>('.category-bar-fill').forEach(el => {
        const w = el.getAttribute('data-width');
        if (w) el.style.width = w + '%';
      });
    });
  }, [overall]);

  return (
    <div className="results-section active">
      {/* SCORE HERO */}
      <div className="score-hero">
        <div>
          <div className="score-firm-name">{result.domain}</div>
          <div className="score-headline">{result.firmName}<br />Firm Growth Score</div>
          <div className="score-verdict">{verdict}</div>
          <div className="scan-meta">
            <span>{result.passedChecks}/{result.totalChecks} checks passed</span>
            <span>{(result.scanDurationMs / 1000).toFixed(1)}s scan</span>
          </div>
        </div>
        <div className="score-ring-wrap">
          <div className="score-ring">
            <svg viewBox="0 0 200 200">
              <circle className="score-ring-bg" cx="100" cy="100" r="90" />
              <circle className={`score-ring-fill ring-${scoreClass}`} id="ringFill" cx="100" cy="100" r="90" />
            </svg>
            <div className="score-ring-text">
              <div className="score-number">{overall}</div>
              <div className="score-denom">out of 100</div>
            </div>
          </div>
          <div className={`score-grade-badge grade-${scoreClass}`}>{result.grade} — {result.gradeLabel}</div>
        </div>
      </div>

      {/* CATEGORY GRADES OVERVIEW */}
      <div className="categories-label">Category Grades</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '48px' }}>
        {categoryOrder.map((key) => {
          const cat = result.categories[key];
          return (
            <div key={key} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              padding: '28px 24px', textAlign: 'center', position: 'relative', overflow: 'hidden'
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, width: '48px', height: '3px',
                background: gradeColor(cat.grade)
              }}></div>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: '3rem', fontWeight: 400,
                color: gradeColor(cat.grade), lineHeight: 1, marginBottom: '12px'
              }}>{cat.grade}</div>
              <div style={{
                fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500,
                letterSpacing: '-0.01em', lineHeight: '1.4'
              }}>{cat.name}</div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-tertiary)',
                marginTop: '8px'
              }}>{cat.score}/{cat.maxPoints} pts</div>
            </div>
          );
        })}
      </div>

      {/* HEADLINE FINDINGS */}
      {result.headlineFindings.length > 0 && (
        <div className="summary-grid">
          {topStrength && (
            <div className="summary-card" style={{ border: '1px solid rgba(45, 122, 82, 0.15)' }}>
              <div className="summary-card-label" style={{ color: 'var(--green)' }}>Top Strength</div>
              <div className="summary-card-value">{topStrength.name}</div>
              <div className="summary-card-sub">{topStrength.detail}</div>
            </div>
          )}
          {criticalGap && (
            <div className="summary-card" style={{ border: '1px solid rgba(197, 48, 48, 0.15)' }}>
              <div className="summary-card-label" style={{ color: 'var(--red)' }}>Biggest Gap</div>
              <div className="summary-card-value">{criticalGap.name}</div>
              <div className="summary-card-sub">{criticalGap.detail}</div>
            </div>
          )}
        </div>
      )}

      {/* DETAILED BREAKDOWN */}
      <div className="categories-label">Detailed Breakdown · 4 Categories · {result.totalChecks} Checks</div>

      {categoryOrder.map((key) => {
        const cat = result.categories[key];
        const pct = cat.percentage;
        const cls = getScoreClass(pct);

        return (
          <div key={key} className="category-block">
            <div className="category-header">
              <div className="category-name">{cat.name}</div>
              <div className={`category-score-pill pill-${cls}`}>
                {cat.grade} — {cat.score}/{cat.maxPoints} pts
              </div>
            </div>
            <div className="category-bar-track">
              <div className={`category-bar-fill bg-${cls}`} data-width={pct}></div>
            </div>
            <div className="checks-grid">
              {cat.checks.map((check, i) => {
                const status = getCheckStatus(check);
                return (
                  <div key={i} className={`check-card check-${status}`}>
                    <div className="check-top">
                      <div className="check-name">{check.name}</div>
                      <div className={`check-status status-${status}`}>
                        {getCheckStatusLabel(check)} {check.score}/{check.maxPoints}
                      </div>
                    </div>
                    <div className="check-detail">{check.detail}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="section-divider"></div>

      {/* CTA */}
      <div className="cta-section">
        <div className="cta-eyebrow">This is your preliminary score</div>
        <div className="cta-title">Want the full<br /><em style={{ fontStyle: 'italic' }}>Client Acquisition Audit</em>?</div>
        <div className="cta-sub">
          This scan covers what&apos;s publicly visible. The full audit includes a mystery shop of your intake, competitor benchmarking, and a prioritized action plan — delivered by Rankings.io within 48 hours.
        </div>
        <div className="cta-buttons">
          <a
            href={`mailto:scottknudson@rankings.io?subject=Full Client Acquisition Audit — ${encodeURIComponent(result.firmName)}&body=I just ran my Firm Growth Score on ${encodeURIComponent(result.url)} and scored ${overall}/100 (${result.grade}). I'd like to request the full Client Acquisition Audit.%0A%0AFirm: ${encodeURIComponent(result.firmName)}%0AScore: ${overall}/100`}
            className="cta-btn-primary"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            Get Your Full Audit
          </a>
          <button className="cta-btn-secondary" onClick={onReset}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
            </svg>
            Audit Another Firm
          </button>
        </div>
      </div>

      <div className="score-again">
        <button className="score-again-btn" onClick={onReset}>&larr; Audit Another Firm</button>
      </div>
    </div>
  );
}
