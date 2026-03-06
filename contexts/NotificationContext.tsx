'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface AppNotification {
    id: string;
    type: NotificationType;
    message: string;
    description?: string;
    context?: string;
    timestamp: number;
    read: boolean;
}

interface NotificationContextProps {
    notifications: AppNotification[];
    addNotification: (type: NotificationType, message: string, description?: string, context?: string) => void;
    markAsRead: (id: string) => void;
    markAllAsRead: () => void;
    clearAll: () => void;
    unreadCount: number;
}

const NotificationContext = createContext<NotificationContextProps | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
    const [notifications, setNotifications] = useState<AppNotification[]>([]);

    // Try to load from session storage on mount
    useEffect(() => {
        try {
            const saved = sessionStorage.getItem('app-notifications');
            if (saved) {
                setNotifications(JSON.parse(saved));
            }
        } catch (e) {
            console.error('Failed to load notifications from session storage');
        }
    }, []);

    // Save to session storage when notifications change
    useEffect(() => {
        try {
            sessionStorage.setItem('app-notifications', JSON.stringify(notifications));
        } catch (e) {
            console.error('Failed to save notifications to session storage');
        }
    }, [notifications]);

    const addNotification = (type: NotificationType, message: string, description?: string, context?: string) => {
        const newNotif: AppNotification = {
            id: crypto.randomUUID(),
            type,
            message,
            description,
            context,
            timestamp: Date.now(),
            read: false,
        };

        setNotifications(prev => [newNotif, ...prev]);
    };

    // Listen to global events so the toast wrapper can add notifications outside of React components
    useEffect(() => {
        const handleGlobalEvent = (e: Event) => {
            const customEvent = e as CustomEvent<{ type: NotificationType; message: string; description?: string; context?: string }>;
            addNotification(customEvent.detail.type, customEvent.detail.message, customEvent.detail.description, customEvent.detail.context);
        };

        window.addEventListener('app-notification', handleGlobalEvent);
        return () => window.removeEventListener('app-notification', handleGlobalEvent);
    }, []);

    const markAsRead = (id: string) => {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    };

    const markAllAsRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    const clearAll = () => {
        setNotifications([]);
        sessionStorage.removeItem('app-notifications');
    };

    const unreadCount = notifications.filter(n => !n.read).length;

    return (
        <NotificationContext.Provider value={{
            notifications,
            addNotification,
            markAsRead,
            markAllAsRead,
            clearAll,
            unreadCount
        }}>
            {children}
        </NotificationContext.Provider>
    );
}

export function useNotifications() {
    const context = useContext(NotificationContext);
    if (context === undefined) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
}
