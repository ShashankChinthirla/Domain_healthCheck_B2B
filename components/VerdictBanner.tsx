import React from 'react';
import { ShieldCheck, ShieldAlert, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FullHealthReport } from '@/lib/types';

interface VerdictBannerProps {
    report: FullHealthReport;
}

export function VerdictBanner({ report }: VerdictBannerProps) {
    if (!report || !report.categories || !report.categories.problems) return null;

    const problemTests = report.categories.problems.tests || [];
    const errorCount = problemTests.filter(p => p.status === 'Error').length;
    const isSecure = errorCount === 0;

    // Content Strategy: Plain English, No Technical Jargon in the Header
    const content = isSecure ? {
        title: "Domain is Secure",
        desc: "Your email configuration is safe. No critical issues found.",
        borderColor: "border-emerald-500",
        iconColor: "text-emerald-500",
        Icon: ShieldCheck
    } : {
        title: "Domain is At Risk",
        desc: "Attackers can likely spoof emails from your domain.",
        borderColor: "border-rose-500",
        iconColor: "text-rose-500",
        Icon: ShieldAlert
    };

    const statusStyles = isSecure ? {
        container: "bg-gradient-to-b from-emerald-950/60 to-black/80 border-emerald-500/30 shadow-[0_0_50px_-12px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/10",
        topHighlight: "bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent",
        iconBox: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[inset_0_0_15px_rgba(16,185,129,0.1)]",
        title: "text-emerald-50",
        badge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.1)]",
        pulse: "bg-emerald-400"
    } : {
        container: "bg-gradient-to-b from-rose-950/60 to-black/80 border-rose-500/30 shadow-[0_0_50px_-12px_rgba(244,63,94,0.15)] ring-1 ring-rose-500/10",
        topHighlight: "bg-gradient-to-r from-transparent via-rose-500/50 to-transparent",
        iconBox: "bg-rose-500/10 text-rose-400 border border-rose-500/20 shadow-[inset_0_0_15px_rgba(244,63,94,0.1)]",
        title: "text-rose-50",
        badge: "bg-rose-500/10 text-rose-300 border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.1)]",
        pulse: "bg-rose-400"
    };

    return (
        <div className={cn(
            "w-full rounded-2xl border backdrop-blur-2xl p-5 relative overflow-hidden group transition-all duration-300",
            statusStyles.container
        )}>
            {/* Premium Top Highlight line */}
            <div className={cn("absolute top-0 left-0 right-0 h-[1px] opacity-70", statusStyles.topHighlight)} />

            {/* Subtle Highlight Overlay */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] to-transparent pointer-events-none" />

            <div className="relative flex items-start gap-4">

                {/* ICON BOX */}
                <div className={cn("p-3 rounded-xl shrink-0 flex items-center justify-center", statusStyles.iconBox)}>
                    <content.Icon className="w-6 h-6" strokeWidth={2} />
                </div>

                {/* TEXT CONTENT */}
                <div className="flex-1 flex flex-col min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                        <h2 className={cn("text-base lg:text-lg font-bold tracking-tight truncate drop-shadow-sm", statusStyles.title)}>
                            {content.title}
                        </h2>
                        {/* COMPACT BADGE */}
                        <div className={cn(
                            "px-2.5 py-1 rounded-md border text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 shrink-0 mt-0.5 backdrop-blur-md",
                            statusStyles.badge
                        )}>
                            <span className="relative flex h-1.5 w-1.5">
                                <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", statusStyles.pulse)}></span>
                                <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", statusStyles.pulse)}></span>
                            </span>
                            <span className="hidden sm:inline-block tracking-wider drop-shadow-sm">{isSecure ? "Secure" : "Action Req"}</span>
                        </div>
                    </div>
                    <p className="text-white/70 text-[13px] font-medium leading-relaxed">
                        {content.desc}
                    </p>
                </div>

            </div>
        </div>
    );
}
