import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Domain Email Health Checker",
  description: "Check SPF, DMARC, and MX records for domain health.",
};

import { Toaster } from 'sonner';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <NotificationProvider>
          {children}
          {/* Vercel-Style Sonner Toaster */}
          <Toaster
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast: 'bg-[#0A0A0B] border border-white/10 text-white/90 shadow-2xl rounded-xl items-start p-4',
                title: 'text-[14px] font-medium tracking-tight',
                description: 'text-[13px] text-white/60 mt-1',
              },
            }}
            icons={{
              success: <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5" />,
              error: <AlertCircle className="w-5 h-5 text-rose-500 mt-0.5" />,
              warning: <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />,
              info: <Info className="w-5 h-5 text-blue-500 mt-0.5" />,
            }}
          />
        </NotificationProvider>
      </body>
    </html>
  );
}
