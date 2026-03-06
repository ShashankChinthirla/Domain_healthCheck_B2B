import React from 'react';
import { CategoryResult } from '@/lib/types';
import { AlertCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProblemSummaryTableProps {
    problems: CategoryResult;
    domain: string;
}

export function ProblemSummaryTable({ problems, domain }: ProblemSummaryTableProps) {
    if (!problems || problems.tests.length === 0) return null;

    const priorityMap: Record<string, number> = {
        'DNS': 1, 'MX': 2, 'SPF': 3, 'DMARC': 4, 'DKIM': 5,
        'Blacklist': 6, 'SMTP': 7, 'Web Server': 8
    };

    // Filter and Sort Logic
    // 1. Deduplicate: Hide "BIMI Compatibility" (DNS/SPF) in favor of DMARC "BIMI Readiness"
    // EXCEPT: We now explicitly want the MX/SPF warnings to show up if promoted to Error.
    // The previous logic filtered 'BIMI Compatibility' out.
    // BUT the new requirement is to SHOW them as Errors.
    // "Add SPF category row... Add MX category row..." matches MxToolbox.
    // So we should REMOVE the filter that hides 'BIMI Compatibility'.

    // 2. Sort by Category Priority
    const sortedProblems = [...problems.tests]
        // .filter(t => t.name !== 'BIMI Compatibility') <-- REMOVED FILTER to allow SPF/MX duplicates as requested
        .filter(t => t.status !== 'Pass') // Strict error/warning only
        .sort((a, b) => {
            const catA = priorityMap[a.category!] || 99;
            const catB = priorityMap[b.category!] || 99;
            return catA - catB;
        });

    if (sortedProblems.length === 0) return null;

    return (
        <div className="w-full bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden mb-8">
            <table className="w-full text-left text-sm">
                <thead className="bg-white text-gray-500 border-b border-gray-100">
                    <tr>
                        <th className="px-6 py-3 font-semibold w-32 uppercase text-xs tracking-wider">Category</th>
                        <th className="px-6 py-3 font-semibold w-1/3 uppercase text-xs tracking-wider">Host</th>
                        <th className="px-6 py-3 font-semibold uppercase text-xs tracking-wider">Result</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {sortedProblems.map((test, idx) => {
                        const category = test.category || 'UNK';
                        const host = test.host || domain;

                        // Result: Human readable message. Fallback to test.reason if result is missing.
                        const resultText = test.result || test.reason || test.name;

                        const isError = test.status === 'Error';

                        return (
                            <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-3 align-top font-bold text-gray-700 uppercase text-xs">
                                    {category}
                                </td>
                                <td className="px-6 py-3 align-top text-gray-600 font-mono text-xs">
                                    {host}
                                </td>
                                <td className="px-6 py-3 align-top">
                                    <div className="flex items-center gap-2">
                                        {isError ? (
                                            <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                                        ) : (
                                            <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                                        )}
                                        <span className={cn(
                                            "font-medium",
                                            isError ? "text-red-700" : "text-yellow-700"
                                        )}>
                                            {resultText}
                                        </span>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
