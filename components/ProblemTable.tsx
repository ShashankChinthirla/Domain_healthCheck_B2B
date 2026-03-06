import React, { useState } from 'react';
import { CategoryResult, TestResult } from '@/lib/types';
import { XCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProblemTableProps {
    problems: CategoryResult;
}

export function ProblemTable({ problems }: ProblemTableProps) {
    if (!problems || problems.tests.length === 0) return null;

    return (
        <div className="w-full border border-gray-200 rounded-lg shadow-sm bg-white overflow-hidden mb-12">
            <div className="bg-red-50 px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-bold text-red-800 flex items-center">
                    <XCircle className="w-5 h-5 mr-2" />
                    Identified Problems
                </h3>
                <p className="text-sm text-red-600 mt-1">
                    We found {problems.stats.errors} errors and {problems.stats.warnings} warnings that require attention.
                </p>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-600 font-bold uppercase tracking-wider text-xs border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-3 w-32">Status</th>
                            <th className="px-6 py-3 w-48">Test Name</th>
                            <th className="px-6 py-3">Reason & Analysis</th>
                            <th className="px-6 py-3 w-1/4">Recommendation</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {(() => {
                            // Grouping Logic
                            const grouped = new Map<string, TestResult[]>();
                            problems.tests.forEach(t => {
                                const existing = grouped.get(t.name) || [];
                                grouped.set(t.name, [...existing, t]);
                            });

                            return Array.from(grouped.entries()).map(([name, group], idx) => {
                                // Determine Worst Status
                                const hasError = group.some(t => t.status === 'Error');
                                const status = hasError ? 'Error' : 'Warning';

                                // Consolidate Info
                                const categories = Array.from(new Set(group.map(t => t.category).filter(Boolean))).join(', ');
                                const reasons = Array.from(new Set(group.map(t => t.reason)));
                                const recommendations = Array.from(new Set(group.map(t => t.recommendation)));
                                const infos = Array.from(new Set(group.map(t => t.info)));

                                return (
                                    <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                                        <td className="px-6 py-4 align-top">
                                            <StatusBadge status={status} />
                                        </td>
                                        <td className="px-6 py-4 align-top">
                                            <div className="font-bold text-gray-800">{name}</div>
                                            <div className="text-xs text-gray-400 mt-1 uppercase tracking-wide">{categories}</div>
                                        </td>
                                        <td className="px-6 py-4 align-top">
                                            <div className="space-y-2">
                                                {reasons.map((r, i) => (
                                                    <p key={i} className="text-gray-900 font-medium">
                                                        {reasons.length > 1 && <span className="text-gray-400 mr-2">•</span>}{r}
                                                    </p>
                                                ))}
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {infos.map((info, i) => (
                                                    <span key={i} className="text-xs text-gray-500 font-mono bg-gray-100 px-2 py-1 rounded">
                                                        {info}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 align-top bg-gray-50/30">
                                            <div className="space-y-2">
                                                {recommendations.map((rec, i) => (
                                                    <p key={i} className="text-gray-700 italic flex items-start">
                                                        <span className="mr-2 text-orange-500 font-bold">Fix:</span>
                                                        {rec}
                                                    </p>
                                                ))}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            });
                        })()}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    if (status === 'Error') {
        return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                <XCircle className="w-3 h-3 mr-1" /> Error
            </span>
        );
    }
    if (status === 'Warning') {
        return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
                <AlertTriangle className="w-3 h-3 mr-1" /> Warning
            </span>
        );
    }
    return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Pass
        </span>
    );
}
