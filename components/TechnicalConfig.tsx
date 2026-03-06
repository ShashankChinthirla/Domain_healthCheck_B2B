import React from 'react';
import { Terminal } from 'lucide-react';
import { RawRecord } from './RawRecord';

interface TechnicalConfigProps {
    domain: string;
    rawSpf: string | null;
    updatedSpf: string;
    rawDmarc: string | null;
    updatedDmarc: string;
    spfSecure: boolean;
    dmarcSecure: boolean;
}

export function TechnicalConfig({ domain, rawSpf, updatedSpf, rawDmarc, updatedDmarc, spfSecure, dmarcSecure }: TechnicalConfigProps) {
    return (
        <div className="w-full animate-in fade-in slide-in-from-bottom-6 duration-700">

            {/* MAIN CARD CONTAINER */}
            <div className="bg-[#09090b] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">

                {/* 1. CARD HEADER (Window Title Style) */}
                <div className="bg-white/[0.02] px-6 py-3 border-b border-white/10 flex items-center gap-3">
                    <div className="bg-white/5 p-1.5 rounded-lg border border-white/10">
                        <Terminal className="w-4 h-4 text-white/80" />
                    </div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">Technical Configuration</h3>
                </div>

                {/* 2. CONTENT BODY */}
                <div className="p-5 space-y-4">

                    {/* SPF SECTION */}
                    <div className="relative">
                        <div className="mb-3 flex items-center justify-between">
                            <h4 className="text-[11px] font-mono uppercase tracking-widest text-indigo-400/80 flex items-center gap-2 font-bold">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                                SPF Record
                            </h4>
                            {spfSecure && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 uppercase tracking-wide">
                                    Secure
                                </span>
                            )}
                        </div>

                        {spfSecure ? (
                            <RawRecord
                                title="Current Configuration"
                                record={rawSpf}
                                type="spf"
                                showCopyButton
                            />
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative">
                                {/* Current (Bad) */}
                                <div className="flex flex-col h-full">
                                    <label className="text-[10px] font-bold text-rose-400 mb-1.5 pl-1 uppercase tracking-wider opacity-80">Current (Insecure)</label>
                                    <RawRecord
                                        title=""
                                        record={rawSpf}
                                        type="spf"
                                        isInvalid
                                        className="bg-[#121214] h-full"
                                    />
                                </div>

                                {/* Recommended (Fix) */}
                                <div className="flex flex-col h-full">
                                    <label className="text-[10px] font-bold text-emerald-400 mb-1.5 pl-1 uppercase tracking-wider opacity-80 flex items-center gap-2">
                                        Recommended Fix
                                        <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                                    </label>
                                    <RawRecord
                                        title=""
                                        record={updatedSpf}
                                        type="spf"
                                        isRecommended
                                        showCopyButton
                                        className="bg-[#121214] h-full"
                                    />
                                </div>

                                {/* CENTERED ARROW INDICATOR */}
                                <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[-10%] z-20">
                                    <div className="w-6 h-6 rounded-full bg-[#09090b] border border-white/20 flex items-center justify-center text-white/40 shadow-xl">
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* DMARC SECTION */}
                    <div className="relative">
                        <div className="mb-3 flex items-center justify-between">
                            <h4 className="text-[11px] font-mono uppercase tracking-widest text-purple-400/80 flex items-center gap-2 font-bold">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
                                DMARC Policy
                            </h4>
                            {dmarcSecure && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 uppercase tracking-wide">
                                    Secure
                                </span>
                            )}
                        </div>

                        {dmarcSecure ? (
                            <RawRecord
                                title="Current Configuration"
                                record={rawDmarc}
                                type="dmarc"
                                showCopyButton
                            />
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative">
                                {/* Current (Bad) */}
                                <div className="flex flex-col h-full">
                                    <label className="text-[10px] font-bold text-rose-400 mb-1.5 pl-1 uppercase tracking-wider opacity-80">Current (Insecure)</label>
                                    <RawRecord
                                        title=""
                                        record={rawDmarc}
                                        type="dmarc"
                                        isInvalid
                                        className="bg-[#121214] h-full"
                                    />
                                </div>

                                {/* Recommended (Fix) */}
                                <div className="flex flex-col h-full">
                                    <label className="text-[10px] font-bold text-emerald-400 mb-1.5 pl-1 uppercase tracking-wider opacity-80 flex items-center gap-2">
                                        Recommended Fix
                                        <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                                    </label>
                                    <RawRecord
                                        title=""
                                        record={updatedDmarc}
                                        type="dmarc"
                                        isRecommended
                                        showCopyButton
                                        className="bg-[#121214] h-full"
                                    />
                                </div>

                                {/* CENTERED ARROW INDICATOR */}
                                <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[-10%] z-20">
                                    <div className="w-6 h-6 rounded-full bg-[#09090b] border border-white/20 flex items-center justify-center text-white/40 shadow-xl">
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}
