export interface UserSettings {
    displayName?: string;
    emailClient: 'gmail' | 'outlook' | 'default';
    messageTemplate: string;
    senderName: string;
    senderTitle: string;
    senderPhone: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
    displayName: '',
    emailClient: 'default',
    messageTemplate: 'Hello,\n\nWe have identified critical security vulnerabilities in your domain\'s email infrastructure (SPF/DKIM/DMARC) which puts your domain at high risk of being spoofed.\n\nPlease review these issues and implement the necessary DNS records immediately.\n\nBest regards,\n[Your Name]',
    senderName: '',
    senderTitle: '',
    senderPhone: ''
};
