import React from 'react';
import { FullHealthReport, CategoryResult } from '@/lib/types';
import { CheckCircle2, XCircle, AlertTriangle, ArrowRight, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';

import { User } from 'firebase/auth';

interface BulkResultsTableProps {
    results: FullHealthReport[];
    onSelect: (result: FullHealthReport) => void;
    user?: User | null;
}

export function BulkResultsTable({ results, onSelect, user }: BulkResultsTableProps) {
    const [filter, setFilter] = React.useState<'all' | 'clean' | 'issues'>('all');

    if (results.length === 0) return null;

    // Filter Logic
    const filteredResults = results.filter(r => {
        // Redefine "Clean" based on user input:
        // "if all are good like green and yellow then keep them in clean only red/error in the error session"
        // Meaning: Clean = No Errors (Warnings OK). Errors = Has Errors.

        const allCats = Object.values(r.categories);
        const errors = allCats.reduce((acc, cat) => acc + cat.stats.errors, 0);

        const isClean = errors === 0;

        if (filter === 'clean') return isClean;
        if (filter === 'issues') return !isClean;
        return true;
    });

    const handleExport = () => {
        // Use filteredResults for export so user gets what they see
        const exportData = filteredResults.map(r => {
            const allCats = Object.values(r.categories);
            const errors = allCats.reduce((acc, cat) => acc + cat.stats.errors, 0);
            const warnings = allCats.reduce((acc, cat) => acc + cat.stats.warnings, 0);

            // Clean Export Mode
            if (filter === 'clean') {
                return {
                    "Domain": r.domain,
                    "User": r.dbEmail || user?.email || "Anonymous",
                    "SPF": r.rawSpf || "Missing",
                    "DMARC": r.rawDmarc || "Missing",
                    "Score": r.score
                };
            }

            // Error/All Mode
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

            const row: any = {
                "Domain": r.domain,
                "User": r.dbEmail || "No User found",
                "Score": r.score,
                "Health Status": (errors === 0 && warnings === 0) ? '100% Secure' : `${errors} Errors, ${warnings} Warnings`,
                "SPF [Full]": r.rawSpf || "Missing",
                "Updated SPF [Full]": generateUpdatedSpf(r.rawSpf),
                "DMARC [Full]": r.rawDmarc || "Missing",
                "Updated DMARC [Full]": generateUpdatedDmarc(r.rawDmarc, r.domain),
            };

            // Enhanced Error Reporting
            // Helper to extract error text
            const getIssues = (catName: keyof typeof r.categories) => {
                const cat = r.categories[catName];
                if (!cat) return "";
                return cat.tests
                    .filter(t => t.status === 'Error' || t.status === 'Warning')
                    .map(t => `${t.status.toUpperCase()}: ${t.name} - ${t.reason}`)
                    .join(' | ');
            };

            row["SPF Issues"] = getIssues('spf');
            row["DMARC Issues"] = getIssues('dmarc');
            row["DKIM Issues"] = getIssues('dkim');
            row["DNS Issues"] = getIssues('dns');
            row["Web Server Issues"] = getIssues('webServer');
            row["Blacklist Issues"] = getIssues('blacklist');
            row["SMTP Issues"] = getIssues('smtp');

            return row;
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);

        let wscols: { wch: number }[] = [];

        if (filter === 'clean') {
            wscols = [
                { wch: 25 }, // Domain
                { wch: 30 }, // User
                { wch: 40 }, // SPF
                { wch: 40 }, // DMARC
                { wch: 10 }, // Score
            ];
        } else {
            wscols = [
                { wch: 25 }, // Domain
                { wch: 30 }, // User
                { wch: 10 }, // Score
                { wch: 25 }, // Health
                { wch: 40 }, // SPF
                { wch: 40 }, // Updated SPF
                { wch: 40 }, // DMARC
                { wch: 40 }, // Updated DMARC
                { wch: 50 }, // SPF Issues
                { wch: 50 }, // DMARC Issues
                { wch: 50 }, // DKIM Issues
                { wch: 50 }, // DNS Issues
                { wch: 40 }, // Web Issues
                { wch: 40 }, // Blacklist Issues
                { wch: 30 }, // SMTP Issues
            ];
        }

        ws['!cols'] = wscols;

        XLSX.utils.book_append_sheet(wb, ws, `Health Report (${filter})`);
        XLSX.writeFile(wb, `domain-health-${filter}-${new Date().getTime()}.xlsx`);
    };

    return (
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-25 pb-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-white mb-2">Bulk Analysis Report</h2>
                    <p className="text-slate-400">Processed {results.length} domains. Showing {filteredResults.length} results.</p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Filter Buttons */}
                    <div className="flex bg-white/5 rounded-xl p-1 border border-white/10 mr-4">
                        <button
                            onClick={() => setFilter('all')}
                            className={cn(
                                "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                                filter === 'all' ? "bg-indigo-500 text-white shadow-lg" : "text-slate-400 hover:text-white"
                            )}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setFilter('clean')}
                            className={cn(
                                "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                                filter === 'clean' ? "bg-emerald-500 text-black shadow-lg" : "text-slate-400 hover:text-white"
                            )}
                        >
                            Clean
                        </button>
                        <button
                            onClick={() => setFilter('issues')}
                            className={cn(
                                "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                                filter === 'issues' ? "bg-rose-500 text-white shadow-lg" : "text-slate-400 hover:text-white"
                            )}
                        >
                            Errors
                        </button>
                    </div>

                    <button
                        onClick={handleExport}
                        title="Export Current View"
                        className="group flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold transition-all shadow-lg hover:shadow-emerald-500/20 active:scale-95"
                    >
                        <Download className="w-4 h-4" />
                        <span>Export {filter !== 'all' ? filter : ''}</span>
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        title="Clear & Start New"
                        className="group flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/10 hover:border-white/20 transition-all active:scale-95"
                    >
                        <span>Clear</span>
                    </button>
                </div>
            </div>

            <div className="bg-[#09090b] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/10 bg-white/[0.02]">
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest pl-6">Domain</th>
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center">Score</th>
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center">Issues</th>
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center">SPF</th>
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center">DMARC</th>
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center">Blacklist</th>
                                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-right pr-6">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {filteredResults.map((res, idx) => (
                                <tr
                                    key={idx}
                                    onClick={() => onSelect(res)}
                                    className="hover:bg-white/[0.02] transition-colors cursor-pointer group"
                                >
                                    <td className="p-4 pl-6 font-medium text-slate-200 text-sm">
                                        {res.domain}
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className={cn(
                                            "inline-flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold",
                                            res.score >= 90 ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" :
                                                res.score >= 70 ? "bg-amber-500/10 text-amber-500 border border-amber-500/20" :
                                                    "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                                        )}>
                                            {res.score}
                                        </div>
                                    </td>
                                    <td className="p-4 text-center">
                                        <ProblemsBadge report={res} />
                                    </td>
                                    <td className="p-4 text-center">
                                        <StatusDot category={res.categories.spf} />
                                    </td>
                                    <td className="p-4 text-center">
                                        <StatusDot category={res.categories.dmarc} />
                                    </td>
                                    <td className="p-4 text-center">
                                        <StatusDot category={res.categories.blacklist} />
                                    </td>
                                    <td className="p-4 pr-6 text-right">
                                        <button className="p-2 rounded-full bg-white/5 group-hover:bg-white/10 text-slate-400 group-hover:text-white transition-all">
                                            <ArrowRight className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredResults.length === 0 && (
                        <div className="p-12 text-center text-slate-500">
                            No domains match the selected filter.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function ProblemsBadge({ report }: { report: FullHealthReport }) {
    // Sum all errors from all categories
    const allCats = Object.values(report.categories);
    const errors = allCats.reduce((acc, cat) => acc + cat.stats.errors, 0);
    const warnings = allCats.reduce((acc, cat) => acc + cat.stats.warnings, 0);

    if (errors === 0 && warnings === 0) {
        return (
            <span className="px-2.5 py-1 rounded-md text-xs font-bold border bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                100% Secure
            </span>
        );
    }

    return (
        <div className="flex items-center justify-center gap-2">
            {errors > 0 && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">
                    {errors} Err
                </span>
            )}
            {warnings > 0 && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                    {warnings} Wrn
                </span>
            )}
        </div>
    );
}

function StatusDot({ category }: { category: CategoryResult }) {
    if (category.stats.errors > 0) return <XCircle className="w-5 h-5 text-rose-500 mx-auto opacity-80" />;
    if (category.stats.warnings > 0) return <AlertTriangle className="w-5 h-5 text-amber-500 mx-auto opacity-80" />;
    return <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto opacity-80" />;
}
