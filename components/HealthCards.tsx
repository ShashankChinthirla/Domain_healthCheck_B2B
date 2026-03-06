import React from 'react';
import { CategoryResult } from '@/lib/types';
import { XCircle, AlertCircle, CheckCircle2, ShieldAlert, Server, Globe, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HealthSummaryProps {
    categories: CategoryResult[];
    onCategoryClick?: (category: string) => void;
}

export function HealthSummary({ categories = [], onCategoryClick }: HealthSummaryProps) {
    if (!categories || categories.length === 0) return null;

    const getIcon = (catName: string) => {
        switch (catName) {
            case 'Problems': return <XCircle className="w-5 h-5 text-slate-400 group-hover:text-white" />;
            case 'Blacklist': return <ShieldAlert className="w-5 h-5 text-slate-400 group-hover:text-white" />;
            case 'DNS': return <Activity className="w-5 h-5 text-slate-400 group-hover:text-white" />;
            case 'SPF': return <ShieldAlert className="w-5 h-5 text-slate-400 group-hover:text-white" />;
            case 'DMARC': return <ShieldAlert className="w-5 h-5 text-slate-400 group-hover:text-white" />;
            case 'DKIM': return <ShieldAlert className="w-5 h-5 text-slate-400 group-hover:text-white" />;
            case 'Web Server': return <Globe className="w-5 h-5 text-slate-400 group-hover:text-white" />;
            case 'SMTP': return <Server className="w-5 h-5 text-slate-400 group-hover:text-white" />;
            default: return <Activity className="w-5 h-5 text-slate-400 group-hover:text-white" />;
        }
    };

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {categories.map((cat) => {
                // Determine Status Theme
                let theme = {
                    bg: "bg-gradient-to-br from-emerald-950/30 to-emerald-900/10 hover:from-emerald-900/40",
                    border: "border-emerald-500/20 group-hover:border-emerald-500/40",
                    iconColor: "text-emerald-400",
                    glow: "shadow-[0_0_20px_-5px_rgba(16,185,129,0.1)]",
                    badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                };

                if (cat.stats.errors > 0) {
                    theme = {
                        bg: "bg-gradient-to-br from-rose-950/30 to-rose-900/10 hover:from-rose-900/40",
                        border: "border-rose-500/20 group-hover:border-rose-500/40",
                        iconColor: "text-rose-400",
                        glow: "shadow-[0_0_20px_-5px_rgba(244,63,94,0.1)]",
                        badge: "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    };
                } else if (cat.stats.warnings > 0) {
                    theme = {
                        bg: "bg-gradient-to-br from-amber-950/30 to-amber-900/10 hover:from-amber-900/40",
                        border: "border-amber-500/20 group-hover:border-amber-500/40",
                        iconColor: "text-amber-400",
                        glow: "shadow-[0_0_20px_-5px_rgba(245,158,11,0.1)]",
                        badge: "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    };
                }

                return (
                    <div
                        key={cat.category}
                        onClick={() => onCategoryClick?.(cat.category)}
                        className={cn(
                            "rounded-2xl border backdrop-blur-sm p-5 cursor-pointer transition-all duration-300 group relative overflow-hidden",
                            theme.bg,
                            theme.border,
                            theme.glow
                        )}
                    >
                        {/* Subtle Noise Texture */}
                        <div className="absolute inset-0 bg-white/[0.02] pointer-events-none opacity-50" />

                        <div className="flex flex-col items-center text-center relative z-10">
                            {/* Icon */}
                            <div className={cn("mb-3 p-3 rounded-xl bg-white/5 border border-white/5 transition-transform group-hover:scale-110", theme.iconColor)}>
                                {getIcon(cat.category)}
                            </div>

                            {/* Title */}
                            <h3 className="font-bold text-slate-200 text-xs uppercase tracking-widest mb-4 group-hover:text-white transition-colors">
                                {cat.category}
                            </h3>

                            {/* Status Badge */}
                            <div className={cn(
                                "px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wide flex items-center gap-2",
                                theme.badge
                            )}>
                                {cat.stats.errors > 0 ? (
                                    <>
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500"></span>
                                        </span>
                                        {cat.stats.errors} Issues
                                    </>
                                ) : cat.stats.warnings > 0 ? (
                                    <>
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                                        {cat.stats.warnings} Warnings
                                    </>
                                ) : (
                                    <>
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                                        Secure
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
