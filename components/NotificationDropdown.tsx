'use client';

import { useState, useRef } from 'react';
import { Bell, CheckCircle2, AlertCircle, Info, AlertTriangle, Trash2, Check } from 'lucide-react';
import { useNotifications, NotificationType } from '@/contexts/NotificationContext';
import { cn } from '@/lib/utils';
import { useOnClickOutside } from '@/lib/hooks';

export function NotificationDropdown() {
    const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll } = useNotifications();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useOnClickOutside(dropdownRef as React.RefObject<HTMLElement>, () => setIsOpen(false));

    const toggleOpen = () => {
        setIsOpen(!isOpen);
    };

    const getIcon = (type: NotificationType) => {
        switch (type) {
            case 'success': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
            case 'error': return <AlertCircle className="w-4 h-4 text-rose-500" />;
            case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-500" />;
            case 'info': return <Info className="w-4 h-4 text-blue-500" />;
        }
    };

    const formatTimestamp = (ms: number) => {
        const date = new Date(ms);
        const now = new Date();
        const diff = now.getTime() - date.getTime();

        // Less than a minute
        if (diff < 60000) return 'Just now';

        // Display full date and time for absolute clarity: e.g. "Mar 1, 2026 • 2:30 PM"
        const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
        const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };

        return `${date.toLocaleDateString(undefined, dateOptions)} • ${date.toLocaleTimeString(undefined, timeOptions)}`;
    };

    return (
        <div className="relative flex items-center h-[42px]" ref={dropdownRef}>
            <button
                onClick={toggleOpen}
                className={cn(
                    "relative flex items-center justify-center p-1 transition-all duration-200 cursor-pointer",
                    isOpen ? "text-white" : "text-white/70 hover:text-white"
                )}
            >
                <Bell className="w-[18px] h-[18px]" />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow-sm ring-1 ring-[#0A0A0B]">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute -right-[82px] top-[calc(100%+20px)] w-80 bg-[#111111] backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_16px_40px_-5px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 origin-top-right ring-1 ring-white/5 z-50 flex flex-col max-h-[400px]">

                    {/* Header */}
                    <div className="p-4 flex items-center justify-between shrink-0 bg-[#111111]">
                        <h3 className="text-[14px] font-semibold tracking-wide text-white/95">Notifications</h3>
                        {notifications.length > 0 && (
                            <div className="flex items-center gap-3">
                                {unreadCount > 0 && (
                                    <button
                                        onClick={markAllAsRead}
                                        className="text-xs font-medium text-white/50 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                                    >
                                        <Check className="w-3 h-3" /> Mark read
                                    </button>
                                )}
                                <button
                                    onClick={clearAll}
                                    className="text-xs font-medium text-white/50 hover:text-rose-400 transition-colors flex items-center gap-1 cursor-pointer"
                                >
                                    <Trash2 className="w-3 h-3" /> Clear
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="h-[1px] w-[calc(100%-24px)] mx-auto bg-white/10 shrink-0" />

                    {/* List */}
                    <div className="overflow-y-auto flex-1 overscroll-contain">
                        {notifications.length === 0 ? (
                            <div className="p-8 flex flex-col items-center justify-center text-center">
                                <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
                                    <Bell className="w-5 h-5 text-white/20" />
                                </div>
                                <p className="text-sm font-medium text-white/60">No notifications</p>
                                <p className="text-xs text-white/40 mt-1">You're all caught up.</p>
                            </div>
                        ) : (
                            <div className="flex flex-col">
                                {notifications.map((notif) => (
                                    <div
                                        key={notif.id}
                                        onClick={() => !notif.read && markAsRead(notif.id)}
                                        className={cn(
                                            "flex gap-3 p-4 border-b border-white/5 transition-colors cursor-pointer",
                                            !notif.read ? "bg-white/[0.03] hover:bg-white/[0.05]" : "hover:bg-white/[0.02]"
                                        )}
                                    >
                                        <div className="shrink-0 mt-0.5">
                                            {getIcon(notif.type)}
                                        </div>
                                        <div className="flex flex-col min-w-0 pr-2">
                                            <p className={cn("text-sm tracking-tight", !notif.read ? "text-white font-medium" : "text-white/80")}>
                                                {notif.message}
                                            </p>
                                            {notif.description && (
                                                <p className="text-[12px] text-white/50 mt-1 mb-1 leading-snug">
                                                    {notif.description}
                                                </p>
                                            )}
                                            <p className="text-[10px] text-white/40 font-medium tracking-wide uppercase mt-1">
                                                {formatTimestamp(notif.timestamp)}
                                            </p>
                                        </div>
                                        {!notif.read && (
                                            <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5 ml-auto" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
