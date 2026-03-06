import React, { useRef } from 'react';
import { Search, Loader2, Upload, ChevronRight, Lock } from 'lucide-react';

interface HeroProps {
    domainInput: string;
    setDomainInput: (val: string) => void;
    handleCheck: () => void;
    handleKeyDown: (e: React.KeyboardEvent) => void;
    loading: boolean;
    error: string | null;
    onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    isAuthenticated: boolean;
    onRequireLogin: () => void;
}

import { ParticleBackground } from './ParticleBackground';

export function Hero({
    domainInput,
    setDomainInput,
    handleCheck,
    handleKeyDown,
    loading,
    error,
    onFileUpload,
    isAuthenticated,
    onRequireLogin
}: HeroProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const executeAction = (action: () => void) => {
        if (!isAuthenticated) {
            onRequireLogin();
        } else {
            action();
        }
    };

    return (
        <section className="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center px-4 w-full relative overflow-hidden pt-20">

            {/* --- STRICT ACTION: PURE BLACK BACKGROUND WITH PARTICLES --- */}
            <ParticleBackground />

            {/* 1. Headline - Chrome/Silver Gradient */}
            <div className="relative z-10 text-center mb-6">
                <span className="inline-block py-0.5 px-2.5 rounded-full bg-white/5 border border-white/10 text-[11px] font-medium text-white/60 mb-5 backdrop-blur-md uppercase tracking-wider">
                    Passive Domain Analysis v2.0
                </span>
                <h1 className="text-4xl md:text-6xl font-semibold tracking-tighter pb-2 drop-shadow-2xl flex flex-col items-center gap-1">
                    <span className="text-transparent bg-clip-text bg-gradient-to-b from-white via-[#c7c7c7] to-[#525252]">
                        Email security.
                    </span>
                    <span className="text-white/40">
                        Re-imagined.
                    </span>
                </h1>
            </div>

            {/* 2. Subtext */}
            <p className="text-base md:text-lg text-[#86868b] font-medium text-center mb-10 max-w-lg leading-relaxed relative z-10">
                Advanced SPF, DMARC, and DNS diagnostics. <br className="hidden sm:block" />
                Designed for professionals.
            </p>

            {/* 3. SEARCH BOX (Apple Dark Surface) */}
            <div className="w-full max-w-lg z-10 flex flex-col items-center">

                {/* Visual Container */}
                <div className="relative flex items-center w-full bg-[#18181b]/90 backdrop-blur-2xl border border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.04)] rounded-full p-1.5 transition-all duration-300 focus-within:bg-[#1f1f23] focus-within:border-white/40 focus-within:shadow-[0_0_40px_rgba(255,255,255,0.08)] focus-within:scale-[1.01]">

                    {/* Icon */}
                    <div className="pl-4 pr-3 text-white/40">
                        <Search className="w-4 h-4" />
                    </div>

                    {/* Input */}
                    <input
                        type="text"
                        className="w-full bg-transparent border-none text-white placeholder-white/20 text-base font-medium px-2 py-3 focus:ring-0 focus:outline-none tracking-tight"
                        placeholder="domain.com"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') executeAction(handleCheck);
                        }}
                        disabled={loading}
                        autoFocus
                    />

                    {/* Button - High Contrast Pill */}
                    <button
                        onClick={() => executeAction(handleCheck)}
                        disabled={loading || !domainInput}
                        className="mr-0.5 pl-4 pr-2 py-2.5 bg-white hover:bg-[#e5e5e5] text-black font-semibold text-xs md:text-sm rounded-full transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 group/btn"
                    >
                        {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                        ) : (
                            <>
                                {isAuthenticated ? 'Analyze' : 'Sign in to Analyze'}
                                {isAuthenticated ? (
                                    <ChevronRight className="w-3.5 h-3.5 text-black/60 group-hover/btn:translate-x-0.5 transition-transform" />
                                ) : (
                                    <Lock className="w-3.5 h-3.5 text-black/60" />
                                )}
                            </>
                        )}
                    </button>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="mt-6 text-center w-full animate-in fade-in slide-in-from-top-2">
                        <span className="inline-block px-4 py-2 bg-red-500/10 text-red-300 text-sm font-medium rounded-lg border border-red-500/20 backdrop-blur-md">
                            {error}
                        </span>
                    </div>
                )}

                {/* Subtle File Upload */}
                <div className="mt-8 flex justify-center transition-opacity duration-500">
                    <button
                        onClick={() => executeAction(() => fileInputRef.current?.click())}
                        className="text-xs font-medium text-white/40 hover:text-white/80 flex items-center gap-2 transition-colors uppercase tracking-widest cursor-pointer"
                    >
                        <Upload className="w-3 h-3" /> or upload list
                    </button>
                    <input type="file" ref={fileInputRef} accept=".xlsx, .xls" className="hidden" onChange={onFileUpload} />
                </div>

            </div>
        </section>
    );
}
