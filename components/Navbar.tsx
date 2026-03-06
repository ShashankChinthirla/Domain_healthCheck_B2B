'use client';

import { Trophy, ArrowLeft, LogIn, LogOut, Loader2, Sparkles, ChevronRight, Settings, ShieldCheck, Search, LifeBuoy } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { auth } from '@/lib/firebase';
import { User, signOut } from 'firebase/auth';
import { LoginModal } from '@/components/LoginModal';
import { cn } from '@/lib/utils';
import { NotificationDropdown } from './NotificationDropdown';
import { useOnClickOutside } from '@/lib/hooks';
import { isAdmin } from '@/lib/roles';
import { getUserSettings } from '@/app/settings/actions';
import { usePathname } from 'next/navigation';

interface NavbarProps {
    searchState?: {
        value: string;
        onChange: (val: string) => void;
        onSubmit: () => void;
        loading: boolean;
    };
}
export function Navbar({ searchState }: NavbarProps) {
    const pathname = usePathname();
    const [user, setUser] = useState<User | null>(null);
    const [isAuthLoading, setIsAuthLoading] = useState(true);
    const [isUserAdmin, setIsUserAdmin] = useState(false);
    const [dbDisplayName, setDbDisplayName] = useState('');
    const [showLogin, setShowLogin] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useOnClickOutside(dropdownRef as React.RefObject<HTMLElement>, () => setShowDropdown(false));

    useEffect(() => {
        const fetchUserData = async (currentUser: User) => {
            if (!currentUser.email) return;
            const adminStatus = await isAdmin(currentUser.email);
            setIsUserAdmin(adminStatus);

            // Fetch user settings for display name
            try {
                const token = await currentUser.getIdToken();
                const res = await getUserSettings(token);
                if (res.success && res.settings && res.settings.displayName) {
                    setDbDisplayName(res.settings.displayName);
                } else {
                    setDbDisplayName('');
                }
            } catch (err) {
                console.error("Error fetching user settings in Navbar:", err);
                setDbDisplayName('');
            }
        };

        const unsubscribe = auth.onAuthStateChanged(async (u) => {
            if (u) {
                setUser(u);
                setIsAuthLoading(false);
                await fetchUserData(u);
            } else {
                setUser(null);
                setIsUserAdmin(false);
                setDbDisplayName('');
                setIsAuthLoading(false);
            }
        });

        // Listen for internal settings updates
        const handleSettingsUpdate = () => {
            if (user) {
                fetchUserData(user);
            }
        };
        window.addEventListener('user-settings-updated', handleSettingsUpdate);

        return () => {
            unsubscribe();
            window.removeEventListener('user-settings-updated', handleSettingsUpdate);
        };
    }, [user]);

    const handleLogout = async () => {
        await signOut(auth);
        setShowDropdown(false);
    };

    return (
        <>
            <style>{`.custom-dropdown-item:hover { background-color: #2c2c2e !important; }`}</style>
            <nav className={cn(
                "fixed z-50 transition-all duration-300 border-white/10 backdrop-blur-xl flex justify-center",
                searchState
                    ? "top-0 left-0 w-full h-16 border-b bg-black/80"
                    : "top-6 left-1/2 -translate-x-1/2 w-[calc(100%-3rem)] max-w-7xl h-16 rounded-2xl border bg-black/80 shadow-2xl"
            )}>
                {/* INNER CONSTRAINED CONTAINER MATCHING THE REPORT MAX WIDTH */}
                <div className="w-full px-6 h-full flex items-center justify-between gap-6">

                    {/* Logo */}
                    <a href="/" className="text-sm font-medium tracking-widest text-white/90 uppercase opacity-80 hover:opacity-100 transition-opacity shrink-0 select-none cursor-pointer flex items-center">
                        DOMAINGUARD <span className="text-white/30 ml-2">PRO</span>
                    </a>

                    {/* Right Side (Search + Auth) */}
                    <div className="flex flex-1 items-center justify-end gap-6 sm:gap-8">
                        {/* Optional Navbar Search (Visible on Results Page) */}
                        {searchState && (
                            <div className="hidden md:flex items-center relative group w-80 animate-in fade-in slide-in-from-right-4 duration-500">
                                <div className="absolute left-3 text-white/40 pointer-events-none">
                                    <Search className="w-3.5 h-3.5" />
                                </div>
                                <input
                                    type="text"
                                    value={searchState.value}
                                    onChange={(e) => searchState.onChange(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && searchState.onSubmit()}
                                    placeholder="Analyze another domain..."
                                    className="w-full h-9 pl-9 pr-4 bg-[#1c1c1e] border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-all font-medium placeholder-white/20"
                                />
                                {searchState.loading && (
                                    <div className="absolute right-3">
                                        <Loader2 className="w-3.5 h-3.5 text-white/50 animate-spin" />
                                    </div>
                                )}
                            </div>
                        )}



                        {/* Auth Section */}
                        <div className="flex items-center gap-4 h-8 shrink-0">
                            {user && (pathname === '/dashboard' || pathname === '/settings') && <NotificationDropdown />}

                            {isAuthLoading ? (
                                <div className="w-9 h-9 rounded-full bg-white/5 animate-pulse border border-white/10" />
                            ) : user ? (
                                <div className="relative" ref={dropdownRef}>
                                    <button
                                        onClick={() => setShowDropdown(!showDropdown)}
                                        className={cn(
                                            "flex items-center justify-center p-0.5 rounded-full bg-[#1c1c1e] hover:bg-[#2c2c2e] border border-white/10 hover:border-white/20 transition-all duration-200 group cursor-pointer shadow-sm hover:shadow-md",
                                            showDropdown && "bg-[#2c2c2e] border-white/20"
                                        )}
                                    >
                                        {/* Avatar */}
                                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-white font-bold text-sm shadow-inner ring-2 ring-black/20">
                                            {user.photoURL ? (
                                                <img src={user.photoURL} alt="User" className="w-full h-full rounded-full object-cover" />
                                            ) : (
                                                (dbDisplayName?.[0] || user.displayName?.[0] || user.email?.[0] || 'U').toUpperCase()
                                            )}
                                        </div>
                                    </button>

                                    {/* Dropdown Menu */}
                                    {showDropdown && (
                                        <div className="absolute -right-6 top-[calc(100%+20px)] w-64 bg-[#111111] backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_16px_40px_-5px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 origin-top-right ring-1 ring-white/5 z-50">

                                            {/* User Info Header */}
                                            <div className="p-4 flex items-center gap-3 relative">
                                                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-gray-600 to-gray-400 flex items-center justify-center text-white font-bold text-[15px] shadow-inner shrink-0 object-cover overflow-hidden">
                                                    {user.photoURL ? (
                                                        <img src={user.photoURL} alt="User" className="w-full h-full object-cover" />
                                                    ) : (
                                                        (dbDisplayName?.[0] || user.displayName?.[0] || user.email?.[0] || 'U').toUpperCase()
                                                    )}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <p className="text-[14px] font-semibold tracking-wide text-white/95 truncate w-full">{dbDisplayName || user.displayName || 'DomainGuard User'}</p>
                                                    <p className="text-[12px] text-white/50 truncate mt-0.5 w-full">@{user.email?.split('@')[0] || 'user'}</p>
                                                </div>
                                            </div>

                                            <div className="h-[1px] w-[calc(100%-24px)] mx-auto bg-white/10" />

                                            {/* Actions */}
                                            <div className="p-2 space-y-0.5">
                                                <a
                                                    href="/dashboard"
                                                    className="w-full flex items-center gap-3 px-3 py-2 text-[14px] font-medium text-white/80 hover:text-white custom-dropdown-item rounded-lg transition-all cursor-pointer group"
                                                >
                                                    <ShieldCheck size={16} className="text-white/50 group-hover:text-white" />
                                                    Dashboard
                                                </a>

                                                <a
                                                    href="/settings"
                                                    className="w-full flex items-center gap-3 px-3 py-2 text-[14px] font-medium text-white/80 hover:text-white custom-dropdown-item rounded-lg transition-all cursor-pointer group"
                                                >
                                                    <Settings size={16} className="text-white/50 group-hover:text-white" />
                                                    Settings
                                                </a>
                                            </div>

                                            <div className="h-[1px] w-[calc(100%-24px)] mx-auto bg-white/10" />

                                            <div className="p-2">
                                                <a
                                                    href="mailto:support@domainguard.com"
                                                    className="w-full flex items-center justify-between px-3 py-2 text-[14px] font-medium text-white/80 hover:text-white custom-dropdown-item rounded-lg transition-all cursor-pointer group"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <LifeBuoy size={16} className="text-white/50 group-hover:text-white" />
                                                        Help
                                                    </div>
                                                    <ChevronRight size={14} className="text-white/30" />
                                                </a>

                                                <button
                                                    onClick={handleLogout}
                                                    className="w-full flex items-center gap-3 px-3 py-2 text-[14px] font-medium text-white/80 hover:text-white custom-dropdown-item rounded-lg transition-all cursor-pointer group mt-0.5"
                                                >
                                                    <LogOut size={16} className="text-white/50 group-hover:text-white" />
                                                    Log out
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <button
                                    onClick={() => setShowLogin(true)}
                                    className="flex items-center gap-2 px-5 py-2 rounded-full bg-white text-black text-sm font-bold tracking-tight hover:bg-zinc-200 active:scale-95 transition-all shadow-lg hover:shadow-white/20 cursor-pointer"
                                >
                                    <LogIn size={14} strokeWidth={2.5} />
                                    <span>Sign In</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </nav>

            {/* Login Modal */}
            <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
        </>
    );
}
