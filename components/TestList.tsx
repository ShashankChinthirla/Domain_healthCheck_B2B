import React, { useState } from 'react';
import { CategoryResult, TestResult } from '@/lib/types';
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export function TestList({ categories, activeCategory }: { categories: CategoryResult[], activeCategory?: string | null }) {
    if (!categories || categories.length === 0) return null;

    return (
        <div className="space-y-6 mt-16">
            <h3 className="text-xl font-bold text-white mb-6">Technical Logs</h3>
            {categories.map((cat) => (
                <CategorySection key={cat.category} category={cat} activeCategory={activeCategory} />
            ))}
        </div>
    );
}

function CategorySection({ category, activeCategory }: { category: CategoryResult, activeCategory?: string | null }) {
    const [isOpen, setIsOpen] = useState(false); // Collapsed by default

    // Auto-open/close based on active selection
    React.useEffect(() => {
        if (activeCategory) {
            setIsOpen(category.category === activeCategory);
        }
    }, [activeCategory, category.category]);

    // Safe ID generation
    const categoryId = `cat-${(category.category || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    return (
        <div id={categoryId} className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900 scroll-mt-32">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 bg-slate-900 hover:bg-slate-800 transition-colors text-left"
            >
                <div className="flex items-center space-x-3">
                    <span className="font-bold text-slate-300">{category.category}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 border border-slate-700">
                        {category.tests.length} Checks
                    </span>
                </div>
                <div className="flex items-center space-x-4">
                    <div className="flex space-x-3 text-xs font-bold font-mono">
                        {category.stats.errors > 0 && <span className="text-rose-400">{category.stats.errors} ERR</span>}
                        {category.stats.warnings > 0 && <span className="text-amber-400">{category.stats.warnings} WRN</span>}
                        <span className="text-emerald-500">{category.stats.passed} OK</span>
                    </div>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                </div>
            </button>

            {isOpen && (
                <div className="divide-y divide-slate-800 border-t border-slate-800">
                    {category.category === 'Blacklist' ? (
                        <>
                            {/* Grouping for Blacklist */}
                            {['IP', 'DOMAIN'].map((type) => {
                                const groupTests = category.tests.filter(t => t.type === type);
                                if (groupTests.length === 0) return null;

                                return (
                                    <div key={type} className="bg-slate-900/50">
                                        <div className="px-4 py-2 bg-slate-800/50 border-y border-slate-800">
                                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                                                {type === 'IP' ? 'IP Reputation (Mail Servers)' : 'Domain Reputation (RHSBL)'}
                                            </span>
                                        </div>
                                        {groupTests.map((test, idx) => (
                                            <TestItem key={idx} test={test} />
                                        ))}
                                    </div>
                                );
                            })}
                        </>
                    ) : (
                        category.tests.map((test, idx) => (
                            <TestItem key={idx} test={test} />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

function TestItem({ test }: { test: TestResult }) {
    return (
        <div className="p-4 hover:bg-slate-800/30 transition-colors">
            <div className="flex items-start">
                <div className="mr-3 mt-0.5 flex-shrink-0">
                    <StatusIcon status={test.status} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                        <p className={cn("text-sm font-bold", getStatusColor(test.status))}>
                            {test.name}
                        </p>
                        <span className={cn("hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase tracking-wide font-bold ml-2", getStatusBadge(test.status))}>
                            {test.status}
                        </span>
                    </div>

                    {/* Primary Info (e.g., Raw Record) */}
                    <p className="text-xs text-slate-400 mt-1 break-all font-mono bg-slate-950/50 p-2 rounded border border-slate-800/50">
                        {test.info || "No raw data provided."}
                    </p>

                    {/* Detailed Reason & Recommendation for Errors/Warnings */}
                    {test.status !== 'Pass' && (
                        <div className="mt-3 space-y-2">
                            {test.reason && (
                                <div className="flex items-start gap-2 text-xs">
                                    <span className="font-bold text-rose-400 shrink-0 uppercase tracking-wider text-[10px] mt-0.5">Problem:</span>
                                    <span className="text-slate-300 leading-relaxed">{test.reason}</span>
                                </div>
                            )}
                            {test.recommendation && (
                                <div className="flex items-start gap-2 text-xs">
                                    <span className="font-bold text-emerald-400 shrink-0 uppercase tracking-wider text-[10px] mt-0.5">Solution:</span>
                                    <span className="text-slate-300 leading-relaxed">{test.recommendation}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatusIcon({ status }: { status: string }) {
    if (status === 'Pass') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (status === 'Warning') return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    return <XCircle className="w-4 h-4 text-rose-500" />;
}

function getStatusColor(status: string) {
    if (status === 'Pass') return 'text-slate-300';
    if (status === 'Warning') return 'text-amber-400';
    return 'text-rose-400';
}

function getStatusBadge(status: string) {
    if (status === 'Pass') return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    if (status === 'Warning') return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
    return 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
}
