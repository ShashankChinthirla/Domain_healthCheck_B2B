import React from 'react';
import { CategoryResult, TestResult } from '@/lib/types';
import { AlertTriangle, XCircle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProblemsSectionProps {
    problems: CategoryResult;
}

export function ProblemsSection({ problems }: ProblemsSectionProps) {
    if (!problems || problems.tests.length === 0) return null;

    const criticals = problems.tests.filter(t => t.status === 'Error');
    const warnings = problems.tests.filter(t => t.status === 'Warning');

    return (
        <div className="w-full space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {criticals.length > 0 && (
                <ProblemList
                    title="Critical Security Issues"
                    items={criticals}
                    type="critical"
                />
            )}

            {warnings.length > 0 && (
                <ProblemList
                    title="Warnings & Recommendations"
                    items={warnings}
                    type="warning"
                />
            )}
        </div>
    );
}

interface ProblemListProps {
    title: string;
    items: TestResult[];
    type: 'critical' | 'warning';
}

function ProblemList({ title, items, type }: ProblemListProps) {
    const isCritical = type === 'critical';

    const theme = isCritical ? {
        textHeader: "text-rose-400",
        icon: XCircle,
        badge: "bg-rose-500/10 text-rose-400 border-rose-500/20",
        recBox: "text-rose-300",
        arrow: "text-rose-400",
        divider: "border-rose-500/10"
    } : {
        textHeader: "text-amber-400",
        icon: AlertTriangle,
        badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        recBox: "text-amber-300",
        arrow: "text-amber-400",
        divider: "border-amber-500/10"
    };

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center gap-2.5 px-1 py-1">
                <theme.icon className={cn("w-4 h-4", theme.textHeader)} />
                <div className="flex items-baseline gap-3">
                    <h3 className={cn("font-bold text-base md:text-lg tracking-tight", theme.textHeader)}>
                        {title}
                    </h3>
                    <span className="text-[10px] font-bold opacity-60 bg-white/5 px-2 py-0.5 rounded-md border border-white/10 tracking-wider">
                        {items.length} ISSUES
                    </span>
                </div>
            </div>

            {/* COMPACT LIST VIEW */}
            <div className="bg-[#09090b]/80 backdrop-blur-md border border-white/10 rounded-xl overflow-hidden divide-y divide-white/5 shadow-2xl">
                {items.map((item, idx) => (
                    <div
                        key={idx}
                        className="relative p-3 hover:bg-white/[0.02] transition-colors duration-200 group/row"
                    >
                        {/* Grid Layout: Category/Name (Left) | Reason (Middle) | Recommendation (Right) */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 items-start md:items-center">

                            {/* Column 1: Category & Name */}
                            <div className="md:col-span-3 flex items-start gap-2.5 min-w-0">
                                <span className={cn(
                                    "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 mt-0.5",
                                    theme.badge
                                )}>
                                    {item.category || 'SYS'}
                                </span>
                                <h4 className="text-[14px] font-semibold text-white tracking-tight leading-tight truncate">
                                    {item.name}
                                </h4>
                            </div>

                            {/* Column 2: Reason Description */}
                            <div className="md:col-span-5 flex flex-col min-w-0">
                                <p className="text-white/60 text-[12px] leading-snug truncate md:whitespace-normal md:line-clamp-2">
                                    {item.reason}
                                </p>
                                {item.info && (
                                    <div className="mt-1">
                                        <span className="text-[10px] font-mono text-white/40 bg-white/5 border border-white/5 px-1 rounded truncate max-w-full inline-block">
                                            {item.info}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Column 3: Recommendation */}
                            <div className="md:col-span-4 flex items-start gap-2 min-w-0">
                                <ArrowRight className={cn("w-3.5 h-3.5 shrink-0 mt-0.5", theme.arrow)} />
                                <div className="space-y-0.5 min-w-0">
                                    <p className="text-[9px] font-bold uppercase text-white/30 tracking-wider">Fix</p>
                                    <p className={cn("text-[12px] font-medium leading-snug break-words", theme.recBox)}>
                                        {item.recommendation}
                                    </p>
                                </div>
                            </div>

                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
