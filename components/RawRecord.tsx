import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RawRecordProps {
    record: string | null;
    type: 'spf' | 'dmarc';
    isInvalid?: boolean;
    isRecommended?: boolean;
    title?: string;
    showCopyButton?: boolean;
    className?: string;
}

export function RawRecord({ record, type, isInvalid, isRecommended, title, showCopyButton, className }: RawRecordProps) {
    const [copied, setCopied] = useState(false);
    const isPresent = record && record.length > 0;

    // Default (Secure Current) -> Green
    let statusColor = 'bg-[#1c1c1e] border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.05)]';
    let iconColor = 'text-emerald-500';
    let Icon = CheckCircle2;

    if (isInvalid || !isPresent) {
        // Insecure Current -> Red
        statusColor = 'bg-[#1c1c1e] border-rose-500/30 shadow-[0_0_15px_rgba(244,63,94,0.05)]';
        iconColor = 'text-rose-500';
        Icon = AlertCircle;
    } else if (isRecommended) {
        // Recommended -> Green (Same as secure current)
        statusColor = 'bg-[#1c1c1e] border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.05)]';
        iconColor = 'text-emerald-500';
        Icon = CheckCircle2;
    }

    const handleCopy = () => {
        if (!record) return;
        navigator.clipboard.writeText(record);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className={cn('border rounded-lg p-3.5 relative group transition-all h-full flex flex-col', statusColor, className)}>
            <div className="flex items-start flex-1">
                <div className={cn('mr-3 mt-1', iconColor)}>
                    <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 overflow-hidden pr-20"> {/* INCREASED PADDING FOR COPY BTN */}
                    {title && (
                        <h4 className={cn('text-[10px] font-bold uppercase tracking-wider mb-2 opacity-90', iconColor)}>
                            {title}
                        </h4>
                    )}
                    <code className="text-sm text-slate-300 break-words whitespace-pre-wrap font-mono block leading-7">
                        {isPresent ? record : `No ${type.toUpperCase()} record found`}
                    </code>
                </div>
            </div>

            {showCopyButton && isPresent && (
                <button
                    onClick={handleCopy}
                    className="absolute top-4 right-4 p-2 rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    title="Copy record"
                >
                    {copied ? (
                        <div className="flex items-center text-emerald-400">
                            <Check className="w-4 h-4 mr-1.5" />
                            <span className="text-xs font-bold">Copied</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 group-hover:text-white">
                            <span className="text-xs font-medium hidden group-hover:block">Copy</span>
                            <Copy className="w-4 h-4" />
                        </div>
                    )}
                </button>
            )}
        </div>
    );
}
