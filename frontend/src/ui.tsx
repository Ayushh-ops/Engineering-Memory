import { LucideIcon } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// Button
export function Button({ className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
    return (
        <button
            {...props}
            className={cn(
                "inline-flex items-center justify-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                variant === 'primary' && "bg-[#4FD1B5] text-[#04100D] hover:brightness-110 active:scale-[0.98]",
                variant === 'secondary' && "bg-white/[0.04] text-[#E8EAE6] border border-white/10 hover:bg-white/[0.08] hover:border-white/20",
                variant === 'ghost' && "bg-transparent text-[#8A918C] hover:text-[#E8EAE6] hover:bg-white/[0.04]",
                className
            )}
        />
    );
}

// Card
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div {...props} className={cn("glass-surface rounded-xl p-3.5 text-[#E8EAE6]", className)} />
    );
}

// Badge
export function Badge({ className, variant = 'default', children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: 'default' | 'red' | 'blue' | 'green' | 'emerald' | 'amber' | 'purple' }) {
    const variants = {
        default: "bg-white/[0.04] text-[#8A918C] border border-white/10",
        red: "bg-red-500/10 text-red-400 border border-red-500/20",
        blue: "bg-sky-500/10 text-sky-400 border border-sky-500/20",
        'green': 'bg-[#4FD1B5]/10 text-[#4FD1B5] border border-[#4FD1B5]/20',
        'emerald': 'bg-[#4FD1B5]/10 text-[#4FD1B5] border border-[#4FD1B5]/20',
        'amber': 'bg-[#E3A04A]/10 text-[#E3A04A] border border-[#E3A04A]/20',
        purple: "bg-purple-500/10 text-purple-400 border border-purple-500/20",
    };
    return (
        <span {...props} className={cn("px-2 py-0.5 text-[11px] font-mono rounded-full inline-flex items-center gap-1", variants[variant], className)}>
            {children}
        </span>
    );
}
