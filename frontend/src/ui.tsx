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
                "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors",
                variant === 'primary' && "bg-emerald-500 text-emerald-950 hover:bg-emerald-600",
                variant === 'secondary' && "bg-zinc-800 text-gray-200 hover:bg-zinc-700",
                variant === 'ghost' && "bg-transparent text-gray-400 hover:text-gray-200 hover:bg-zinc-800/50",
                className
            )}
        />
    );
}

// Card
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div {...props} className={cn("bg-[#121214] border border-zinc-800 rounded-lg p-4", className)} />
    );
}

// Badge
export function Badge({ className, variant = 'default', children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: 'default' | 'red' | 'blue' | 'green' | 'emerald' | 'amber' | 'purple' }) {
    const variants = {
        default: "bg-zinc-800 text-gray-300",
        red: "bg-red-500/10 text-red-400 border border-red-500/20",
        blue: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
        'green': 'bg-green-500/10 text-green-400 border border-green-500/20',
        'emerald': 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
        'amber': 'bg-amber-500/10 text-amber-500 border border-amber-500/20',
        purple: "bg-purple-500/10 text-purple-400 border border-purple-500/20",
    };
    return (
        <span {...props} className={cn("px-2 py-0.5 text-xs font-medium rounded-full", variants[variant], className)}>
            {children}
        </span>
    );
}
