import React from 'react';
import { FullHealthReport } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ResultTableProps {
    results: FullHealthReport[];
}

export function ResultTable({ results }: ResultTableProps) {
    if (results.length === 0) return null;

    return (
        <div className="w-full overflow-hidden border border-gray-200 rounded-lg shadow-sm bg-white">
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200 uppercase tracking-wider text-xs">
                        <tr>
                            <th className="px-6 py-3">Domain</th>
                            <th className="px-6 py-3">SPF</th>
                            <th className="px-6 py-3">DMARC</th>
                            <th className="px-6 py-3">DKIM</th>
                            <th className="px-6 py-3">Problems</th>
                            <th className="px-6 py-3">Blacklist</th>
                            <th className="px-6 py-3">Web</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {results.map((r, idx) => {
                            const probStats = r.categories.problems.stats;
                            const blStats = r.categories.blacklist.stats;
                            const webStats = r.categories.webServer.stats;
                            const spfStats = r.categories.spf.stats;
                            const dmarcStats = r.categories.dmarc.stats;
                            const dkimStats = r.categories.dkim.stats;

                            const renderStatus = (stats: { errors: number, warnings: number, passed: number }) => {
                                if (stats.errors > 0) return <span className="text-red-600 font-bold">Fail</span>;
                                if (stats.warnings > 0) return <span className="text-yellow-600 font-bold">Warn</span>;
                                if (stats.passed > 0) return <span className="text-green-600 font-bold">Pass</span>;
                                return <span className="text-gray-400">N/A</span>;
                            };

                            return (
                                <tr key={`${r.domain}-${idx}`} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-6 py-4 font-bold text-gray-800">{r.domain}</td>

                                    <td className="px-6 py-4">
                                        <span className={cn('px-2 py-1 rounded text-xs font-semibold',
                                            spfStats.errors > 0 ? 'bg-red-100 text-red-700' :
                                                spfStats.warnings > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700')}>
                                            {spfStats.errors > 0 ? 'Invalid' : spfStats.passed > 0 ? 'Valid' : 'Missing'}
                                        </span>
                                    </td>

                                    <td className="px-6 py-4">
                                        <span className={cn('px-2 py-1 rounded text-xs font-semibold',
                                            dmarcStats.errors > 0 ? 'bg-red-100 text-red-700' :
                                                dmarcStats.warnings > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700')}>
                                            {dmarcStats.errors > 0 ? 'Invalid' : dmarcStats.passed > 0 ? 'Valid' : 'Missing'}
                                        </span>
                                    </td>

                                    <td className="px-6 py-4">
                                        {renderStatus(dkimStats)}
                                    </td>

                                    <td className="px-6 py-4">
                                        {probStats.errors > 0 ? (
                                            <span className="text-red-600 font-medium">{probStats.errors} Errors</span>
                                        ) : probStats.warnings > 0 ? (
                                            <span className="text-yellow-600 font-medium">{probStats.warnings} Warns</span>
                                        ) : (
                                            <span className="text-green-600 font-medium">OK</span>
                                        )}
                                    </td>

                                    <td className="px-6 py-4">
                                        {blStats.errors > 0 ? (
                                            <span className="text-red-600 font-bold bg-red-50 px-2 py-1 rounded">{blStats.errors} LISTED</span>
                                        ) : (
                                            <span className="text-green-600 font-medium">Clean</span>
                                        )}
                                    </td>

                                    <td className="px-6 py-4">
                                        <span className={cn('font-medium', webStats.passed > 0 ? 'text-green-600' : 'text-gray-400')}>
                                            {webStats.passed > 0 ? 'Online' : 'Offline'}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
