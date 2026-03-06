import { toast as sonnerToast } from 'sonner';
import { NotificationType } from '@/contexts/NotificationContext';

const dispatchNotification = (type: NotificationType, message: string, description?: string, context?: string) => {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('app-notification', {
                detail: { type, message, description, context }
            })
        );
    }
};

export const toast = {
    ...sonnerToast,
    success: (message: string, data?: { description?: string; context?: string } & Record<string, any>) => {
        const { context, ...rest } = data || {};
        dispatchNotification('success', message, rest.description, context);
        return sonnerToast.success(message, rest);
    },
    error: (message: string, data?: { description?: string; context?: string } & Record<string, any>) => {
        const { context, ...rest } = data || {};
        dispatchNotification('error', message, rest.description, context);
        return sonnerToast.error(message, rest);
    },
    info: (message: string, data?: { description?: string; context?: string } & Record<string, any>) => {
        const { context, ...rest } = data || {};
        dispatchNotification('info', message, rest.description, context);
        return sonnerToast.info(message, rest);
    },
    warning: (message: string, data?: { description?: string; context?: string } & Record<string, any>) => {
        const { context, ...rest } = data || {};
        dispatchNotification('warning', message, rest.description, context);
        return sonnerToast.warning(message, rest);
    }
};
