'use client';

import React, { useState, useRef, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { saveScanResult } from '@/lib/db';
import { ResultTable } from './ResultTable';
import { BulkResultsTable } from './BulkResultsTable';
import { ProblemsSection } from './ProblemsSection';
import { FullHealthReport } from '@/lib/types';
import { HealthSummary } from './HealthCards';
import { TestList } from './TestList';
import { VerdictBanner } from './VerdictBanner';
import { TechnicalConfig } from './TechnicalConfig';
import { PrimaryAction } from './PrimaryAction';
import { Navbar } from './Navbar';
import { Hero } from './Hero';
import { LoginModal } from '@/components/LoginModal';
import { Download, Upload, Search, ShieldCheck, Loader2, ArrowRight, ChevronDown, ChevronUp, CheckCircle2, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback } from 'react';

// Defined outside to be stable
const SCAN_STEPS = [
    "Establishing Secure Connection",
    "Resolving DNS Records",
    "Validating MX Configuration",
    "Analyzing SPF Alignment",
    "Decrypting DKIM Selectors",
    "Verifying DMARC Policy",
    "Checking Global Blacklists",
    "Compiling Security Report"
];

export function DomainChecker() {
    const [domainInput, setDomainInput] = useState('');
    const [loading, setLoading] = useState(false);

    // Tracks the current step index (0 to SCAN_STEPS.length - 1)
    const [scanIndex, setScanIndex] = useState(0);

    const [results, setResults] = useState<FullHealthReport[]>([]);
    const [currentSingleResult, setCurrentSingleResult] = useState<FullHealthReport | null>(null);
    const [inputError, setInputError] = useState<string | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const resultsRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [bulkResults, setBulkResults] = useState<FullHealthReport[]>([]);
    const [isBulkProcessing, setIsBulkProcessing] = useState(false);
    const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });

    // Auth State
    const [user, setUser] = useState<User | null>(null);
    const [showLoginModal, setShowLoginModal] = useState(false);


    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (u) => {
            setUser(u);
            if (!u) {
                // Clear all state on logout
                setCurrentSingleResult(null);
                setResults([]);
                setBulkResults([]);
                setScanIndex(0);
                setShowAdvanced(false);
            }
        });
        return () => unsubscribe();
    }, []);

    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const autoDomain = searchParams.get('domain');

    const fetchDomainHealth = useCallback(async (domain: string, signal?: AbortSignal) => {
        // Sanitize domain
        const cleanDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/$/, '').trim();

        try {
            const token = await auth.currentUser?.getIdToken();
            const response = await fetch('/api/check-domain', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    domain: cleanDomain
                }),
                signal // Pass abort signal
            });
            const data = await response.json();

            // Handle Global Timeout (Partial Result)
            if (data.status === 'partial') {
                const fallback: FullHealthReport = {
                    domain: cleanDomain,
                    score: 0,
                    rawSpf: null,
                    rawDmarc: null,
                    dmarcPolicy: null,
                    mxRecords: [],
                    categories: {
                        problems: { category: 'Problems', tests: [{ name: 'Server Timeout', status: 'Error', info: 'Runtime Timeout', reason: 'Checking took too long.', recommendation: 'Try a single domain check.' }], stats: { passed: 0, warnings: 0, errors: 1 } },
                        dns: { category: 'DNS', tests: [], stats: { passed: 0, warnings: 0, errors: 0 } },
                        spf: { category: 'SPF', tests: [], stats: { passed: 0, warnings: 0, errors: 0 } },
                        dmarc: { category: 'DMARC', tests: [], stats: { passed: 0, warnings: 0, errors: 0 } },
                        dkim: { category: 'DKIM', tests: [], stats: { passed: 0, warnings: 0, errors: 0 } },
                        blacklist: { category: 'Blacklist', tests: [], stats: { passed: 0, warnings: 0, errors: 0 } },
                        webServer: { category: 'Web Server', tests: [], stats: { passed: 0, warnings: 0, errors: 0 } },
                        smtp: { category: 'SMTP', tests: [], stats: { passed: 0, warnings: 0, errors: 0 } }
                    }
                };
                return fallback;
            }

            if (!response.ok) throw new Error(data.error || 'Failed');
            return data as FullHealthReport;
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.log('Request aborted');
                return null;
            }
            console.error(error);
            // If it's a manual check, show the error in UI
            if (error.message) setInputError(error.message);
            return null;
        }
    }, []);

    const handleAutoCheck = useCallback(async (domainToSearch: string) => {
        window.scrollTo({ top: 0, behavior: 'auto' });
        setLoading(true);
        setInputError(null);
        setCurrentSingleResult(null);
        setBulkResults([]); // Clear bulk
        setShowAdvanced(false);
        setScanIndex(0);

        const stepDuration = 600;
        const progressInterval = setInterval(() => {
            setScanIndex(prev => (prev < SCAN_STEPS.length - 1 ? prev + 1 : prev));
        }, stepDuration);

        try {
            const result = await fetchDomainHealth(domainToSearch);
            clearInterval(progressInterval);
            setScanIndex(SCAN_STEPS.length - 1);

            setTimeout(() => {
                if (result) {
                    setResults((prev) => [...prev, result]);
                    setCurrentSingleResult(result);
                    setLoading(false);

                    if (auth.currentUser) {
                        saveScanResult(auth.currentUser.uid, result.domain, result.score);
                    }
                } else {
                    setInputError('Could not retrieve data for this domain.');
                    setLoading(false);
                }
            }, 600);
        } catch (e) {
            clearInterval(progressInterval);
            setLoading(false);
            setInputError('An error occurred during verification.');
        }
    }, [fetchDomainHealth]);

    useEffect(() => {
        if (autoDomain && !loading) {
            // Only trigger if we don't already have results FOR THIS EXACT DOMAIN
            if (!currentSingleResult || currentSingleResult.domain.toLowerCase() !== autoDomain.toLowerCase()) {

                // First, check if we ALREADY fetched this domain recently in this session's history memory
                const existingResult = results.find(r => r.domain.toLowerCase() === autoDomain.toLowerCase());

                if (existingResult) {
                    setDomainInput(existingResult.domain);
                    setCurrentSingleResult(existingResult);
                    window.scrollTo({ top: 0, behavior: 'auto' });
                } else {
                    setDomainInput(autoDomain);
                    const timer = setTimeout(() => {
                        handleAutoCheck(autoDomain);
                    }, 100);
                    return () => clearTimeout(timer);
                }
            }
        } else if (!autoDomain && currentSingleResult) {
            // User went back to home page (no domain in URL), clear results but keep history array intact
            setCurrentSingleResult(null);
            setScanIndex(0);
            setDomainInput('');
        }
    }, [autoDomain, currentSingleResult, loading, results, handleAutoCheck]);

    const checkDomain = async (domain: string) => {
        return await fetchDomainHealth(domain); // Use common helper
    };

    const handleManualCheck = async () => {
        if (!domainInput.trim()) return;

        // Sync to URL so Back Navigation natively remembers the scanned domain!
        const params = new URLSearchParams(searchParams.toString());
        params.set('domain', domainInput.trim().toLowerCase());
        router.push(`${pathname}?${params.toString()}`, { scroll: false });

        window.scrollTo({ top: 0, behavior: 'auto' });
        setLoading(true);
        setInputError(null);
        setCurrentSingleResult(null);
        setBulkResults([]); // Clear bulk
        setShowAdvanced(false);
        setScanIndex(0);

        const stepDuration = 600;
        const progressInterval = setInterval(() => {
            setScanIndex(prev => (prev < SCAN_STEPS.length - 1 ? prev + 1 : prev));
        }, stepDuration);

        try {
            const result = await fetchDomainHealth(domainInput);
            clearInterval(progressInterval);
            setScanIndex(SCAN_STEPS.length - 1);

            setTimeout(() => {
                if (result) {
                    setResults((prev) => [...prev, result]);
                    setCurrentSingleResult(result);
                    setDomainInput('');
                    setLoading(false);

                    // Save to History if Logged In
                    if (auth.currentUser) {
                        saveScanResult(auth.currentUser.uid, result.domain, result.score);
                    }
                } else {
                    setInputError('Could not retrieve data for this domain.');
                    setLoading(false);
                }
            }, 600);
        } catch (e) {
            clearInterval(progressInterval);
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleManualCheck();
    };

    const [activeCategory, setActiveCategory] = useState<string | null>(null);

    const scrollToCategory = (category: string) => {
        const id = `cat-${category.toLowerCase().replace(/ /g, '-')}`;
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveCategory(category);
    };

    // Bulk Control State
    // Bulk Control State
    const [bulkStatus, setBulkStatus] = useState<'idle' | 'running' | 'paused' | 'completed'>('idle');
    const bulkControlRef = useRef<{ isPaused: boolean; isStopped: boolean }>({ isPaused: false, isStopped: false });
    const bulkAbortController = useRef<AbortController | null>(null);
    const bufferedResults = useRef<FullHealthReport[]>([]);
    const bufferedProgressCount = useRef(0);

    // Completion UX: Sound + Auto-Dismiss
    useEffect(() => {
        if (bulkStatus === 'completed') {
            const chime = new Audio('/completion.mp3');
            try {
                chime.volume = 0.5;
                chime.play().catch(e => console.warn('Audio play blocked', e));
            } catch (e) {
                console.warn('Audio error', e);
            }
            const timer = setTimeout(() => {
                setBulkStatus('idle');
            }, 4000);
            return () => clearTimeout(timer);
        }
    }, [bulkStatus]);

    const handlePauseBulk = () => {
        setBulkStatus('paused');
        bulkControlRef.current.isPaused = true;
    };

    const handleResumeBulk = () => {
        // Flush Buffers (Instant UI Update)
        if (bufferedResults.current.length > 0) {
            setBulkResults(prev => [...prev, ...bufferedResults.current]);
            bufferedResults.current = [];
        }
        if (bufferedProgressCount.current > 0) {
            setBulkProgress(prev => ({ ...prev, current: prev.current + bufferedProgressCount.current }));
            bufferedProgressCount.current = 0;
        }

        setBulkStatus('running');
        bulkControlRef.current.isPaused = false;
    };

    const handleStopBulk = () => {
        setBulkStatus('idle'); // Hides banner
        bulkControlRef.current.isStopped = true;
        setIsBulkProcessing(false);
        setLoading(false); // <--- FIX: Kill the global spinner
        // KILL SWITCH: Abort all pending requests
        if (bulkAbortController.current) {
            bulkAbortController.current.abort();
        }
        // Clear buffers on stop
        bufferedResults.current = [];
        bufferedProgressCount.current = 0;
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            setLoading(true);
            setIsBulkProcessing(true);
            setBulkStatus('running');
            bulkControlRef.current = { isPaused: false, isStopped: false };
            bulkAbortController.current = new AbortController();
            bufferedResults.current = [];
            bufferedProgressCount.current = 0;

            setCurrentSingleResult(null);
            setBulkResults([]);

            try {
                const bstr = evt.target?.result;
                const XLSX = await import('xlsx');
                const workbook = XLSX.read(bstr, { type: 'binary' });
                const ws = workbook.Sheets[workbook.SheetNames[0]];
                const data = XLSX.utils.sheet_to_json(ws) as any[];

                const domains = data.map((row) => row['Domain'] || row['domain']).filter(Boolean);
                setBulkProgress({ current: 0, total: domains.length });

                const CONCURRENCY_LIMIT = 3; // Strict Action: Max 3 for Vercel Hobby
                let activeCount = 0;
                let currentIndex = 0;
                const total = domains.length;

                const processNext = async () => {
                    // STOP CHECK
                    if (bulkControlRef.current.isStopped) return;

                    // PAUSE CHECK (Strict)
                    if (bulkControlRef.current.isPaused) {
                        while (bulkControlRef.current.isPaused && !bulkControlRef.current.isStopped) {
                            await new Promise(r => setTimeout(r, 100)); // Faster poll
                        }
                        if (bulkControlRef.current.isStopped) return;
                    }

                    if (currentIndex >= total) return;

                    const index = currentIndex++;
                    const domain = domains[index];
                    activeCount++;

                    try {
                        const signal = bulkAbortController.current?.signal;

                        // Note: If paused, we DO NOT abort. We let it finish to save data.
                        // But UI will be frozen via buffer.
                        const result = await fetchDomainHealth(domain, signal);

                        // IGNORE RESULT IF STOPPED
                        if (bulkControlRef.current.isStopped) return;

                        if (result) {
                            // VISUAL FREEZE: If paused, buffer it. Don't show it.
                            if (bulkControlRef.current.isPaused) {
                                bufferedResults.current.push(result);
                            } else {
                                setBulkResults(prev => [...prev, result]);
                            }
                        }
                    } catch (err) {
                        console.error(`Failed to process ${domain}`, err);
                    } finally {
                        // VISUAL FREEZE: If paused, don't update visible progress.
                        if (bulkControlRef.current.isPaused && !bulkControlRef.current.isStopped) {
                            bufferedProgressCount.current += 1;
                        } else {
                            setBulkProgress(prev => ({ ...prev, current: prev.current + 1 }));
                        }

                        activeCount--;

                        if (!bulkControlRef.current.isStopped && currentIndex < total) {
                            await processNext();
                        }
                    }
                };

                const initialPromises = [];
                for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, total); i++) {
                    initialPromises.push(processNext());
                }

                await new Promise<void>((resolve) => {
                    const checkDone = setInterval(() => {
                        if ((currentIndex >= total || bulkControlRef.current.isStopped) && activeCount === 0) {
                            clearInterval(checkDone);
                            setLoading(false);
                            // Only mark complete if NOT stopped manually
                            if (!bulkControlRef.current.isStopped) {
                                setBulkStatus('completed');
                            }
                            resolve();
                        }
                    }, 500);
                });

            } catch (e) {
                setInputError('Upload Failed: Ensure Excel has a "Domain" column.');
                setLoading(false);
                setIsBulkProcessing(false);
                setBulkStatus('idle');
            }
        };
        reader.readAsBinaryString(file);
    };

    // Helper generators
    const generateUpdatedSpf = (raw: string | null) => raw ? raw.replace(/-all|\?all/g, '~all') : 'v=spf1 a mx ~all';
    const generateUpdatedDmarc = (raw: string | null, domain: string) => {
        const ensureMailto = (val: string) => {
            return val.split(',').map(part => {
                const p = part.trim();
                if (!p) return p;
                return p.toLowerCase().startsWith('mailto:') ? p : `mailto:${p}`;
            }).join(', ');
        };

        const hasSyntaxError = (record: string) => {
            const mRua = record.match(/rua=([^;]+)/i);
            if (mRua) {
                const parts = mRua[1].split(',').map(p => p.trim());
                if (parts.some(p => p && !p.toLowerCase().startsWith('mailto:'))) return true;
            }
            const mRuf = record.match(/ruf=([^;]+)/i);
            if (mRuf) {
                const parts = mRuf[1].split(',').map(p => p.trim());
                if (parts.some(p => p && !p.toLowerCase().startsWith('mailto:'))) return true;
            }
            return false;
        };

        // If current record is already strong, don't recommend a "fix" that is identical
        const isAlreadyStrict = raw?.includes('p=reject') || (raw?.includes('p=quarantine') && raw?.includes('pct=100'));
        const syntaxError = raw ? hasSyntaxError(raw) : false;

        if (isAlreadyStrict && !raw?.includes('p=none') && !syntaxError) {
            return raw || '';
        }

        let rua = `mailto:dmarc-reports@${domain}`;
        let ruf = '';
        if (raw) {
            const mRua = raw.match(/rua=([^;]+)/i);
            if (mRua) rua = ensureMailto(mRua[1].trim());

            const mRuf = raw.match(/ruf=([^;]+)/i);
            if (mRuf) ruf = ` ruf=${ensureMailto(mRuf[1].trim())};`;
        }
        return `v=DMARC1; p=reject; sp=reject; pct=100; rua=${rua};${ruf} adkim=r; aspf=r;`;
    };

    // Handle Browser Back Button
    useEffect(() => {
        const handlePopState = () => {
            // If user hits back, we return to list view (set single result null)
            setCurrentSingleResult(null);
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const handleSelectDomain = (result: FullHealthReport) => {
        window.history.pushState({ view: 'details' }, '', `#${result.domain}`);
        setCurrentSingleResult(result);
        window.scrollTo({ top: 0, behavior: 'auto' });
    };

    // Lock scroll when loading
    useEffect(() => {
        if (loading) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [loading]);

    return (
        <div className="min-h-screen relative bg-black font-sans selection:bg-white/20">

            <Navbar
                searchState={currentSingleResult ? {
                    value: domainInput,
                    onChange: setDomainInput,
                    onSubmit: handleManualCheck,
                    loading: loading
                } : undefined}
            />

            {/* --- TITANIUM ORBITAL LOADING OVERLAY --- */}
            {(loading && (!isBulkProcessing || bulkResults.length === 0)) && (
                <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center overflow-hidden">
                    {/* Background Ambient Plasma */}
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/5 via-transparent to-transparent opacity-50 animate-pulse" />

                    {/* ORBITAL SYSTEM */}
                    <div className="relative w-64 h-64 flex items-center justify-center mb-12">
                        {/* Ring 1 - Outer (Slow Spin) */}
                        <div className="absolute inset-0 border border-white/5 rounded-full animate-[spin_10s_linear_infinite]" />
                        <div className="absolute inset-0 border-t border-white/20 rounded-full animate-[spin_8s_linear_infinite]" />

                        {/* Ring 2 - Middle (Reverse Fast) */}
                        <div className="absolute inset-8 border border-white/10 rounded-full" />
                        <div className="absolute inset-8 border-r border-l border-white/30 rounded-full animate-[spin_3s_linear_infinite_reverse]" />

                        {/* PROGRESS RING (SVG) */}
                        <svg className="absolute inset-0 w-full h-full -rotate-90 drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
                            {/* Track */}
                            <circle cx="128" cy="128" r="120" stroke="rgba(255,255,255,0.05)" strokeWidth="2" fill="none" />
                            {/* Fill */}
                            <circle
                                cx="128" cy="128" r="120"
                                stroke="white"
                                strokeWidth="4"
                                fill="none"
                                strokeLinecap="round"
                                strokeDasharray="753" // 2 * pi * 120
                                strokeDashoffset={753 - (753 * (isBulkProcessing ? (bulkProgress.current / Math.max(bulkProgress.total, 1)) : ((scanIndex + 1) / SCAN_STEPS.length)))}
                                className="transition-all duration-300 ease-out"
                            />
                        </svg>

                        {/* Ring 3 - Core (Pulse) */}
                        <div className="absolute inset-20 bg-white/5 rounded-full backdrop-blur-md animate-pulse border border-white/20 flex items-center justify-center">
                            <ShieldCheck className="w-8 h-8 text-white dropshadow-[0_0_10px_rgba(255,255,255,0.8)]" />
                        </div>

                        {/* Particle Satellites (Decorators) */}
                        <div className="absolute top-0 left-1/2 w-1 h-1 bg-white rounded-full -translate-x-1/2 shadow-[0_0_10px_white]" />
                        <div className="absolute bottom-0 left-1/2 w-1 h-1 bg-white rounded-full -translate-x-1/2 shadow-[0_0_10px_white]" />
                    </div>

                    {/* STATUS TYPOGRAPHY */}
                    <div className="text-center z-10 space-y-4">
                        {isBulkProcessing ? (
                            <>
                                <h2 className="text-4xl md:text-5xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                    INITIALIZING BATCH
                                </h2>
                                <div className="flex flex-col items-center gap-2">
                                    <p className="text-white font-mono text-lg font-bold">
                                        PREPARING {bulkProgress.total} DOMAINS...
                                    </p>
                                </div>
                            </>
                        ) : (
                            <h2 className="text-4xl md:text-5xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40 animate-in fade-in slide-in-from-bottom-4 duration-700">
                                {SCAN_STEPS[scanIndex] || "INITIALIZING..."}
                            </h2>
                        )}

                        <div className="flex items-center justify-center gap-2 text-white/40 font-mono text-xs tracking-[0.2em] uppercase">
                            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                            <span>System Active</span>
                            <span className="text-white/10">|</span>
                            <span>SEQ_ID: {Math.random().toString(36).substring(7).toUpperCase()}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* --- ADVANCED BULK CONTROL BANNER --- */}
            {bulkStatus !== 'idle' && (
                <div className="fixed top-24 left-0 right-0 z-50 px-4 sm:px-6 animate-in slide-in-from-top duration-500 pointer-events-none flex justify-center">
                    <div className="w-full max-w-7xl flex items-center justify-between gap-4 p-4 bg-[#09090b]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl pointer-events-auto ring-1 ring-white/5">

                        <div className="flex items-center gap-5">
                            <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
                                {bulkStatus === 'running' ? (
                                    <>
                                        <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
                                        <svg className="absolute inset-0 w-full h-full -rotate-90">
                                            <circle cx="20" cy="20" r="18" stroke="rgba(255,255,255,0.1)" strokeWidth="3" fill="none" />
                                            <circle cx="20" cy="20" r="18" stroke="#10b981" strokeWidth="3" fill="none" strokeLinecap="round" strokeDasharray="113" strokeDashoffset={113 - (113 * (bulkProgress.current / Math.max(bulkProgress.total, 1)))} className="transition-all duration-300" />
                                        </svg>
                                    </>
                                ) : bulkStatus === 'paused' ? (
                                    <div className="w-10 h-10 rounded-full border-2 border-yellow-500/50 flex items-center justify-center">
                                        <div className="w-3 h-3 bg-yellow-500 rounded-[1px]" />
                                    </div>
                                ) : (
                                    <div className="w-10 h-10 rounded-full border-2 border-emerald-500/50 flex items-center justify-center">
                                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col min-w-0">
                                <h3 className="text-white font-bold text-base leading-tight tracking-tight truncate">
                                    {bulkStatus === 'paused' ? 'Batch Paused' : bulkStatus === 'completed' ? 'Batch Complete' : 'Processing Batch...'}
                                </h3>
                                <div className="flex items-center gap-3 text-sm text-slate-400 font-mono mt-0.5 whitespace-nowrap">
                                    <span>{bulkProgress.current} / {bulkProgress.total}</span>
                                    <span className="w-1 h-1 bg-white/20 rounded-full" />
                                    <span className={cn("font-bold", bulkStatus === 'completed' ? "text-emerald-500" : "text-white")}>
                                        {Math.round((bulkProgress.current / bulkProgress.total) * 100)}%
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* PAUSE / RESUME */}
                            {bulkStatus === 'running' && (
                                <button onClick={handlePauseBulk} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all active:scale-95">
                                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                                </button>
                            )}
                            {bulkStatus === 'paused' && (
                                <button onClick={handleResumeBulk} className="w-10 h-10 flex items-center justify-center rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-500 transition-all active:scale-95">
                                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                </button>
                            )}

                            {/* STOP (KILL) */}
                            <button
                                onClick={handleStopBulk}
                                className="px-5 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded-xl text-xs font-bold border border-rose-500/20 transition-all hover:scale-105 active:scale-95 tracking-wider uppercase"
                            >
                                {bulkStatus === 'completed' ? 'Close' : 'Stop & Export'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- HERO STATE (When no results) --- */}
            {!currentSingleResult && bulkResults.length === 0 && (
                <Hero
                    domainInput={domainInput}
                    setDomainInput={setDomainInput}
                    handleCheck={handleManualCheck}
                    handleKeyDown={handleKeyDown}
                    loading={loading}
                    error={inputError}
                    onFileUpload={handleFileUpload}
                    isAuthenticated={!!user}
                    onRequireLogin={() => setShowLoginModal(true)}
                />
            )}

            {/* Login Modal for Gatekeeping */}
            <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />

            {/* --- BULK RESULTS STATE --- */}
            {!currentSingleResult && bulkResults.length > 0 && (
                <BulkResultsTable results={bulkResults} onSelect={handleSelectDomain} user={user} />
            )}

            {/* --- RESULTS STATE --- */}
            {currentSingleResult && (
                <div className="pt-20 pb-24 min-h-screen">

                    {/* Domain Result Header (LEFT ALIGNED TEXT, RIGHT ALIGNED BANNER) */}
                    <div className="max-w-7xl mx-auto px-6 w-full flex flex-col md:flex-row items-start md:items-center justify-between gap-6 md:gap-10 mb-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="flex flex-col gap-2 w-full md:w-auto flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-white/40 text-xs font-mono uppercase tracking-widest justify-start">
                                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                                Analysis Complete
                                <span className="text-white/10">|</span>
                                {new Date().toLocaleDateString()}
                            </div>
                            <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight break-all md:break-words">
                                {currentSingleResult.domain}
                            </h1>
                            <p className="text-white/50 text-base md:text-lg">
                                Comprehensive security diagnostic report.
                            </p>
                        </div>

                        {/* Right Side: Verdict Banner Box */}
                        <div className="w-full md:w-[400px] shrink-0">
                            <VerdictBanner report={currentSingleResult} />
                        </div>
                    </div>

                    {/* Results Container */}
                    <div ref={resultsRef} className="max-w-7xl mx-auto px-6 animate-in fade-in slide-in-from-bottom-8 duration-500 space-y-8">

                        {/* 1. TECHNICAL CONFIGURATION (Top Priority) */}
                        <TechnicalConfig
                            domain={currentSingleResult.domain}
                            rawSpf={currentSingleResult.rawSpf}
                            updatedSpf={generateUpdatedSpf(currentSingleResult.rawSpf)}
                            rawDmarc={currentSingleResult.rawDmarc}
                            updatedDmarc={generateUpdatedDmarc(currentSingleResult.rawDmarc, currentSingleResult.domain)}
                            // Nuanced Security: Only "Insecure" if there are actual ERRORS.
                            // Warnings (like rua missing or external auth) should NOT trigger the red "Insecure" banner here.
                            spfSecure={!currentSingleResult.categories.spf.tests.some(t => t.status === 'Error')}
                            dmarcSecure={!currentSingleResult.categories.dmarc.tests.some(t => t.status === 'Error')}
                        />

                        {/* 2. VERDICT BANNER (Secondary - Pushed down to require scroll) */}
                        {/* VERDICT BANNER MOVED TO HEADER */}

                        {/* 2.5 WARNINGS & RECOMMENDATIONS (NEW LOCATION) */}
                        <ProblemsSection problems={currentSingleResult.categories.problems} />

                        {/* 3. COLLAPSED DETAILS */}
                        <div className="pt-8 border-t border-white/10 mt-12 mb-24">
                            <button
                                onClick={() => setShowAdvanced(!showAdvanced)}
                                className="w-full flex items-center justify-between text-white/60 hover:text-white transition-colors py-4 group bg-[#1c1c1e] border border-white/10 rounded-xl px-6 shadow-sm hover:border-white/20"
                            >
                                <span className="text-sm font-bold uppercase tracking-widest">Advanced Technical Details</span>
                                <div className="flex items-center gap-2 text-sm font-medium opacity-70 group-hover:opacity-100">
                                    {showAdvanced ? "Hide Report" : "Show Full Report"}
                                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </div>
                            </button>

                            {
                                showAdvanced && (
                                    <div className="space-y-12 pt-8 animate-in fade-in slide-in-from-top-4 duration-300">

                                        <HealthSummary
                                            categories={[
                                                currentSingleResult.categories.dmarc,
                                                currentSingleResult.categories.spf,
                                                currentSingleResult.categories.dkim,
                                                currentSingleResult.categories.smtp,
                                                currentSingleResult.categories.webServer,
                                                currentSingleResult.categories.dns,
                                                currentSingleResult.categories.blacklist
                                            ].filter(Boolean)}
                                            onCategoryClick={scrollToCategory}
                                        />
                                        <TestList
                                            activeCategory={activeCategory}
                                            categories={[
                                                currentSingleResult.categories.dns,
                                                currentSingleResult.categories.spf,
                                                currentSingleResult.categories.dmarc,
                                                currentSingleResult.categories.dkim,
                                                currentSingleResult.categories.webServer,
                                                currentSingleResult.categories.blacklist,
                                                currentSingleResult.categories.smtp
                                            ].filter(Boolean)} />
                                    </div>
                                )
                            }
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
