'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { Loader2, ArrowLeft, CheckCircle2, Shield, Plus, Trash2, X, Search } from 'lucide-react';
import { getUserSettings, saveUserSettings } from '@/app/settings/actions';
import { getUserIntegrations, addIntegration, removeIntegration, IntegrationDTO } from '@/app/settings/integrations-actions';
import { UserSettings, DEFAULT_SETTINGS } from '@/app/settings/types';
import { isAdmin, getAdmins, addAdmin, removeAdmin, AdminUser } from '@/lib/roles';
import { toast } from '@/lib/toast';

export default function SettingsPage() {
    const [user, setUser] = useState<User | null | undefined>(undefined);
    const [isUserAdmin, setIsUserAdmin] = useState(false);
    const router = useRouter();

    const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
    const [initialSettings, setInitialSettings] = useState<UserSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState({ text: '', isError: false });

    // Admin array state
    const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
    const [newAdminEmails, setNewAdminEmails] = useState<string[]>([]);
    const [adminInputValue, setAdminInputValue] = useState('');
    const [isManagingAdmins, setIsManagingAdmins] = useState(false);
    // Removed unused isAccessMgmtOpen

    // Integrations state
    const [integrations, setIntegrations] = useState<IntegrationDTO[]>([]);
    const [integrationLabel, setIntegrationLabel] = useState('');
    const [integrationApiKey, setIntegrationApiKey] = useState('');
    const [isManagingIntegrations, setIsManagingIntegrations] = useState(false);
    const [activeTab, setActiveTab] = useState('general');

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser === null) {
                router.push('/');
                return;
            }
            setUser(currentUser);

            try {
                const token = await currentUser.getIdToken();
                const adminStatus = await isAdmin(currentUser.email);
                setIsUserAdmin(adminStatus);

                const res = await getUserSettings(token);
                if (res.success && res.settings) {
                    setSettings(res.settings);
                    setInitialSettings(res.settings);
                }

                if (adminStatus) {
                    const adminsList = await getAdmins(token);
                    setAdminUsers(adminsList);
                }

                const intsRes = await getUserIntegrations(token);
                if (intsRes.success && intsRes.integrations) {
                    setIntegrations(intsRes.integrations);
                }
            } catch (err) {
                console.error("Auth state error:", err);
            } finally {
                setIsLoading(false);
            }
        });

        return () => unsubscribe();
    }, [router]);

    const handleSave = async () => {
        if (!user || !user.email) return;

        setIsSaving(true);
        setSaveMessage({ text: '', isError: false });

        const token = await user.getIdToken();
        const res = await saveUserSettings(token, settings);

        if (res.success) {
            setInitialSettings(settings); // Changes are now saved, reset baseline
            toast.success('Settings saved successfully!');
            // Dispatch event to trigger navbar to update its display name
            window.dispatchEvent(new Event('user-settings-updated'));
        } else {
            toast.error('Failed to save settings.');
        }

        setIsSaving(false);

        // Clear success message after 3 seconds
        setTimeout(() => {
            setSaveMessage({ text: '', isError: false });
        }, 3000);
    };

    const handleAddAdmin = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        const emailsToProcess = [...newAdminEmails];
        // If there's an active typed email not yet tokenized, try to add it
        if (adminInputValue.trim()) {
            const val = adminInputValue.trim().toLowerCase();
            // Basic email regex before processing
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) && !emailsToProcess.includes(val)) {
                emailsToProcess.push(val);
            }
        }

        if (emailsToProcess.length === 0 || !user?.email) return;

        setIsManagingAdmins(true);
        let successCount = 0;
        let lastError = '';

        const token = await user.getIdToken();
        for (const email of emailsToProcess) {
            const res = await addAdmin(email, token);
            if (res.success) {
                successCount++;
            } else {
                lastError = res.message || `Failed to add ${email}.`;
            }
        }

        if (successCount > 0) {
            toast.success(`Successfully added ${successCount} admin(s).`);
            setNewAdminEmails([]);
            setAdminInputValue('');
            const adminsList = await getAdmins(token);
            setAdminUsers(adminsList);
        } else if (lastError) {
            toast.error(lastError);
        }

        setIsManagingAdmins(false);
    };

    const handleEmailInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === ',') {
            e.preventDefault();
            const val = adminInputValue.trim().toLowerCase();
            if (val && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
                if (!newAdminEmails.includes(val)) {
                    setNewAdminEmails([...newAdminEmails, val]);
                }
                setAdminInputValue('');
            }
        } else if (e.key === 'Backspace' && !adminInputValue && newAdminEmails.length > 0) {
            e.preventDefault();
            // Remove the last token on backspace if input is empty
            const lastEmail = newAdminEmails[newAdminEmails.length - 1];
            setNewAdminEmails(newAdminEmails.slice(0, -1));
            setAdminInputValue(lastEmail);
        }
    };

    const removeEmailToken = (email: string) => {
        setNewAdminEmails(newAdminEmails.filter(e => e !== email));
    };

    const handleRemoveAdmin = async (emailToRemove: string) => {
        if (!user?.email) return;
        if (!window.confirm(`Are you sure you want to revoke admin access for ${emailToRemove}?`)) return;

        setIsManagingAdmins(true);
        const token = await user.getIdToken();
        const res = await removeAdmin(emailToRemove, token);

        if (res.success) {
            toast.success('Admin removed successfully.');
            const adminsList = await getAdmins(token);
            setAdminUsers(adminsList);
        } else {
            toast.error(res.message || 'Failed to remove admin.');
        }
        setIsManagingAdmins(false);
    };

    const handleAddIntegration = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user?.email || !integrationLabel.trim() || !integrationApiKey.trim()) return;

        setIsManagingIntegrations(true);
        const token = await user.getIdToken();
        const res = await addIntegration(token, 'cloudflare', integrationLabel.trim(), integrationApiKey.trim());

        if (res.success) {
            toast.success('Integration added successfully.');
            setIntegrationLabel('');
            setIntegrationApiKey('');
            const token = await user.getIdToken();
            const intsRes = await getUserIntegrations(token);
            if (intsRes.success && intsRes.integrations) setIntegrations(intsRes.integrations);
        } else {
            toast.error(res.error || 'Failed to add integration.');
        }
        setIsManagingIntegrations(false);
    };

    const handleRemoveIntegration = async (id: string, label: string) => {
        if (!user?.email) return;
        if (!window.confirm(`Are you sure you want to remove the integration "${label}"?`)) return;

        setIsManagingIntegrations(true);
        const token = await user.getIdToken();
        const res = await removeIntegration(token, id);

        if (res.success) {
            toast.success('Integration removed.');
            setIntegrations(integrations.filter(i => i.id !== id));
        } else {
            toast.error(res.error || 'Failed to remove integration.');
        }
        setIsManagingIntegrations(false);
    };

    if (user === undefined || isLoading) {
        return (
            <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-white/50 animate-spin" />
            </div>
        );
    }

    if (!user) return null;

    const hasUnsavedChanges = initialSettings && JSON.stringify(settings) !== JSON.stringify(initialSettings);
    const showPill = hasUnsavedChanges || isSaving || !!saveMessage.text;

    return (
        <div className="min-h-screen bg-[#09090b] text-white selection:bg-blue-500/30 font-sans pb-32">
            <Navbar />

            <main className="w-[calc(100%-3rem)] max-w-7xl mx-auto px-6 pt-24 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="mb-8 flex items-center justify-between">
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-1">
                        {isUserAdmin ? 'Account Settings' : 'Personal Profile'}
                    </h1>
                    <button
                        onClick={() => router.push('/dashboard')}
                        className="group flex items-center gap-2 text-[14px] font-medium text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    >
                        <ArrowLeft size={16} /> Back to Dashboard
                    </button>
                </div>

                <div className="flex flex-col md:flex-row gap-8">
                    {/* Sidebar */}
                    <aside className="w-full md:w-64 shrink-0 flex flex-col gap-1 md:sticky md:top-24 self-start">
                        <div className="relative mb-4">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                            <input
                                type="text"
                                placeholder="Search..."
                                className="w-full bg-[#111] border border-white/10 rounded-lg pl-9 pr-3 py-2 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
                            />
                        </div>

                        <button onClick={() => setActiveTab('general')} className={`text-left px-3 py-2 rounded-md text-[14px] transition-colors cursor-pointer ${activeTab === 'general' ? 'bg-[#222] text-white font-medium' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                            General
                        </button>
                        <button onClick={() => setActiveTab('integrations')} className={`text-left px-3 py-2 rounded-md text-[14px] transition-colors cursor-pointer ${activeTab === 'integrations' ? 'bg-[#222] text-white font-medium' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                            Authentication
                        </button>
                        {isUserAdmin && (
                            <>
                                <button onClick={() => setActiveTab('access')} className={`text-left px-3 py-2 rounded-md text-[14px] transition-colors cursor-pointer ${activeTab === 'access' ? 'bg-[#222] text-white font-medium' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                                    Access Control
                                </button>
                                <button onClick={() => setActiveTab('outreach')} className={`text-left px-3 py-2 rounded-md text-[14px] transition-colors cursor-pointer ${activeTab === 'outreach' ? 'bg-[#222] text-white font-medium' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
                                    Outreach Defaults
                                </button>
                            </>
                        )}
                    </aside>

                    {/* Content */}
                    <div className="flex-1 min-w-0">

                        {activeTab === 'general' && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div className="border border-white/10 rounded-xl bg-[#09090b] shadow-sm overflow-hidden">
                                    <div className="p-6">
                                        <h2 className="text-[18px] font-semibold text-white mb-2">Email Address</h2>
                                        <p className="text-[14px] text-white/50 mb-4">Your login email address.</p>
                                        <input
                                            type="text"
                                            value={user.email || ''}
                                            disabled
                                            className="w-full max-w-md h-10 bg-[#111] border border-white/10 rounded-lg px-3 text-[14px] text-white/50 cursor-not-allowed"
                                        />
                                    </div>
                                    <div className="px-6 py-3 bg-[#0a0a0c] border-t border-white/10 text-[13px] text-white/40 flex items-center justify-between">
                                        <span>Used for account verification and access management.</span>
                                    </div>
                                </div>

                                <div className="border border-white/10 rounded-xl bg-[#09090b] shadow-sm overflow-hidden">
                                    <div className="p-6">
                                        <h2 className="text-[18px] font-semibold text-white mb-2">Display Name</h2>
                                        <p className="text-[14px] text-white/50 mb-4">Please enter your full name, or a display name you are comfortable with.</p>
                                        <input
                                            type="text"
                                            value={settings.displayName}
                                            onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
                                            className="w-full max-w-md h-10 bg-[#111] border border-white/10 rounded-lg px-3 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
                                            placeholder="e.g. John Doe"
                                        />
                                    </div>
                                    <div className="px-6 py-3 bg-[#0a0a0c] border-t border-white/10 text-[13px] text-white/40 flex items-center justify-between">
                                        <span>Please use 32 characters at maximum.</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'integrations' && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div className="border border-white/10 rounded-xl bg-[#09090b] shadow-sm overflow-hidden">
                                    <div className="p-6">
                                        <h2 className="text-[18px] font-semibold text-white mb-2">API Integrations</h2>
                                        <p className="text-[14px] text-white/50 mb-6">Securely connect DNS providers to sync domains and apply automated fixes. Keys are AES-256 encrypted.</p>

                                        <form onSubmit={handleAddIntegration} className="mb-8">
                                            <h3 className="text-[14px] font-semibold text-white mb-4">Add New Connection</h3>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                                                <div className="space-y-1.5">
                                                    <label className="text-[13px] font-medium text-white/60">Provider</label>
                                                    <select disabled className="w-full h-10 bg-[#111] border border-white/10 rounded-lg px-3 text-[14px] text-white/50 focus:outline-none appearance-none cursor-not-allowed">
                                                        <option value="cloudflare">Cloudflare API Token</option>
                                                    </select>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-[13px] font-medium text-white/60">Connection Label</label>
                                                    <input
                                                        type="text"
                                                        value={integrationLabel}
                                                        onChange={(e) => setIntegrationLabel(e.target.value)}
                                                        placeholder="e.g. My Business Cloudflare"
                                                        disabled={isManagingIntegrations}
                                                        required
                                                        className="w-full h-10 bg-[#111] border border-white/10 rounded-lg px-3 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
                                                    />
                                                </div>
                                                <div className="space-y-1.5 sm:col-span-2">
                                                    <label className="text-[13px] font-medium text-white/60">API Token</label>
                                                    <div className="flex flex-col sm:flex-row gap-3">
                                                        <input
                                                            type="password"
                                                            value={integrationApiKey}
                                                            onChange={(e) => setIntegrationApiKey(e.target.value)}
                                                            placeholder="Paste secure API token..."
                                                            disabled={isManagingIntegrations}
                                                            required
                                                            className="flex-1 min-w-0 h-10 bg-[#111] border border-white/10 rounded-lg px-3 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
                                                        />
                                                        <button
                                                            type="submit"
                                                            disabled={isManagingIntegrations || !integrationLabel.trim() || !integrationApiKey.trim()}
                                                            className="h-10 px-6 flex items-center justify-center gap-2 bg-white hover:bg-zinc-200 text-black font-semibold text-[14px] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 cursor-pointer"
                                                        >
                                                            {isManagingIntegrations ? <Loader2 className="w-4 h-4 animate-spin text-black/50" /> : <Plus className="w-4 h-4" />}
                                                            Connect
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </form>

                                        <div className="w-full h-px bg-white/10 mb-8" />

                                        <h3 className="text-[14px] font-semibold text-white mb-4">Active Integrations</h3>
                                        <div className="flex flex-col gap-3">
                                            {integrations.length === 0 ? (
                                                <div className="py-6 text-center text-[13px] text-white/30 border border-dashed border-white/10 rounded-xl bg-[#111]">
                                                    No active integrations connected.
                                                </div>
                                            ) : (
                                                integrations.map(int => (
                                                    <div key={int.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-[#111] border border-white/10 rounded-xl">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0">
                                                                <Shield className="w-5 h-5 text-black" />
                                                            </div>
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="text-[15px] font-semibold text-white flex items-center gap-2">
                                                                    {int.label}
                                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/10 text-white/70">Cloudflare</span>
                                                                </span>
                                                                <span className="text-[13px] text-white/40 truncate">Added {new Date(int.createdAt).toLocaleDateString()}</span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={async (e) => { e.preventDefault(); handleRemoveIntegration(int.id, int.label); }}
                                                            disabled={isManagingIntegrations}
                                                            className="text-[13px] font-medium text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-4 py-2 rounded-md transition-colors border border-rose-500/20 cursor-pointer"
                                                        >
                                                            Disconnect
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {isUserAdmin && activeTab === 'access' && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div className="border border-white/10 rounded-xl bg-[#09090b] shadow-sm overflow-hidden">
                                    <div className="p-6">
                                        <h2 className="text-[18px] font-semibold text-white mb-2">Access Management</h2>
                                        <p className="text-[14px] text-white/50 mb-6">Control which accounts have root authorization to access this dashboard.</p>

                                        <form onSubmit={handleAddAdmin} className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full max-w-2xl mb-8">
                                            <div
                                                className="flex-1 w-full min-h-10 bg-[#111] border border-white/10 rounded-lg p-1.5 flex flex-wrap items-center gap-1.5 focus-within:border-white/20 transition-colors cursor-text"
                                                onClick={() => document.getElementById('admin-email-input')?.focus()}
                                            >
                                                {newAdminEmails.map(email => (
                                                    <div key={email} className="flex items-center gap-1 bg-white/10 border border-white/10 px-2 py-1 rounded-md text-[13px] font-medium text-white shadow-sm">
                                                        {email}
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); removeEmailToken(email); }}
                                                            className="text-zinc-400 hover:text-white transition-colors ml-1 cursor-pointer"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                ))}
                                                <input
                                                    id="admin-email-input"
                                                    type="text"
                                                    value={adminInputValue}
                                                    onChange={(e) => setAdminInputValue(e.target.value)}
                                                    onKeyDown={handleEmailInputKeyDown}
                                                    placeholder={newAdminEmails.length === 0 ? "Invite users by email..." : ""}
                                                    className="flex-1 min-w-[180px] bg-transparent border-none text-[14px] text-white focus:outline-none focus:ring-0 px-2 py-1"
                                                    disabled={isManagingAdmins}
                                                />
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={isManagingAdmins || (newAdminEmails.length === 0 && !adminInputValue.trim())}
                                                className="h-10 px-5 w-full sm:w-auto flex items-center justify-center gap-2 bg-white hover:bg-zinc-200 text-black font-semibold text-[14px] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap cursor-pointer"
                                            >
                                                {isManagingAdmins ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send Invite'}
                                            </button>
                                        </form>

                                        <h3 className="text-[14px] font-semibold text-white mb-4">Active Administrators</h3>
                                        <div className="bg-[#111] border border-white/10 rounded-xl overflow-hidden shadow-inner max-h-[300px] overflow-y-auto mb-2">
                                            <ul className="divide-y divide-white/5">
                                                {adminUsers.map((admin) => (
                                                    <li key={admin.email} className="flex items-center justify-between p-4 hover:bg-white/5 transition-colors">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center border border-white/10 text-zinc-300 shrink-0">
                                                                {admin.email.charAt(0).toUpperCase()}
                                                            </div>
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="text-[14px] font-bold text-white truncate">{admin.email}</span>
                                                                <span className="text-[12px] text-zinc-500 truncate">Added by {admin.addedBy}</span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveAdmin(admin.email)}
                                                            disabled={isManagingAdmins || admin.email === 'shashankshashankc39@gmail.com' || admin.email === user?.email}
                                                            className="p-2 text-rose-500/50 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                                                            title="Revoke Access"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </li>
                                                ))}
                                                {adminUsers.length === 0 && (
                                                    <li className="p-6 text-center text-zinc-500 text-[14px]">No active administrators found.</li>
                                                )}
                                            </ul>
                                        </div>
                                    </div>
                                    <div className="px-6 py-3 bg-[#0a0a0c] border-t border-white/10 text-[13px] text-white/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                        <span>Administrators have full access to view, edit, and initiate remediation scans.</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {isUserAdmin && activeTab === 'outreach' && (
                            <div className="space-y-6 animate-in fade-in duration-300">
                                <div className="border border-white/10 rounded-xl bg-[#09090b] shadow-sm overflow-hidden">
                                    <div className="p-6">
                                        <h2 className="text-[18px] font-semibold text-white mb-2">Signature Details</h2>
                                        <p className="text-[14px] text-white/50 mb-6">Personal details appended to custom outreach emails for admins.</p>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
                                            <div className="space-y-1.5 flex flex-col">
                                                <label className="text-[13px] font-medium text-white/60">Full Name</label>
                                                <input
                                                    type="text"
                                                    value={settings.senderName}
                                                    onChange={(e) => setSettings({ ...settings, senderName: e.target.value })}
                                                    className="w-full h-10 bg-[#111] border border-white/10 rounded-lg px-3 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
                                                    placeholder="e.g. Security Admin"
                                                />
                                            </div>
                                            <div className="space-y-1.5 flex flex-col">
                                                <label className="text-[13px] font-medium text-white/60">Job Role</label>
                                                <input
                                                    type="text"
                                                    value={settings.senderTitle}
                                                    onChange={(e) => setSettings({ ...settings, senderTitle: e.target.value })}
                                                    className="w-full h-10 bg-[#111] border border-white/10 rounded-lg px-3 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
                                                    placeholder="e.g. Head of IT"
                                                />
                                            </div>
                                            <div className="space-y-1.5 flex flex-col md:col-span-2">
                                                <label className="text-[13px] font-medium text-white/60">Contact Number</label>
                                                <input
                                                    type="text"
                                                    value={settings.senderPhone}
                                                    onChange={(e) => setSettings({ ...settings, senderPhone: e.target.value })}
                                                    className="w-full max-w-sm h-10 bg-[#111] border border-white/10 rounded-lg px-3 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors"
                                                    placeholder="e.g. +1 (555) 000-0000"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="px-6 py-3 bg-[#0a0a0c] border-t border-white/10 text-[13px] text-white/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                        <span>This signature will be formatted properly below your template.</span>
                                    </div>
                                </div>

                                <div className="border border-white/10 rounded-xl bg-[#09090b] shadow-sm overflow-hidden">
                                    <div className="p-6">
                                        <h2 className="text-[18px] font-semibold text-white mb-2">Email Client Routing</h2>
                                        <p className="text-[14px] text-white/50 mb-6">Select what app opens when you click a domain owner's email address in the dashboard.</p>

                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            {[
                                                { id: 'default', label: 'System Default', desc: 'Mail, Outlook app, Apple Mail' },
                                                { id: 'gmail', label: 'Google Workspace', desc: 'New tab in Gmail web client' },
                                                { id: 'outlook', label: 'Microsoft 365', desc: 'New tab in Outlook web client' }
                                            ].map((option) => {
                                                const isActive = settings.emailClient === option.id;
                                                return (
                                                    <button
                                                        key={option.id}
                                                        onClick={() => setSettings({ ...settings, emailClient: option.id as 'default' | 'gmail' | 'outlook' })}
                                                        className={`group relative text-left flex flex-col p-4 rounded-xl border transition-all duration-200 outline-none cursor-pointer ${isActive
                                                            ? 'bg-[#1a1a1c] border-white/20 ring-1 ring-white/10'
                                                            : 'bg-[#111] border-white/10 hover:bg-[#1a1a1c] hover:border-white/20'
                                                            }`}
                                                    >
                                                        <span className={`text-[14px] font-medium transition-colors pr-6 ${isActive ? 'text-white' : 'text-zinc-400 group-hover:text-white'}`}>
                                                            {option.label}
                                                        </span>
                                                        <span className="text-[12px] text-zinc-500 mt-1">{option.desc}</span>
                                                        <div className={`absolute top-4 right-4 flex items-center justify-center w-4 h-4 rounded-full border transition-colors ${isActive ? 'border-transparent bg-white' : 'border-white/20 bg-black/20 group-hover:border-white/40'}`}>
                                                            {isActive && (
                                                                <div className="w-1.5 h-1.5 rounded-full bg-black" />
                                                            )}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>

                                <div className="border border-white/10 rounded-xl bg-[#09090b] shadow-sm overflow-hidden">
                                    <div className="p-6">
                                        <h2 className="text-[18px] font-semibold text-white mb-2">Issue Outreach Template</h2>
                                        <p className="text-[14px] text-white/50 mb-6">This text gets automatically injected into the email body along with the exact issues found when a domain has problems.</p>

                                        <textarea
                                            value={settings.messageTemplate}
                                            onChange={(e) => setSettings({ ...settings, messageTemplate: e.target.value })}
                                            rows={8}
                                            className="w-full bg-[#111] border border-white/10 rounded-xl p-4 text-[14px] text-white focus:outline-none focus:border-white/20 transition-colors font-medium resize-y"
                                            placeholder="Write your default email message..."
                                        />
                                    </div>
                                    <div className="px-6 py-3 bg-[#0a0a0c] border-t border-white/10 text-[13px] text-white/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                        <span>Use clear and professional language to notify internal stakeholders.</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </main>

            {/* Floating Action Bar */}
            <div
                className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showPill ? "translate-y-0 opacity-100" : "translate-y-16 opacity-0"
                    }`}
            >
                <div className="flex items-center gap-6 bg-[#1a1a1c]/90 backdrop-blur-xl border border-white/10 pl-6 pr-2 py-2 rounded-full shadow-[0_20px_40px_-15px_rgba(0,0,0,0.7)] pointer-events-auto">
                    <div className="flex items-center gap-2 min-w-[200px]">
                        {saveMessage.text ? (
                            <span className={`text-[13px] font-medium flex items-center gap-1.5 ${saveMessage.isError ? "text-rose-400" : "text-emerald-400"}`}>
                                {!saveMessage.isError && <CheckCircle2 className="w-4 h-4" />}
                                {saveMessage.text}
                            </span>
                        ) : (
                            <div className="flex items-center gap-2.5">
                                <div className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                                </div>
                                <span className="text-[13px] font-medium text-white/50 tracking-wide">Unsaved changes</span>
                            </div>
                        )}
                    </div>

                    <div className="w-px h-6 bg-white/10" />

                    <button
                        onClick={handleSave}
                        disabled={isSaving || !hasUnsavedChanges}
                        className="flex items-center gap-2 bg-white text-black px-6 py-2.5 rounded-full font-bold text-[13px] hover:bg-gray-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin text-black/50" /> : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}
