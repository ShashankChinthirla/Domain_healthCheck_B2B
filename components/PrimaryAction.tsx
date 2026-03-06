import React, { useState } from 'react';
import { FullHealthReport } from '@/lib/types';
import { Copy, Check, ChevronDown, ChevronUp, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PrimaryActionProps {
    report: FullHealthReport;
    updatedSpf: string;
    updatedDmarc: string;
}

export function PrimaryAction({ report, updatedSpf, updatedDmarc }: PrimaryActionProps) {
    if (!report) return null;

    const spfTests = report.categories.spf.tests;
    const dmarcTests = report.categories.dmarc.tests;

    const isSpfError = spfTests.some(t => t.status === 'Error');
    const isDmarcError = dmarcTests.some(t => t.status === 'Error');
    const isSpfWarning = spfTests.some(t => t.status === 'Warning');

    // Priority 1: DMARC Error (Most Critical for Spoofing)
    if (isDmarcError) {
        return (
            <ActionCard
                title="Enable DMARC Protection"
                record={updatedDmarc}
                type="DMARC"
                reason="Without DMARC, anyone can send fake emails pretending to be you. This record tells valid email servers to reject fake emails."
            />
        );
    }

    // Priority 2: SPF Error (Authentication)
    if (isSpfError) {
        return (
            <ActionCard
                title="Fix SPF Record"
                record={updatedSpf}
                type="SPF"
                reason="Your SPF record is invalid or missing. This record lists which mail servers are authorized to send email for your domain."
            />
        );
    }

    // Priority 3: SPF Warning (Soft Fail / Strictness) - Optional per user rules "If insecure -> show fix". 
    // User said "If insecure -> show ONLY most important fix". Warnings are borderline but "SPF [FULL] (Insecure)" was red before. 
    // Let's treat ~all (SoftFail) as actionable if it was flagged as error logic before. 
    // Assuming "Error" captures the critical fails. If simple warning, maybe ignore per "Only ONE button to act". 
    // User said: "Else -> No action needed".

    // Priority 4: No Action
    return (
        <div className="w-full bg-slate-900 border border-emerald-500/30 rounded-lg p-6 flex flex-col items-center justify-center text-center">
            <div className="bg-emerald-500/10 p-3 rounded-full mb-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-100">No Immediate Actions Required</h3>
            <p className="text-slate-400 mt-2 max-w-lg">
                Your domain is configured securely. No critical vulnerabilities were found in SPF or DMARC.
            </p>
        </div>
    );
}

interface ActionCardProps {
    title: string;
    record: string;
    type: string;
    reason: string;
}

function ActionCard({ title, record, type, reason }: ActionCardProps) {
    const [copied, setCopied] = useState(false);
    const [openWhy, setOpenWhy] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(record);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="w-full space-y-4">

            {/* The Green Action Box */}
            <div className="bg-slate-900 border-2 border-emerald-500 rounded-lg p-6 relative shadow-lg shadow-emerald-900/10">
                <span className="absolute -top-3 left-6 bg-emerald-500 text-slate-900 px-3 py-1 rounded text-xs font-bold uppercase tracking-wide">
                    Recommended Fix
                </span>

                <h3 className="text-xl font-bold text-slate-100 mb-4 flex items-center gap-2">
                    {title}
                </h3>

                <div className="bg-slate-950/50 rounded-md border border-slate-700 p-4 font-mono text-sm text-slate-300 break-all relative">
                    {record}

                    <button
                        onClick={handleCopy}
                        className="absolute right-2 top-2 p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors flex items-center gap-2 shadow-sm"
                    >
                        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        <span className="font-bold">{copied ? "Copied" : "Copy"}</span>
                    </button>
                </div>
            </div>

            {/* Why is this important? Collapsible */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-hidden">
                <button
                    onClick={() => setOpenWhy(!openWhy)}
                    className="w-full flex items-center justify-between px-6 py-3 text-slate-400 hover:text-slate-200 transition-colors"
                >
                    <span className="text-sm font-semibold flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Why is this important?
                    </span>
                    {openWhy ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {openWhy && (
                    <div className="px-6 pb-4 pt-0 text-slate-400 text-sm leading-relaxed border-t border-slate-800/50 mt-2">
                        <p className="pt-2">{reason}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
